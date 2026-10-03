// 标准输出字段由 lib.js 统一提供（浏览器全局 IH_LIB），保持插件与汇总逻辑单一数据源
const FIELDS = IH_LIB.FIELDS;

// ===== 各平台列角色关键词预设 =====
// 结构：role -> [关键词...]，匹配时取「最长命中关键词」决定角色，避免「编号」误伤「订单编号」。
const PLATFORM_PRESETS = {
  pdd: {
    name: "拼多多",
    keywords: {
      buyer_title: ["发票抬头", "抬头", "公司名称", "购买方名称", "购方名称", "名称"],
      tax_no: ["企业税号", "税号", "纳税人识别号", "统一社会信用代码", "识别号", "信用代码", "tax", "tin", "纳税人"],
      invoice_kind: ["发票种类", "发票类别", "种类"],
      invoice_type: ["发票类型", "蓝票", "红票"],
      extra_info: ["其他信息", "开户银行", "开户行"],
      order_id: ["订单号", "订单编号", "订单", "单号", "order", "no.", "编号"],
      order_status: ["订单/售后状态", "订单状态", "成交状态"],
      after_sale: ["售后状态", "售后"],
      trans_time: ["成交时间", "下单时间", "交易时间"],
      qty: ["数量", "件数"],
      goods_total: ["商品总价", "商品总额"],
      tracking_no: ["快递单号", "物流单号", "运单号", "货运单号", "tracking", "waybill"],
      logistics: ["物流信息", "物流"],
      amount: ["发票金额", "实收金额", "金额", "价税合计", "开票金额", "实付金额", "合计", "金额(元)", "商品总价(元)", "amount", "price", "价税"],
      items: ["商品信息", "商品名称", "物品", "商品", "发票内容", "货物", "货品", "宝贝标题", "item", "product", "内容", "品名"],
      invoice_date: ["开票时间", "开票日期", "开票日期时间"],
      apply_date: ["申请时间", "申请日期", "apply"],
      buyer: ["买家", "收货人", "购买方", "customer", "consignee", "收件人"],
      ship_to: ["收货信息", "收货人", "收货地址"],
      remark: ["备注", "用户备注", "买家留言", "操作/备注", "操作"],
    },
  },
  taobao: {
    name: "淘宝 / 天猫",
    keywords: {
      buyer_title: ["发票抬头", "抬头", "公司", "购买方名称", "购方名称", "名称"],
      tax_no: ["税号", "纳税人识别号", "统一社会信用代码", "识别号", "信用代码", "tin"],
      order_id: ["订单编号", "订单号", "订单", "单号", "trade", "no.", "编号"],
      tracking_no: ["运单号", "物流单号", "快递单号", "waybill", "物流"],
      amount: ["实付金额", "订单金额", "应付金额", "价税合计", "金额", "合计", "amount", "price"],
      items: ["宝贝标题", "商品标题", "商品", "发票内容", "货物", "品名", "item", "product"],
      invoice_date: ["开票时间", "开票日期"],
      apply_date: ["申请时间", "申请日期", "apply"],
      buyer: ["收货人", "买家", "收件人", "consignee"],
    },
  },
  jd: {
    name: "京东",
    keywords: {
      buyer_title: ["发票抬头", "抬头", "购方名称", "公司名称", "名称"],
      tax_no: ["税号", "纳税人识别号", "统一社会信用代码", "识别号", "信用代码", "tin"],
      order_id: ["订单号", "订单编号", "订单", "单号", "order", "no.", "编号"],
      tracking_no: ["运单号", "物流单号", "快递单号", "waybill", "物流"],
      amount: ["应付金额", "实付金额", "订单金额", "价税合计", "金额", "合计", "amount", "price"],
      items: ["商品名称", "商品", "发票内容", "货物", "品名", "item", "product"],
      invoice_date: ["开票时间", "开票日期"],
      apply_date: ["申请时间", "申请日期", "apply"],
      buyer: ["收货人", "买家", "收件人", "consignee"],
    },
  },
  douyin: {
    name: "抖音小店",
    keywords: {
      buyer_title: ["发票抬头", "抬头", "购买方名称", "公司名称", "名称"],
      tax_no: ["税号", "纳税人识别号", "统一社会信用代码", "识别号", "信用代码", "tin"],
      order_id: ["订单号", "订单编号", "订单", "单号", "order", "no.", "编号"],
      tracking_no: ["物流单号", "快递单号", "运单号", "waybill", "物流"],
      amount: ["订单金额", "实付金额", "价税合计", "金额", "合计", "amount", "price"],
      items: ["商品名称", "商品", "发票内容", "货物", "品名", "item", "product"],
      invoice_date: ["开票时间", "开票日期"],
      apply_date: ["申请时间", "申请日期", "apply"],
      buyer: ["收货人", "买家", "收件人", "consignee"],
    },
  },
};

const ROLE_LABEL = Object.fromEntries(FIELDS.map((f) => [f.key, f.label]));
ROLE_LABEL[""] = "忽略";

let lastTables = null;        // 最近一次抓取的结构
let activeKeywords = null;     // 当前生效的 ROLE_KEYWORDS

// ===== 注入到商家后台页面执行的提取函数（必须自包含）=====
function extractTables(roleKeywords, fields) {
  const labelOf = {};
  (fields || []).forEach((f) => { labelOf[f.key] = f.label; });

  // 关键词匹配：返回 { role, score }（score=命中关键词长度，用于重复角色仲裁），或 null
  function matchRole(text, kw) {
    if (!text) return null;
    const t = text.toLowerCase();
    let best = null;
    let bestScore = 0;
    for (const role in kw) {
      for (const k of kw[role]) {
        const kk = k.toLowerCase();
        if (kk && t.indexOf(kk) !== -1 && kk.length > bestScore) {
          bestScore = kk.length;
          best = role;
        }
      }
    }
    return best ? { role: best, score: bestScore } : null;
  }

  // 判定一行单元格更像「数据」还是「表头」：
  // 真实表头是短标签（订单号/状态…），不可能含完整日期、¥ 金额或长数字单号；
  // 数据行命中任一特征即判定为数据。
  function looksLikeDataRow(cells) {
    let dateLike = 0, amountLike = 0, orderLike = 0;
    cells.forEach((c) => {
      const s = String(c || "").trim();
      if (!s) return;
      if (/\d{4}[-/年]\d{1,2}[-/月]\d{1,2}/.test(s)) { dateLike++; return; }
      if (/[¥￥]/.test(s)) { amountLike++; return; }
      if (/^(\d[\d\-]{7,})(\s|$)/.test(s.split(/\s+/)[0]) || /^\d{8,}$/.test(s.split(/\s+/)[0])) orderLike++;
    });
    return dateLike >= 1 || amountLike >= 1 || orderLike >= 1;
  }

  function cellTexts(row) {
    return Array.from(row.querySelectorAll("th, td")).map((c) => c.innerText.replace(/\s+/g, " ").trim());
  }

  const tables = Array.from(document.querySelectorAll("table"));

  // --- 第一遍：收集候选表（表头单元格 + 全部数据行，含跨列行）---
  const candidates = [];
  tables.forEach((tbl, idx) => {
    const allRows = Array.from(tbl.querySelectorAll("tr"));
    if (!allRows.length) return;

    let headerRow = allRows.find((r) => r.querySelector("th"));
    let headerCells, dataRows;
    if (headerRow) {
      headerCells = cellTexts(headerRow);
      dataRows = allRows.filter((r) => r !== headerRow);
    } else {
      headerCells = cellTexts(allRows[0]);
      dataRows = allRows.slice(1);
    }
    if (headerCells.length < 2) return;

    candidates.push({ idx, headerCells, allCellRows: dataRows.map(cellTexts) });
  });

  // --- 订单查询页检测（拼多多：每个订单 = 独立 table，首行合并「订单编号：…成交时间：…」）---
  const orderTplCand = candidates.find(
    (c) => !c.allCellRows.length &&
      c.headerCells.some((h) => /商品信息/.test(h)) &&
      c.headerCells.some((h) => /订单\/售后状态|订单状态/.test(h)) &&
      c.headerCells.length >= 7
  );
  const orderTemplate = orderTplCand
    ? orderTplCand.headerCells
    : ["", "商品信息", "订单/售后状态", "数量", "商品总价(元)", "实收金额(元)", "收货信息", "买家", "操作/备注"];
  const orderIdx = new Set(candidates.filter(isOrderTable).map((c) => c.idx));
  const orderListMode = orderIdx.size > 0 && (orderTplCand != null || orderIdx.size >= 2);

  // --- 第二遍：合并「粘性表头」---
  // 拼多多等后台会把真实表头单独渲染成一张无数据的表（idx 靠前），
  // 数据表则没有 th，首行数据被误当表头。此处把两者拼回：
  // 数据表首行像数据 + 存在列数一致的纯表头表 → 用真表头，且把误当表头的数据行放回数据。
  const headerOnly = candidates.filter((c) => !c.allCellRows.length && c.headerCells.length >= 3);
  const usedHeader = new Set();
  candidates.forEach((c) => {
    if (!c.allCellRows.length) return;
    if (orderListMode && orderIdx.has(c.idx)) {
      // 订单查询页：每张订单独立成表，跳过粘性表头合并，原样保留数据行
      c.rows = c.allCellRows.map((r) => { const p = r.slice(); while (p.length < c.headerCells.length) p.push(""); return p; });
      return;
    }
    if (looksLikeDataRow(c.headerCells)) {
      // 被误当「表头」的那一行本来就是数据，恢复进 rows
      const origDataRow = c.headerCells.map((s) => String(s).replace(/\s+/g, " ").trim());
      const h = headerOnly.find(
        (x) => !usedHeader.has(x.idx) && x.headerCells.length === c.headerCells.length
      );
      if (h) {
        c.headerCells = h.headerCells; // 用真表头
        usedHeader.add(h.idx);
        c.merged = true;
      } else {
        // 没有可合并的纯表头表：列名留空，后续靠内容嗅探识别角色
        c.headerCells = c.headerCells.map(() => "");
      }
      c.allCellRows.unshift(origDataRow);
    }
    // 补齐短行（跨列行等），统一列数
    c.rows = c.allCellRows.map((r) => {
      const p = r.slice();
      while (p.length < c.headerCells.length) p.push("");
      return p;
    });
  });

  // --- 拼多多订单查询页：每张订单 = 独立 table ---
  // 真实结构（诊断原文确认）：
  //   ① 一张「纯表头模板表」（含 商品信息/订单·售后状态…，0 数据行）
  //   ② 每个订单一张表：首行(合并单元格) = "订单编号：\n<单号>\n复制\n成交时间：<时间>"
  //                        数据行 = [商品信息, 订单/售后状态, 数量, 商品总价, 实收金额, 收货信息, 买家, 操作/备注]
  function isOrderTable(c) {
    if (c.headerCells.length > 4) return false; // 订单表是合并的 2 列行，排除多列表头
    const headText = (c.headerCells || []).join(" ");
    return /订单编号[:：]/.test(headText);
  }

  // 内容兜底分类（仅当数据行列数与模板对不齐时启用）
  function classifyOrderCell(s) {
    const t = String(s || "").trim();
    if (!t) return null;
    if (/ID:\s*\d+/.test(t) && /商品编码[:：]/.test(t)) return "items";
    if (/^(已收货|已发货|待发货|待付款|已取消|交易关闭|已完成|退款中|已退款|待收货|已下单)$/.test(t)) return "order_status";
    if (/^\*{2,}/.test(t)) return "ship_to";
    if (/发起聊天$/.test(t)) return "buyer";
    if (/查看详情|添加备注|修改备注|用户备注|买家留言|物流信息/.test(t)) return "op";
    if (/^\d{1,6}$/.test(t)) return "qty";
    if (/^\d+(\.\d{1,2})?$/.test(t)) return "amount";
    return null;
  }
  function applyClassified(rec, role, val) {
    const v = String(val).trim();
    if (role === "items") { if (v) rec.items.push(v); }
    else if (role === "order_status") { if (v) rec.order_status = v; }
    else if (role === "qty") { if (/^\d+$/.test(v)) rec.qty = String(parseInt(rec.qty || "0", 10) + parseInt(v, 10)); }
    else if (role === "amount") { if (v && !rec.amount) rec.amount = v; }
    else if (role === "ship_to") { if (v) rec.ship_to = v; }
    else if (role === "buyer") { if (v) rec.buyer = v; }
    else if (role === "op") { rec._op = (rec._op ? rec._op + " " : "") + v; }
  }

  // 把一张订单表解析成标准记录
  function parseOrderTable(c, template) {
    const headText = (c.headerCells || []).join("\n");
    const oidM = headText.match(/订单编号[:：]\s*([A-Za-z]*\d[\d\-]{5,})/);
    const oid = oidM ? oidM[1] : "";
    if (!oid) return null;
    const timeM = headText.match(/(?:成交时间|下单时间)[:：]\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/);
    const transTime = timeM ? timeM[1] : "";

    const tCols = template.map((s) => String(s).replace(/\s+/g, " ").trim());
    const at = (label) => tCols.indexOf(label);
    const idx = {
      items: at("商品信息"),
      status: at("订单/售后状态") >= 0 ? at("订单/售后状态") : at("订单状态"),
      qty: at("数量"),
      goods: at("商品总价(元)") >= 0 ? at("商品总价(元)") : at("商品总价"),
      amt: at("实收金额(元)") >= 0 ? at("实收金额(元)") : at("实收金额"),
      ship: at("收货信息"),
      buyer: at("买家"),
      op: at("操作/备注") >= 0 ? at("操作/备注") : at("操作"),
    };

    const rec = {
      order_id: oid, order_status: "", after_sale: "", trans_time: transTime,
      qty: "", goods_total: "", amount: "", tracking_no: "", logistics: "",
      ship_to: "", items: [], buyer: "", remark: "", _op: "",
    };

    (c.allCellRows || []).forEach((row) => {
      const n = row.length;
      const map = {};
      if (n === tCols.length - 1) {
        for (let i = 0; i < n; i++) map[i + 1] = row[i];
      } else if (n === tCols.length) {
        for (let i = 0; i < n; i++) map[i] = row[i];
      } else {
        row.forEach((cell) => { const r = classifyOrderCell(cell); if (r) applyClassified(rec, r, cell); });
        return;
      }
      const v = (i) => (map[i] != null ? String(map[i]).trim() : "");
      const it = v(idx.items); if (it) rec.items.push(it);
      const st = v(idx.status); if (st) rec.order_status = st;
      const q = v(idx.qty); if (q && /^\d+$/.test(q)) rec.qty = String(parseInt(rec.qty || "0", 10) + parseInt(q, 10));
      const g = v(idx.goods); if (g && !rec.goods_total) rec.goods_total = g;
      const a = v(idx.amt); if (a && !rec.amount) rec.amount = a;
      const s = v(idx.ship); if (s) rec.ship_to = s;
      const b = v(idx.buyer); if (b) rec.buyer = b;
      const o = v(idx.op); if (o) rec._op = o;
    });

    const op = rec._op || "";
    if (/物流信息/.test(op)) rec.logistics = "可查(点物流信息)";
    const ub = op.match(/用户备注[:：]\s*(\S+)/);
    const bl = op.match(/买家留言[:：]\s*(\S+)/);
    const parts = [];
    if (ub) parts.push("用户备注：" + ub[1]);
    if (bl) parts.push("买家留言：" + bl[1]);
    rec.remark = parts.join("；");
    if (/(售后|退款)/.test(rec.order_status + " " + op)) rec.after_sale = "有";
    rec.items = rec.items.join(" | ");
    return rec;
  }

  // 把多张订单表解析出的记录合并成一张「订单查询」卡片表（写入汇总库按订单号去重）
  function orderRecordsToCard(recs) {
    const seq = [
      "order_id", "order_status", "after_sale", "trans_time", "qty", "goods_total", "amount",
      "tracking_no", "logistics", "ship_to", "items", "invoice_date", "apply_date",
      "buyer_title", "tax_no", "invoice_kind", "invoice_type", "extra_info", "buyer", "remark",
    ];
    const headers = seq.map((k) => labelOf[k] || k);
    const roleMap = {}; const autoRoles = [];
    seq.forEach((k, i) => { roleMap[i] = k; autoRoles.push(i); });
    const rows = recs.map((r) => seq.map((k) => (r[k] != null ? r[k] : "")));
    return { idx: -1, title: "订单查询（已合并）", headers, roleMap, autoRoles, rows, rowCount: rows.length, cardMode: true, orderMode: true };
  }

  // --- 第三遍：角色映射 + 内容嗅探 +（订单查询页还原）---
  const out = [];
  const orderRecords = [];
  candidates.forEach((c) => {
    // 订单查询页：每张订单独立成表，直接解析为记录，跳过通用表头映射
    if (orderListMode && orderIdx.has(c.idx)) {
      const recs = parseOrderTable(c, orderTemplate);
      if (recs) orderRecords.push(recs);
      return;
    }
    if (!c.rows || !c.rows.length) return;
    const headers = c.headerCells;
    const rows = c.rows;

    const roleMap = {};
    const autoRoles = [];
    // 重复角色仲裁：同一角色被多列命中时，保留命中关键词最长的那列
    // （如「发票抬头」4 字胜过「抬头类型」命中的「抬头」2 字；「订单号」胜过「订单状态」的「订单」）
    const byRole = {};
    headers.forEach((hc, ci) => {
      // 「承诺开票时间」是截止期限不是实际开票时间，明确忽略
      const m = (hc && hc.indexOf("承诺") !== -1) ? null : matchRole(hc, roleKeywords);
      if (m && (!byRole[m.role] || byRole[m.role].score < m.score)) {
        byRole[m.role] = { ci, score: m.score };
      }
    });
    headers.forEach((hc, ci) => {
      const m = (hc && hc.indexOf("承诺") !== -1) ? null : matchRole(hc, roleKeywords);
      if (m && byRole[m.role] && byRole[m.role].ci === ci) {
        roleMap[ci] = m.role;
        autoRoles.push(ci);
      }
    });

    // --- 内容嗅探二次校验（表头常与内容不符，如「开票状态」列里是订单号）---
    function sniff(vals) {
      const vs = vals.filter((v) => v != null && String(v).trim() !== "");
      if (vs.length < 2) return null;
      let order = 0, amount = 0, date = 0;
      vs.forEach((v) => {
        const s = String(v).trim();
        const isDate = /\d{4}[-/年]\d{1,2}[-/月]\d{1,2}/.test(s);
        if (isDate) { date++; return; } // 日期不算订单号
        if (/^\d[\d\-]{7,}(\s|$)/.test(s) || /^\d{8,}$/.test(s.split(/\s+/)[0])) order++;
        if (/[¥￥]/.test(s) || /^\d{1,3}(,\d{3})*(\.\d+)?$/.test(s)) amount++;
      });
      const n = vs.length;
      if (date / n >= 0.6) return "invoice_date";
      if (order / n >= 0.6) return "order_id";
      if (amount / n >= 0.6) return "amount";
      return null;
    }

    // 1) 已被表头映射为 invoice_date、但内容明显是订单号、且没有订单号列 → 纠正为 order_id
    const hasOrderCol = Object.values(roleMap).indexOf("order_id") !== -1;
    if (!hasOrderCol) {
      headers.forEach((hc, ci) => {
        if (roleMap[ci] !== "invoice_date") return;
        const s = sniff(rows.slice(0, 30).map((r) => r[ci]));
        if (s === "order_id") {
          roleMap[ci] = "order_id";
        }
      });
    }
    // 2) 表头没匹配上的列，按内容补角色（只补订单号/金额/日期三类高置信度特征）
    headers.forEach((hc, ci) => {
      if (roleMap[ci]) return;
      if (hc && hc.indexOf("承诺") !== -1) return; // 「承诺开票时间」非实际开票时间
      const s = sniff(rows.slice(0, 30).map((r) => r[ci]));
      if (s) {
        // 该角色已被占用则不抢
        if (Object.values(roleMap).indexOf(s) === -1) {
          roleMap[ci] = s;
          autoRoles.push(ci);
        }
      }
    });

    out.push({ idx: c.idx, headers, roleMap, autoRoles, rows, rowCount: rows.length });
  });
  if (orderRecords.length) out.push(orderRecordsToCard(orderRecords));
  return { tables: out };
}

// ===== 注入：点击「下一页」（必须自包含）=====
// 返回 { clicked, sel }；找不到或已禁用返回 { clicked: false }
function clickNextPage() {
  const visible = (el) => !!(el && el.offsetParent !== null);
  const disabled = (el) =>
    /(^|\s)(disabled|ant-pagination-disabled)/.test(String(el.className || "")) ||
    el.getAttribute("aria-disabled") === "true" ||
    (el.closest && el.closest("[disabled]"));

  // 1) 常见分页组件类名
  const sels = [
    ".ant-pagination-next",
    "li[class*=next]",
    "[class*=pagination] [class*=next]",
    "[class*=pager] [class*=next]",
    "button[aria-label*=ext i]",
    "a[aria-label*=ext i]",
  ];
  for (const s of sels) {
    for (const el of document.querySelectorAll(s)) {
      if (!visible(el) || disabled(el)) continue;
      el.click();
      return { clicked: true, sel: s };
    }
  }
  // 2) 文本兜底：「下一页」/ >
  const cands = Array.from(
    document.querySelectorAll("button, a, li, span[role=button], div[role=button], span[class*=next], div[class*=next]")
  );
  for (const el of cands) {
    const t = (el.innerText || "").trim();
    if (t !== "下一页" && t !== ">" && t !== "»") continue;
    if (!visible(el) || disabled(el)) continue;
    el.click();
    return { clicked: true, sel: "text:" + t };
  }
  return { clicked: false };
}

// ===== 注入：页面内容签名（用于判断翻页后是否真的换页了）=====
function pageSignature() {
  let txt = "";
  const ts = Array.from(document.querySelectorAll("table"));
  for (const tb of ts) txt += tb.innerText.slice(0, 2000) + "|";
  if (!txt) txt = document.body ? document.body.innerText.slice(0, 2000) : "";
  return txt.slice(0, 3000);
}

// ===== UI 辅助 =====
function $(id) { return document.getElementById(id); }

function log(msg, type) {
  const el = $("log");
  const line = document.createElement("div");
  line.className = "line" + (type ? " " + type : "");
  const ts = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  line.textContent = `[${ts}] ${msg}`;
  if (el) el.prepend(line);
}

function refreshLibCount() {
  chrome.storage.local.get("invoice_records", (d) => {
    const n = Array.isArray(d.invoice_records) ? d.invoice_records.length : 0;
    $("lib-count").textContent = `汇总库：${n} 条`;
  });
}

// ===== 关键词管理 =====
function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

// 取当前平台关键词：自定义模式从 storage 读，否则读预设
function getActiveKeywords(cb) {
  const plat = $("platform").value;
  if (plat === "custom") {
    chrome.storage.local.get("custom_keywords", (d) => {
      cb(d.custom_keywords && typeof d.custom_keywords === "object"
        ? d.custom_keywords
        : deepClone(PLATFORM_PRESETS.pdd.keywords));
    });
  } else {
    cb(deepClone(PLATFORM_PRESETS[plat].keywords));
  }
}

function loadPlatformSelector() {
  const sel = $("platform");
  // 填充平台选项
  Object.keys(PLATFORM_PRESETS).forEach((k) => {
    const o = document.createElement("option");
    o.value = k;
    o.textContent = PLATFORM_PRESETS[k].name;
    sel.appendChild(o);
  });
  const oc = document.createElement("option");
  oc.value = "custom";
  oc.textContent = "自定义";
  sel.appendChild(oc);

  chrome.storage.local.get("last_platform", (d) => {
    sel.value = d.last_platform || "pdd";
    onPlatformChange();
  });

  sel.addEventListener("change", onPlatformChange);
  $("btn-kw").addEventListener("click", toggleKwEditor);
  $("btn-kw-save").addEventListener("click", saveCustomKeywords);
  $("btn-kw-reset").addEventListener("click", resetCustomKeywords);
}

function onPlatformChange() {
  const plat = $("platform").value;
  chrome.storage.local.set({ last_platform: plat });
  const isCustom = plat === "custom";
  $("kw-bar").hidden = !isCustom;
  if (isCustom) {
    chrome.storage.local.get("custom_keywords", (d) => {
      const kw = d.custom_keywords && typeof d.custom_keywords === "object"
        ? d.custom_keywords
        : deepClone(PLATFORM_PRESETS.pdd.keywords);
      $("kw-edit").value = JSON.stringify(kw, null, 2);
    });
  }
  log(`已切换平台：${plat === "custom" ? "自定义" : PLATFORM_PRESETS[plat].name}`);
}

function toggleKwEditor() {
  const ed = $("kw-editor");
  ed.hidden = !ed.hidden;
}

function saveCustomKeywords() {
  let parsed;
  try {
    parsed = JSON.parse($("kw-edit").value);
  } catch (e) {
    $("kw-msg").textContent = "❌ JSON 格式错误，未保存";
    $("kw-msg").className = "kw-msg err";
    return;
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    $("kw-msg").textContent = "❌ 需为 { 角色: [关键词...] } 对象";
    $("kw-msg").className = "kw-msg err";
    return;
  }
  chrome.storage.local.set({ custom_keywords: parsed }, () => {
    $("kw-msg").textContent = "✅ 已保存，抓取时生效";
    $("kw-msg").className = "kw-msg ok";
    log("自定义关键词已保存", "ok");
  });
}

function resetCustomKeywords() {
  chrome.storage.local.set({ custom_keywords: deepClone(PLATFORM_PRESETS.pdd.keywords) }, () => {
    $("kw-edit").value = JSON.stringify(PLATFORM_PRESETS.pdd.keywords, null, 2);
    $("kw-msg").textContent = "已恢复默认（拼多多）关键词";
    $("kw-msg").className = "kw-msg";
    log("自定义关键词已恢复默认", "ok");
  });
}

// ===== 抓取 =====
function grab() {
  $("status").textContent = "正在抓取本页表格…";
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || !tab.url || !(tab.url.indexOf("http") === 0)) {
      $("status").textContent = "请先在电商商家后台打开页面";
      log("当前页面不是网页（http/https），请切换后重试", "err");
      return;
    }
    getActiveKeywords((kw) => {
      activeKeywords = kw;
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractTables,
        args: [kw, FIELDS],
      }, (res) => {
        if (chrome.runtime.lastError) {
          $("status").textContent = "抓取失败";
          log("抓取异常：" + chrome.runtime.lastError.message, "err");
          return;
        }
        const data = res && res[0] && res[0].result;
        if (!data || !data.tables.length) {
          $("status").textContent = "本页未识别到表格";
          log("未发现可抓取的表格（确认页面已加载、且是表格形式展示）", "warn");
          renderTables([]);
          return;
        }
        lastTables = data.tables;
        $("grab-count").textContent = `本次抓取：${data.tables.length} 张表 / ${data.tables.reduce((s, t) => s + t.rowCount, 0)} 行`;
        $("status").textContent = "抓取完成，可校正列角色后「追加」";
        log(`识别到 ${data.tables.length} 张表，共 ${data.tables.reduce((s, t) => s + t.rowCount, 0)} 行`, "ok");
        renderTables(data.tables);
      });
    });
  });
}

// ===== 抓取全部页（自动翻页）=====
const MAX_PAGES = 200;
let grabbingAll = false;

function injectOnce(tabId, func, args) {
  return new Promise((resolve) => {
    chrome.scripting.executeScript({ target: { tabId }, func, args: args || [] }, (res) => {
      if (chrome.runtime.lastError) { resolve(null); return; }
      resolve(res && res[0] && res[0].result !== undefined ? res[0].result : null);
    });
  });
}

function activeTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      resolve(tab && tab.url && tab.url.indexOf("http") === 0 ? tab : null);
    });
  });
}

function getKeywordsPromise() {
  return new Promise((resolve) => getActiveKeywords(resolve));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// 等待页面内容变化（最多 8 秒）
async function waitPageChange(tabId, oldSig) {
  for (let i = 0; i < 16; i++) {
    await sleep(500);
    const sig = await injectOnce(tabId, pageSignature, []);
    if (sig && sig !== oldSig) return true;
  }
  return false;
}

async function grabAll() {
  if (grabbingAll) { log("已有一次「抓取全部页」在进行中", "warn"); return; }
  const tab = await activeTab();
  if (!tab) {
    $("status").textContent = "请先在电商商家后台打开页面";
    log("当前页面不是网页（http/https），请切换后重试", "err");
    return;
  }
  grabbingAll = true;
  $("btn-grab-all").disabled = true;
  try {
    const kw = await getKeywordsPromise();
    activeKeywords = kw;
    log("开始抓取全部页：每页抓取后立即入库（按订单号去重），中断后重跑不丢数据");
    let page = 1;
    let totalAdded = 0, totalMerged = 0, totalRows = 0;
    while (page <= MAX_PAGES) {
      $("status").textContent = `抓取全部页：第 ${page} 页…（请保持弹窗打开）`;
      const sig = await injectOnce(tab.id, pageSignature, []);
      const data = await injectOnce(tab.id, extractTables, [kw, FIELDS]);
      if (!data || !data.tables.length) {
        log(`第 ${page} 页未识别到表格，停止`, "warn");
        break;
      }
      const r = await mergeTablesIntoLib(data.tables);
      totalAdded += r.added;
      totalMerged += r.merged;
      totalRows += r.rows;
      lastTables = data.tables;
      renderTables(data.tables);
      refreshLibCount();
      log(`第 ${page} 页：新增 ${r.added}，合并 ${r.merged}（累计 ${totalRows} 行）`, "ok");
      // 翻页
      const clickRes = await injectOnce(tab.id, clickNextPage, []);
      if (!clickRes || !clickRes.clicked) {
        log("没有下一页了，抓取完成", "ok");
        break;
      }
      const changed = await waitPageChange(tab.id, sig);
      if (!changed) {
        log("翻页后页面未变化，停止（可能已是最后一页或翻页失败）", "warn");
        break;
      }
      page++;
    }
    $("status").textContent = `抓取全部页完成：${page} 页，新增 ${totalAdded} / 合并 ${totalMerged} 条`;
    log(`全部页抓取完成：共 ${page} 页，新增 ${totalAdded} 条，合并 ${totalMerged} 条`, "ok");
  } finally {
    grabbingAll = false;
    $("btn-grab-all").disabled = false;
  }
}

// ===== 渲染表格卡片 =====
function renderTables(tables) {
  const box = $("tables");
  box.innerHTML = "";
  if (!tables.length) {
    box.innerHTML = '<div class="empty">暂无可抓取的表格</div>';
    return;
  }
  tables.forEach((t, ti) => {
    const card = document.createElement("div");
    card.className = "table-card";

    const head = document.createElement("div");
    head.className = "tc-head";
    const titleText = t.title ? t.title : `表 #${t.idx + 1}`;
    head.innerHTML = `<span class="tc-title">${titleText}</span><span class="tc-info">${t.rowCount} 行 × ${t.headers.length} 列 · 自动识别 ${t.autoRoles.length} 列</span>`;
    card.appendChild(head);

    const cols = document.createElement("div");
    cols.className = "cols";
    t.headers.forEach((h, ci) => {
      const isAuto = t.autoRoles.indexOf(ci) !== -1;
      const wrap = document.createElement("div");
      wrap.className = "col" + (isAuto ? " auto" : "");
      const sel = document.createElement("select");
      const cur = t.roleMap[ci] || "";
      const optNone = document.createElement("option");
      optNone.value = "";
      optNone.textContent = "忽略";
      sel.appendChild(optNone);
      FIELDS.forEach((f) => {
        const o = document.createElement("option");
        o.value = f.key;
        o.textContent = f.label;
        if (f.key === cur) o.selected = true;
        sel.appendChild(o);
      });
      sel.className = cur ? "assigned" : "";
      sel.addEventListener("change", () => {
        lastTables[ti].roleMap[ci] = sel.value;
        sel.className = sel.value ? "assigned" : "";
      });
      const name = document.createElement("span");
      name.className = "col-name";
      name.textContent = h || "(空列名)";
      name.title = h;
      wrap.appendChild(name);
      wrap.appendChild(sel);
      cols.appendChild(wrap);
    });
    card.appendChild(cols);

    const prev = document.createElement("div");
    prev.className = "preview";
    const tbl = document.createElement("table");
    const thead = document.createElement("tr");
    t.headers.forEach((h, ci) => {
      const th = document.createElement("th");
      const role = t.roleMap[ci];
      th.textContent = role ? ROLE_LABEL[role] + "｜" + h : h;
      thead.appendChild(th);
    });
    tbl.appendChild(thead);
    t.rows.slice(0, 5).forEach((r) => {
      const tr = document.createElement("tr");
      r.forEach((c) => {
        const td = document.createElement("td");
        td.textContent = c;
        tr.appendChild(td);
      });
      tbl.appendChild(tr);
    });
    prev.appendChild(tbl);
    card.appendChild(prev);

    box.appendChild(card);
  });
}

// ===== 追加到汇总库（Promise 版，供手动追加与自动翻页共用）=====
// 返回 { added, merged, skipped, rows }
function mergeTablesIntoLib(tables) {
  return new Promise((resolve) => {
    const plat = $("platform").value;
    const sourceLabel = plat === "custom" ? "invoice-harvester/custom" : "invoice-harvester/" + plat;
    chrome.storage.local.get("invoice_records", (d) => {
      const lib = Array.isArray(d.invoice_records) ? d.invoice_records.slice() : [];
      let added = 0;
      let merged = 0;
      let skipped = 0;
      let rows = 0;
      const now = new Date().toISOString();

      tables.forEach((t) => {
        const colOf = {};
        Object.keys(t.roleMap).forEach((ci) => {
          const role = t.roleMap[ci];
          if (role) colOf[role] = parseInt(ci, 10);
        });
        t.rows.forEach((r) => {
          rows++;
          const rec = {};
          FIELDS.forEach((f) => {
            const ci = colOf[f.key];
            rec[f.key] = ci != null && r[ci] != null ? r[ci] : "";
          });
          rec.captured_at = now;
          rec.platform = plat;
          rec.source = sourceLabel;
          rec.order_id = IH_LIB.cleanOrderId(rec.order_id); // 剥离「订单号 逾期未开票」类混合文本
          const oid = (rec.order_id || "").trim();
          if (!oid) { skipped++; return; } // 无订单号的行（跨列行等）不入库
          const exist = lib.find((x) => (x.order_id || "").trim() === oid);
          if (exist) {
            // 按订单号合并：只补空字段（发票页 + 订单页信息自动拼合）
            FIELDS.forEach((f) => {
              if (!exist[f.key] && rec[f.key]) exist[f.key] = rec[f.key];
            });
            merged++;
          } else {
            lib.push(rec);
            added++;
          }
        });
      });

      chrome.storage.local.set({ invoice_records: lib }, () => {
        resolve({ added, merged, skipped, rows });
      });
    });
  });
}

function append() {
  if (!lastTables) {
    log("请先点「抓取本页」", "warn");
    return;
  }
  mergeTablesIntoLib(lastTables).then((r) => {
    refreshLibCount();
    let msg = `追加完成：新增 ${r.added} 条，合并补充 ${r.merged} 条`;
    if (r.skipped) msg += `，跳过无订单号行 ${r.skipped} 条`;
    log(msg, "ok");
  });
}

// ===== 导出 CSV =====
function exportCsv() {
  chrome.storage.local.get("invoice_records", (d) => {
    const lib = Array.isArray(d.invoice_records) ? d.invoice_records : [];
    if (!lib.length) {
      log("汇总库为空，无可导出数据", "warn");
      return;
    }
    const header = FIELDS.map((f) => f.label);
    const lines = [header.join(",")];
    lib.forEach((rec) => {
      const row = FIELDS.map((f) => csvCell(rec[f.key] != null ? rec[f.key] : ""));
      lines.push(row.join(","));
    });
    const csv = "﻿" + lines.join("\r\n"); // BOM 保证 Excel 中文不乱码
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const dt = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `电商开票汇总_${dt}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    log(`已导出 ${lib.length} 条到 CSV`, "ok");
  });
}

function csvCell(v) {
  const s = String(v == null ? "" : v);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// ===== 导出 XLSX（内联 SheetJS，免 Python）=====
function exportXlsx() {
  chrome.storage.local.get("invoice_records", (d) => {
    const lib = Array.isArray(d.invoice_records) ? d.invoice_records : [];
    if (!lib.length) {
      log("汇总库为空，无可导出数据", "warn");
      return;
    }
    if (typeof XLSX === "undefined") {
      log("XLSX 库未加载，请改用 CSV 导出或重启插件", "err");
      return;
    }
    const includeGrouped = $("opt-group") ? $("opt-group").checked : true;
    const sheets = IH_LIB.buildSheets(lib, { includeGrouped });
    let wb;
    try {
      wb = IH_LIB.sheetsToWorkbook(sheets, XLSX);
    } catch (e) {
      log("生成工作簿失败：" + e.message, "err");
      return;
    }
    const dt = new Date().toISOString().slice(0, 10);
    try {
      XLSX.writeFile(wb, `电商开票汇总_${dt}.xlsx`); // 浏览器环境自动触发下载
      const extra = includeGrouped ? "（含「按抬头汇总」sheet）" : "";
      log(`已导出 ${lib.length} 条到 XLSX${extra}`, "ok");
    } catch (e) {
      log("导出 XLSX 失败：" + e.message, "err");
    }
  });
}

// ===== 清空库 =====
function clearLib() {
  if (!confirm("确定清空本地汇总库？此操作不可撤销。")) return;
  chrome.storage.local.set({ invoice_records: [] }, () => {
    refreshLibCount();
    log("汇总库已清空", "warn");
  });
}

// ===== 诊断：复制本页所有表格的原始表头与首行（适配新平台用）=====
function copyDiag() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || !tab.url || !(tab.url.indexOf("http") === 0)) {
      log("请先打开商家后台页面再诊断", "warn");
      return;
    }
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const tables = Array.from(document.querySelectorAll("table")).map((tbl, idx) => {
          const allRows = Array.from(tbl.querySelectorAll("tr"));
          const headerRow = allRows.find((r) => r.querySelector("th")) || allRows[0];
          const headers = headerRow
            ? Array.from(headerRow.querySelectorAll("th, td")).map((c) => c.innerText.trim())
            : [];
          const dataRows = allRows.filter((r) => r !== headerRow);
          const firstRow = dataRows[0]
            ? Array.from(dataRows[0].querySelectorAll("th, td")).map((c) => c.innerText.replace(/\s+/g, " ").trim())
            : [];
          return { idx, totalRows: dataRows.length, headers, firstRow };
        });
        return { url: location.href, title: document.title, tables };
      },
    }, (res) => {
      const data = res && res[0] && res[0].result;
      if (!data) {
        log("诊断失败：页面注入异常", "err");
        return;
      }
      const text = JSON.stringify(data, null, 2);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          () => {
            $("status").textContent = "诊断信息已复制到剪贴板";
            log("诊断信息已复制（含本页所有表格的原始表头+首行），粘贴发给开发者即可精确适配", "ok");
          },
          () => prompt("剪贴板不可用，请手动复制：", text)
        );
      } else {
        prompt("请手动复制诊断信息：", text);
      }
    });
  });
}

// ===== 初始化 =====
document.addEventListener("DOMContentLoaded", () => {
  loadPlatformSelector();
  $("btn-grab").addEventListener("click", grab);
  $("btn-grab-all").addEventListener("click", grabAll);
  $("btn-append").addEventListener("click", append);
  $("btn-export-csv").addEventListener("click", exportCsv);
  $("btn-export-xlsx").addEventListener("click", exportXlsx);
  $("btn-diag").addEventListener("click", copyDiag);
  $("btn-clear").addEventListener("click", clearLib);
  refreshLibCount();
  log("就绪。选择平台 → 打开对应商家后台发票/订单页 → 点「抓取本页」");
});
