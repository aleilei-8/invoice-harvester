// run.js —— 代发机器人主循环
// 流程：拉 PDD 新订单 → 解析虚拟号 → 1688 建采购单(填收货,不付款) → 通知(带采购单链接) → 人工手机付款 → 回填物流
// 严守：绝不自动付款 / 自动提交 / 自动发货。
"use strict";
const fs = require("fs");
const path = require("path");
const D = require("./draft");
const pdd = require("./pdd");
const notify = require("./notifier");
const agent = require("./agent1688");
const store = require("./store");
const reconcile = require("./reconcile");

// 零依赖读取 .env（若存在）
function loadEnv() {
  const f = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

//  dry-run 用样本（无需任何凭证即可跑通解析+通知链路）
const SAMPLE = [
  {
    orderId: "2609PDD1001",
    item: "纯棉短袖 T 恤",
    spec: "白色 M",
    qty: 2,
    pddPaid: 39.9,
    recipientText:
      "收货人：吴**[0255] 手机号 19959783357 当前手机号为隐私号 联系地址 广东省 深圳市 龙华区 xxx 下一层楼梯(送货上门) y1008[0255] 复制",
    cost: 18.5,
    shipping: 3,
  },
];

// 单条订单处理
async function processOrder(order, opt) {
  const card = D.toDraftCard(order);
  const block = [card.recipient.name, card.recipient.phone, card.recipient.address]
    .filter(Boolean).join("\n");

  let poUrl = "(dry-run 跳过建单)";
  if (!opt.dryRun) {
    const r = await agent.createPurchaseOrder({
      keywords: card.keywords,
      recipient: card.recipient,
      profileDir: opt.profileDir,
    });
    poUrl = r.purchaseOrderUrl;
  }

  const title = card.flags.needPhone ? "代发·待补号" : "代发·待付款";
  const body = [
    `订单 ${order.orderId}`,
    `商品 ${order.item} ${card.spec.norm} ×${card.qty}`,
    `PDD 实付 ¥${card.pddPaid}${card.profit.profit != null ? `｜利润 ¥${card.profit.profit}` : ""}`,
    `收货:\n${block}`,
    `采购单: ${poUrl}`,
    card.flags.needPhone ? "⚠️ 主号/分机缺失，请先补号" : "请手机打开采购单付款",
  ].join("\n");

  await notify.send(opt.notifyUrl, { title, body });

  // 落库：把 PDD 订单 ↔ 1688 采购单 的映射写入状态库，供 reconcile 阶段回填
  const st = store.load();
  store.upsert(st, {
    pddOrderSn: order.orderId,
    item: order.item,
    keywords: card.keywords,
    poUrl,
    status: "po_created",
  });
  store.save(st);

  return { orderId: order.orderId, poUrl, needPhone: card.flags.needPhone, keywords: card.keywords };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const doReconcile = process.argv.includes("--reconcile");
  if (!dryRun) loadEnv();
  const opt = {
    dryRun,
    autoShip: process.argv.includes("--auto-ship") || (process.env.AUTO_SHIP === "true"),
    profileDir: process.env.P1688_PROFILE_DIR || "./.p1688",
    notifyUrl: process.env.NOTIFY_URL || "",
    cfg: { clientId: process.env.PDD_CLIENT_ID, clientSecret: process.env.PDD_CLIENT_SECRET },
  };

  // 模式 A：物流回填（reconcile 阶段）
  if (doReconcile) {
    console.log(`[dropship-bot] 模式: RECONCILE${opt.autoShip ? " (auto-ship 已开启)" : " (仅通知，不自动发货)"}${dryRun ? " / DRY-RUN" : ""}\n`);
    const r = await reconcile.reconcileOnce({
      profileDir: opt.dryRun ? null : opt.profileDir,
      cfg: opt.cfg,
      notifyUrl: opt.notifyUrl,
      autoShip: opt.autoShip,
    });
    console.log("对账结果:", JSON.stringify(r));
    return;
  }

  // 模式 B：拉新订单 → 建 1688 采购单 → 通知
  console.log(`[dropship-bot] 模式: ${dryRun ? "DRY-RUN(无需凭证)" : "LIVE"}\n`);
  const orders = dryRun ? SAMPLE : await pdd.fetchNewOrders(opt.cfg);

  for (const o of orders) {
    const r = await processOrder(o, opt);
    console.log(`✔ 已处理 ${r.orderId} → 采购单: ${r.poUrl} ${r.needPhone ? "(待补号)" : ""}`);
  }
  console.log("\n完成。人工在手机 1688 App 付款后，运行 `node src/run.js --reconcile` 回填物流（见 README）。");
}

main().catch(e => { console.error("运行出错:", e.message); process.exit(1); });
