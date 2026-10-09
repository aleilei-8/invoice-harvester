// reconcile.js —— 物流回填阶段（方案 A 闭环的最后一步）
// 触发：你在手机 1688 App 付款、卖家发货后，机器人自动
//   ① 抓 1688 物流单号  →  ② 回传 PDD 完成发货。
// 安全边界：默认【不自动发货】，只通知“已揽收，待确认回填”；
//   仅当显式传入 autoShip=true 且已配置 PDD 凭证，才真正回传 PDD。
"use strict";
const store = require("./store");

// 单次对账：遍历待处理订单，抓物流 → 通知（→ 可选回传 PDD）
// deps 可注入（便于单测）：{ store, agent, pdd, notify }
async function reconcileOnce(opt = {}) {
  const S = opt.store || store;
  const A = opt.agent || require("./agent1688");
  const P = opt.pdd || require("./pdd");
  const N = opt.notify || require("./notifier");

  const stateFile = opt.stateFile || S.DEFAULT_FILE;
  const state = S.load(stateFile);
  const todos = S.pending(state);
  const result = { checked: 0, tracked: 0, shipped: 0, skipped: 0, errors: [] };

  for (const rec of todos) {
    result.checked++;
    try {
      const tk = await A.getTracking({
        aliOrderUrl: rec.aliOrderUrl,
        keyword: rec.item,
        profileDir: opt.profileDir,
        dryRun: !opt.profileDir,
      });

      if (!tk.shipped) { result.skipped++; continue; }

      // 抓到物流：落库为 tracked（移出待处理，避免重复通知）
      S.upsert(state, { ...rec, status: "tracked", carrier: tk.carrier, trackingNo: tk.trackingNo });
      S.save(state, stateFile);
      result.tracked++;

      const body = [
        `订单 ${rec.pddOrderSn} 已揽收`,
        `承运商 ${tk.carrier}`,
        `运单号 ${tk.trackingNo}`,
        opt.autoShip
          ? "（正在自动回填 PDD…）"
          : "请确认后回填；或启动时加 --auto-ship 全自动回填。",
      ].join("\n");
      await N.send(opt.notifyUrl, { title: "代发·物流回填", body });

      // 仅在显式 autoShip 且具备 PDD 凭证时，真正回传 PDD 发货
      if (opt.autoShip && opt.cfg && opt.cfg.clientId) {
        await P.ship(rec.pddOrderSn, tk.carrier, tk.trackingNo, opt.cfg);
        S.upsert(state, { ...rec, status: "delivered", carrier: tk.carrier, trackingNo: tk.trackingNo });
        S.save(state, stateFile);
        result.shipped++;
      }
    } catch (e) {
      result.errors.push({ order: rec.pddOrderSn, error: e.message });
    }
  }
  return result;
}

module.exports = { reconcileOnce };
