// agent1688.js —— 用 Playwright 在 1688 建「采购单」并填虚拟号收货（不付款）
// 关键设计：与桌面扩展同源的解析逻辑；建单后不提交/不付款，只生成待付款采购单，
// 用户手机 1688 App 打开同一账号的采购单即可付款（采购单跨端同步）。
"use strict";

// 懒加载 playwright，dry-run 不依赖它
let chromium = null;
function loadPlaywright() {
  if (!chromium) chromium = require("playwright").chromium;
  return chromium;
}

// 在 1688 搜索首个同款，开商品页，选规格，加入采购单，填收货（含虚拟号），保存。
// 返回 { ok, purchaseOrderUrl }
async function createPurchaseOrder({ keywords, recipient, profileDir }) {
  const browserType = loadPlaywright();
  const context = await browserType.launchPersistentContext(profileDir, {
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await context.newPage();
  try {
    // 1) 搜索
    await page.goto("https://s.1688.com/offer/offer_search.htm?keywords=" + encodeURIComponent(keywords), { waitUntil: "domcontentloaded" });
    const first = page.locator(".offer-list .offer-item a, .sm-offer-item a").first();
    await first.click();
    await page.waitForLoadState("domcontentloaded");

    // 2) 选规格（best-effort：点击第一个可选规格，与桌面扩展同策略）
    const spec = page.locator(".sku-edit-item, .offer-sku .item").first();
    if (await spec.count()) await spec.click().catch(() => {});

    // 3) 加入采购单 / 下单（不提交）
    const addBtn = page.getByText(/加入采购单|立即下单|发起订单/).first();
    await addBtn.click().catch(() => {});

    // 4) 填收货（虚拟号）：姓名/地址照抄含方括号分机，电话填 11 位主号
    const name = recipient.name || "";
    const phone = recipient.phone || "";
    const addr = recipient.address || "";
    await page.fill('input[name*="name" i], input[placeholder*="收货人" i]', name).catch(() => {});
    await page.fill('input[name*="mobile" i], input[placeholder*="手机" i]', phone).catch(() => {});
    await page.fill('textarea[name*="address" i], textarea[placeholder*="地址" i]', addr).catch(() => {});
    await page.getByText(/保存|确认/).first().click().catch(() => {});

    return { ok: true, purchaseOrderUrl: "https://purchasing.1688.com/" };
  } finally {
    await context.close();
  }
}

// 抓取 1688 采购单的物流单号（用户手机付款、卖家发货后）
// 输入：{ aliOrderUrl?, keyword?, profileDir?, dryRun? }
// 输出：{ shipped: bool, carrier, trackingNo, dry? }
// 策略：打开已买到的货/订单详情 → 在页面文本里匹配承运商名 + 12~22 位运单号。
// 启发式兜底：任何一页找不到就返回 shipped:false，下次 reconcile 再试（不误回填）。
async function getTracking({ aliOrderUrl, keyword, profileDir, dryRun } = {}) {
  if (dryRun || !profileDir) {
    // dry-run / 无登录态：返回样本物流，仅用于打通链路（不会真回传）
    return { shipped: true, carrier: "圆通速递", trackingNo: "YT" + String(Date.now()).slice(-12), dry: true };
  }
  const browserType = loadPlaywright();
  const context = await browserType.launchPersistentContext(profileDir, {
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await context.newPage();
  try {
    const target = aliOrderUrl || "https://buyer.1688.com/order/my_order.htm";
    await page.goto(target, { waitUntil: "domcontentloaded" });
    if (keyword) {
      const row = page.getByText(keyword, { exact: false }).first();
      await row.click().catch(() => {});
      await page.waitForLoadState("domcontentloaded").catch(() => {});
    }
    const html = await page.content();
    const carriers = ["顺丰速运", "圆通速递", "中通快递", "申通快递", "韵达速递",
      "邮政EMS", "京东物流", "极兔速递", "德邦快递", "百世快递"];
    let carrier = null;
    for (const c of carriers) if (html.includes(c)) { carrier = c; break; }
    const m = html.match(/(?<!\d)(\d{12,22})(?!\d)/);
    const trackingNo = m ? m[1] : null;
    const shipped = !!(carrier && trackingNo);
    return { shipped, carrier, trackingNo };
  } finally {
    await context.close();
  }
}

module.exports = { createPurchaseOrder, getTracking };
