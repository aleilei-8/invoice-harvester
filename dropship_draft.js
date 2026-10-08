// dropship_draft.js —— 代发采购草稿核心纯逻辑（与 DOM 无关，浏览器与 Node 共用、可单测）
// 同时支持浏览器全局 IH_DROPSHIP 与 Node module.exports。
//
// 数据依据（用户 2026-10-09 四张 PDD 商家后台订单详情页截图实测确认）：
//   ① 列表明号文 = 隐私号（虚拟号），页面明示「当前手机号为隐私号，请使用该号码发货」；
//   ② 拨打需输 4 位分机：听到语音提示后输入分机号转接买家；
//   ③ 分机号位置：收货人姓名末尾方括号 [0255]、联系地址末尾 y1008[0255]；
//   ④ 填 1688 黄金规则（官方弹窗原文）：收货人/地址照抄含括号及 4 位数字，电话填 11 位主号；
//   ⑤ 合规：用虚拟号发货是平台设计用法，页面横幅仅禁止第三方获取真实联系方式。
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.IH_DROPSHIP = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---- 1. 虚拟号解析（核心，已实测格式）----
  // 输入：含收货信息的整段文本（姓名/电话/地址混合均可）
  // 输出：{ phone, ext, hasExt, isVirtual, raw }
  function parseVirtualPhone(text) {
    if (!text) return { phone: null, ext: null, hasExt: false, isVirtual: false, raw: null };
    const s = String(text);

    // 11 位主号：在原文上精确匹配「前后都不是数字」的 11 位串，自动排除订单号等长数字串。
    // 注意：不要先去空格——会把前一条数字的末位与电话首位粘连成 15 位导致漏匹配。
    const phoneMatch = s.match(/(?<!\d)(\d{11})(?!\d)/);
    const phone = phoneMatch ? phoneMatch[1] : null;

    // 4 位分机号：藏在方括号里（姓名末尾 [0255] 或地址末尾 y1008[0255]）
    const extMatch = s.match(/\[(\d{4})\]/);
    const ext = extMatch ? extMatch[1] : null;

    // 虚拟号特征：11 位 + 带方括号分机，或文本里出现「隐私号」字样
    const isVirtual = !!(phone && ext) || /隐私号/.test(s);

    return { phone: phone, ext: ext, hasExt: !!ext, isVirtual: isVirtual, raw: s };
  }

  // ---- 2. 收货信息块解析 ----
  // 输入：收货信息区域整段文本（含「收货人 / 手机号 / 联系地址」等标签）
  // 输出：{ name, phone, address, ext, confidence }
  function parseRecipientBlock(text) {
    const s = String(text || "");
    const out = { name: null, phone: null, address: null, ext: null, confidence: "low" };
    if (!s.trim()) return out;

    // 手机号（纯数字 11 位，排除订单号）
    const pv = parseVirtualPhone(s);
    out.phone = pv.phone;
    out.ext = pv.ext;

    // 地址：标签「联系地址 / 收货地址」之后到文本末（或下一个标签之前）
    const addrM = s.match(/(?:联系地址|收货地址|地址)[：:\s]*(.+)$/);
    if (addrM) out.address = addrM[1].replace(/\s*复制.*$/, "").trim();

    // 收货人：标签「收货人」之后、到「手机号 / 联系地址 / 复制」之前
    // 注意：姓名本身含分机号方括号 [0255]，故 lookahead 不可含 \[（否则截到方括号前）
    const nameM = s.match(/收货人[：:\s]*([^\n]*?)(?=\s*(?:手机号|联系地址|复制|$))/);
    if (nameM) out.name = nameM[1].trim();

    // 置信度
    out.isVirtual = pv.isVirtual;
    let c = 0;
    if (out.phone) c++;
    if (out.name) c++;
    if (out.address) c++;
    out.confidence = c >= 3 ? "high" : c === 2 ? "mid" : "low";
    return out;
  }

  // ---- 3. 规格归一化（骨架：小块映射表，后续可扩充）----
  const SPEC_MAP = {
    "均码": "均码", "均码/": "均码", "m": "M", "中码": "M", "l": "L", "大码": "L",
    "xl": "XL", "加大码": "XL", "xxl": "2XL", "2xl": "2XL", "xxxl": "3XL",
    "藏青": "深蓝", "藏青色": "深蓝", "深蓝色": "深蓝", "宝蓝": "深蓝",
  };
  function normalizeSpec(specText) {
    if (!specText) return { raw: "", norm: "" };
    const raw = String(specText).replace(/\s+/g, " ").trim();
    const norm = SPEC_MAP[raw.toLowerCase()] || SPEC_MAP[raw] || raw;
    return { raw: raw, norm: norm };
  }

  // ---- 4. 1688 同款搜索 URL 构造 ----
  function build1688SearchUrl(title, spec) {
    const kw = [title, spec && spec.raw ? spec.raw : ""].filter(Boolean).join(" ").trim();
    const url = "https://s.1688.com/offer/offer_search.htm?keywords=" +
      encodeURIComponent(kw);
    return { keywords: kw, url: url };
  }

  // ---- 5. 利润差计算（fail-open：缺成本则标待填）----
  function computeProfit(pddPaid, cost, shipping) {
    const paid = Number(pddPaid) || 0;
    const c = Number(cost);
    const sh = Number(shipping) || 0;
    if (!isFinite(c)) return { profit: null, note: "成本待填" };
    return { profit: +(paid - c - sh).toFixed(2), note: "" };
  }

  // ---- 6. 单条订单 → 采购草稿卡片模型（Stage 1 输出）----
  // order 字段：{ orderId, item, spec, qty, pddPaid, recipientText, cost?, shipping? }
  function toDraftCard(order) {
    order = order || {};
    const recipient = parseRecipientBlock(order.recipientText || "");
    const spec = normalizeSpec(order.spec);
    const search = build1688SearchUrl(order.item, spec);
    const profit = computeProfit(order.pddPaid, order.cost, order.shipping);

    // fail-open：缺主号 或 缺分机 → 标红待取号，不阻塞（1688 收货需主号+分机才能正确送达）
    const needPhone = !!(!recipient.phone || !recipient.ext);

    return {
      orderId: order.orderId || null,
      item: order.item || null,
      spec: spec,
      qty: Number(order.qty) || 0,
      pddPaid: Number(order.pddPaid) || 0,
      recipient: recipient,
      searchUrl: search.url,
      keywords: search.keywords,
      profit: profit,
      flags: {
        needPhone: needPhone,
        confidence: recipient.confidence,
      },
    };
  }

  // ---- 7. 批量：订单数组 → 草稿卡片数组 ----
  function buildDrafts(orders) {
    return (orders || []).map(toDraftCard);
  }

  return {
    parseVirtualPhone: parseVirtualPhone,
    parseRecipientBlock: parseRecipientBlock,
    normalizeSpec: normalizeSpec,
    build1688SearchUrl: build1688SearchUrl,
    computeProfit: computeProfit,
    toDraftCard: toDraftCard,
    buildDrafts: buildDrafts,
  };
});
