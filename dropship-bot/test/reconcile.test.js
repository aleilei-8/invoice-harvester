// reconcile.test.js —— 物流回填阶段单测（注入假依赖，零网络、零浏览器）
"use strict";
const assert = require("assert");
const store = require("../src/store");
const reconcile = require("../src/reconcile");

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log("  ✔", name); }
  else { fail++; console.log("  ✘", name); }
}

// 内存版假状态库
function fakeStore() {
  const st = { orders: [] };
  return {
    DEFAULT_FILE: ":memory:",
    load: () => st,
    save: () => {},
    find: (s, sn) => st.orders.find(o => o.pddOrderSn === sn) || null,
    upsert: (s, rec) => {
      const i = s.orders.findIndex(o => o.pddOrderSn === rec.pddOrderSn);
      if (i >= 0) s.orders[i] = { ...s.orders[i], ...rec };
      else s.orders.push(rec);
    },
    pending: (s) => s.orders.filter(o => o.status === "po_created"),
  };
}

async function run() {
  console.log("== reconcile 阶段 ==");

  // 1) dry-run 抓到物流 → 默认不自动发货，落库 tracked + 通知 1 次
  {
    const FS = fakeStore();
    FS.upsert(FS.load(), { pddOrderSn: "O1", item: "T恤", status: "po_created" });
    let notifyCount = 0, shipped = false;
    const r = await reconcile.reconcileOnce({
      store: FS,
      agent: { getTracking: async () => ({ shipped: true, carrier: "圆通速递", trackingNo: "YT123" }) },
      pdd: { ship: async () => { shipped = true; } },
      notify: { send: async () => { notifyCount++; } },
      autoShip: false,
    });
    ok("checked=1", r.checked === 1);
    ok("tracked=1", r.tracked === 1);
    ok("默认不自动发货", r.shipped === 0 && shipped === false);
    ok("仅通知 1 次", notifyCount === 1);
    ok("状态落库为 tracked", FS.find(FS.load(), "O1").status === "tracked");
    ok("追踪号已记录", FS.find(FS.load(), "O1").trackingNo === "YT123");
  }

  // 2) autoShip=true + 有凭证 → 真正回传 PDD，状态 delivered
  {
    const FS = fakeStore();
    FS.upsert(FS.load(), { pddOrderSn: "O2", item: "裤", status: "po_created" });
    let shipped = false, shipArgs = null;
    const r = await reconcile.reconcileOnce({
      store: FS,
      agent: { getTracking: async () => ({ shipped: true, carrier: "中通快递", trackingNo: "ZT789" }) },
      pdd: { ship: async (sn, c, n) => { shipped = true; shipArgs = [sn, c, n]; } },
      notify: { send: async () => {} },
      autoShip: true,
      cfg: { clientId: "x", clientSecret: "y" },
    });
    ok("autoShip 触发回传", shipped === true && r.shipped === 1);
    ok("回传参数正确(单号/承运商)", shipArgs[0] === "O2" && shipArgs[1] === "中通快递" && shipArgs[2] === "ZT789");
    ok("状态落库为 delivered", FS.find(FS.load(), "O2").status === "delivered");
  }

  // 3) 1688 还没发货（shipped=false）→ 跳过，不动状态
  {
    const FS = fakeStore();
    FS.upsert(FS.load(), { pddOrderSn: "O3", item: "鞋", status: "po_created" });
    const r = await reconcile.reconcileOnce({
      store: FS,
      agent: { getTracking: async () => ({ shipped: false }) },
      pdd: { ship: async () => {} },
      notify: { send: async () => {} },
      autoShip: true,
    });
    ok("未发货则 skipped=1", r.skipped === 1 && r.tracked === 0 && r.shipped === 0);
    ok("状态仍为 po_created", FS.find(FS.load(), "O3").status === "po_created");
  }

  // 4) store.pending 只含 po_created（tracked 不再重复处理）
  {
    const st = { orders: [
      { pddOrderSn: "A", status: "po_created" },
      { pddOrderSn: "B", status: "tracked" },
      { pddOrderSn: "C", status: "delivered" },
    ] };
    ok("pending 仅返回 po_created", store.pending(st).length === 1 && store.pending(st)[0].pddOrderSn === "A");
  }

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}
run().catch(e => { console.error("测试异常:", e); process.exit(1); });
