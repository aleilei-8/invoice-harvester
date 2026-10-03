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
      courier: ["快递公司", "承运公司", "承运商", "物流公司", "快递"],
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

    candidates.push({ idx, el: tbl, headerCells, allCellRows: dataRows.map(cellTexts) });
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

  // --- 表外物流信息配对（平面文本法，v2.5.1）---
  // 真实 DOM（用户诊断确认）：拼多多订单页物流行渲染在订单 <table> 之外（totalRows=2），
  // 且 v2.5 的「表外元素扫描」在真实页面上采不到任何块（诊断 outerLogi=[]，容器结构与假设不符）。
  // 因此放弃 DOM 结构假设，改用 document.body.innerText 平面文本：
  //   ① 按文本顺序列出所有「订单编号：xxx」出现位置；
  //   ② 对每个「物流信息：」出现位置，归属到它前面最近的那个订单编号
  //     （物流行在视觉上必然紧跟自己的订单，innerText 顺序 = 视觉顺序，天然正确）；
  //   ③ 物流段文本截到下一个「物流信息」或「订单编号」为止（集运仓分段 = 同订单多段）。
  function collectLogiFromBody() {
    const map = {}; // orderId -> [物流段文本, ...]
    let raw = "";
    try { raw = (document.body && document.body.innerText) || ""; } catch (e) { return map; }
    const txt = String(raw).replace(/\s+/g, " ");
    if (!txt) return map;
    // 所有「订单编号：xxx」出现位置 → 每单构成一个文本窗口 [本单编号结尾, 下一单编号开头)
    const ids = [];
    const idRe = /订单编号[:：]\s*([A-Za-z]*\d[\d\-]{5,})/g;
    let m;
    while ((m = idRe.exec(txt)) !== null) ids.push({ oid: m[1], start: m.index, end: m.index + m[0].length });
    if (!ids.length) return map;
    // 只在「本单窗口」内找物流段：比全局「最近前置编号」更稳，不受侧栏/其它区域文本干扰。
    // 标签冒号可选（部分平台/集运仓组件渲染为「物流信息」无冒号）；操作列按钮虽同名，
    // 但后续 parseLogisticsRow 只有在「公司词 + 紧跟运单号」同时成立时才会产出内容，故无副作用。
    const labelRe = /物流信息\s*[:：]?/g;
    for (let i = 0; i < ids.length; i++) {
      const from = ids[i].end;
      const to = i + 1 < ids.length ? ids[i + 1].start : txt.length;
      const win = txt.slice(from, to);
      const hits = [];
      let mm;
      labelRe.lastIndex = 0;
      while ((mm = labelRe.exec(win)) !== null) hits.push(mm.index);
      if (!hits.length) continue;
      for (let k = 0; k < hits.length; k++) {
        const s = hits[k];
        const e = k + 1 < hits.length ? hits[k + 1] : win.length;
        const seg = win.slice(s, e).trim();
        if (seg) (map[ids[i].oid] = map[ids[i].oid] || []).push(seg);
      }
    }
    return map;
  }

  const logiById = orderIdx.size ? collectLogiFromBody() : {};

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

  // 从物流段文本提取「快递公司 + 快递单号」（支持分段物流）
  // 真实样例（诊断/截图确认，注意单号与「复制」之间**无空格**，集运仓单的公司名后可能带路由标识 HK）：
  //   物流信息：极兔速递 JT3169616537749复制 您的快件已签收…（江千红，17770199665）…
  //   物流信息：中通快递 79017338059807复制 您的快件已送达…【孙雨：15862222167】…
  //   物流信息：集运仓🟢 消费者（二段物流） 极兔速递HK JT0024585595081复制 🟢 包裹已从…
  // 规则：
  //   ① 快递公司 = 纯中文(2~10字)结尾为 快递/速运/速递/邮政/货运/物流/包裹/快运/专递 的词
  //      （「邮政快递包裹」是中国邮政官方名），允许带 ≤6 位拉丁路由后缀（极兔速递HK → 极兔速递）。
  //   ② 运单号：取公司词**之后紧邻**的一段「字母数字 + 空格」（遇到中文即止，故「复制」「您的」之后
  //      的正文与电话天然被切掉），在这段里挑**最长且含数字**的字母数字串作为运单号。
  //      这样「极兔速递 HK JT0024585595081」（公司名与 HK 之间有空格）也能正确得到 JT0024585595081，
  //      而首字符必须是字母数字 —— 行文「联系兔兔快递员（…）」「（二段物流）」后接中文，会被直接排除。
  function parseLogisticsRow(rec, rowText) {
    const text = String(rowText || "").replace(/物流信息\s*[:：]?/, " ");
    const courierRe = /([\u4e00-\u9fa5]{2,10}(?:快递|速运|速递|邮政|货运|物流|包裹|快运|专递))[A-Za-z]{0,6}/g;
    const zoneRe = /^[\s\u3000]*(?:复制)?[\s\u3000]*([A-Za-z0-9][A-Za-z0-9\s\u3000]{0,40})/;
    const couriers = [];
    const waybills = [];
    let m;
    while ((m = courierRe.exec(text)) !== null) {
      const zm = text.slice(m.index + m[0].length).match(zoneRe);
      if (!zm) continue; // 公司词后不是紧跟字母数字（如「二段物流）」「兔兔快递员（」）→ 非本公司
      const runs = zm[1].match(/[A-Za-z0-9]{6,40}/g) || [];
      const wb = runs.filter((r) => /\d/.test(r)).sort((a, b) => b.length - a.length)[0];
      if (wb) {
        couriers.push(m[1]);
        waybills.push(wb);
      }
    }
    if (couriers.length) {
      rec.courier = Array.from(new Set(couriers)).join("、");
      rec.tracking_no = Array.from(new Set(waybills)).join("、");
      if (!rec.logistics) rec.logistics = rec.courier + " " + rec.tracking_no;
    }
  }

  // --- 宽松兜底解析：主流程（中文快递公司 + 紧跟运单号）没结果时启用 ---
  // 覆盖两类真实情况：
  //   ① 快递公司是英文/拉丁名（J&T Express、SF Express 等），courierRe 的纯中文规则匹配不到；
  //   ② 物流块标签不是「物流信息」（集运仓组件可能渲染成「物流详情」「包裹信息」或干脆无标签）。
  // 策略：在文本里找所有 ≥8 位且含数字的字母数字串，排除日期/电话后取「最靠前」的那个
  //       （物流段里运单号紧跟公司名，位置必然最靠前，电话/网点号都在后面）。
  function parseLogisticsLoose(rec, text) {
    if (rec.tracking_no) return;
    const t = String(text || "");
    if (!t) return;
    // ⚠️ 必须有物流语义标签才启用，并且只在该标签**之后**搜索：
    //    否则商品行里的「ID: 655442592834」「商品编码: 1688-818421643724」会被误当成运单号。
    const labelM = t.match(/物流信息\s*[:：]?|运单号\s*[:：]|快递单号\s*[:：]|快递公司\s*[:：]|承运商\s*[:：]/);
    if (!labelM) return;
    const scope = t.slice(labelM.index);
    const cands = (scope.match(/[A-Za-z0-9]{8,40}/g) || []).filter((s) => {
      if (!/\d/.test(s)) return false;                 // 必须含数字
      if (/^\d{11}$/.test(s)) return false;            // 手机号
      if (/^\d{4}$/.test(s)) return false;             // 年份片段
      if (/^\d{6,}$/.test(s) && /^(19|20)\d{2}/.test(s)) return false; // 日期数字串
      return true;
    });
    if (!cands.length) return;
    // 去重后取最靠前（位置优先），同位置取最长
    const seen = new Set();
    const uniq = cands.filter((s) => (seen.has(s) ? false : (seen.add(s), true)));
    const wb = uniq.sort((a, b) => scope.indexOf(a) - scope.indexOf(b) || b.length - a.length)[0];
    if (!wb) return;
    // 公司名兜底：取运单号前面紧邻的中文词（2~10 字）或拉丁词（如 J&T / SF / HK）
    const before = scope.slice(0, scope.indexOf(wb));
    const cnm = before.match(/([\u4e00-\u9fa5]{2,10})\s*$/);
    const enm = before.match(/([A-Za-z][A-Za-z&.\-]{1,15})\s*$/);
    rec.tracking_no = wb;
    rec.courier = cnm ? cnm[1] : (enm ? enm[1] : "");
    if (!rec.logistics) rec.logistics = (rec.courier ? rec.courier + " " : "") + wb;
  }

  // --- DOM 锚定：以订单 <table> 为锚点就近找物流文本（与页面具体结构无关）---
  // 拼多多把物流块渲染在订单 table 之外，且包裹层级/组件随订单类型变化（集运仓单尤其特殊），
  // 因此不再假设任何结构，改为两层就近搜索：
  //   策略A 祖先冒泡：从 table 往上走，找最小的「能解析出运单号 且 只含本单一个订单编号」的容器；
  //   策略B 兄弟扫描：物流块是 table 的后继兄弟时，从父节点的 children 向后收集文本，
  //                   遇到下一个「订单编号」即停（不会串到别的订单）。
  // 两层交替向上，任意一层命中即可。
  function probeText(t) {
    const p = {};
    parseLogisticsRow(p, t);
    if (!p.tracking_no) parseLogisticsLoose(p, t);
    return p.tracking_no ? p : null;
  }
  function normText(el) {
    const raw = (el && (el.innerText != null ? el.innerText : el.textContent)) || "";
    return String(raw).replace(/\s+/g, " ").trim();
  }
  // innerText 只含「已渲染可见」文本；物流块若被折叠/未展开（display:none / 懒渲染）会缺失。
  // textContent 含全部节点文本（含隐藏），作为第二路探测可救回这类订单。
  function normTextDeep(el) {
    const raw = (el && el.textContent) || "";
    return String(raw).replace(/\s+/g, " ").trim();
  }
  function probeEl(el) {
    const t = normText(el);
    let hit = t ? probeText(t) : null;
    if (!hit) {
      const t2 = normTextDeep(el);
      if (t2 && t2 !== t) {
        const idCount2 = (t2.match(/订单编号/g) || []).length;
        if (idCount2 <= 1) hit = probeText(t2);
      }
    }
    return hit;
  }
  function scanFollowingSiblings(el) {
    const p = el && el.parentElement;
    if (!p || !p.children) return "";
    const kids = Array.from(p.children);
    const i = kids.indexOf(el);
    if (i < 0) return "";
    const parts = [];
    for (let k = i + 1; k < kids.length; k++) {
      const t = normText(kids[k]);
      if (!t) continue;
      if (/订单编号/.test(t)) break; // 下一个订单开始 → 不再向后取
      parts.push(t);
    }
    return parts.join(" ").trim();
  }
  function collectLogiByDom(tblEl) {
    if (!tblEl) return "";
    let node = tblEl;
    for (let d = 0; node && d < 14; d++) {
      // 策略A：祖先容器（必须只含本单编号，避免跨到别的订单）
      const t = normText(node);
      if (t && t.length >= 20 && t.length < 8000) {
        const idCount = (t.match(/订单编号/g) || []).length;
        if (idCount > 1) break; // 已越过订单卡片边界
        const hit = probeEl(node);
        if (hit) return normTextDeep(node) || t;
      }
      // 策略B：后继兄弟（物流块是 table 的兄弟节点）
      const sib = scanFollowingSiblings(node);
      if (sib) {
        const hit = probeText(sib);
        if (hit) return sib;
      }
      node = node.parentElement;
    }
    return "";
  }

  // 把一张订单表解析成标准记录（logiById：订单号 -> [物流段文本]（表外平面文本配对结果））
  function parseOrderTable(c, template, logiById) {
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
      qty: "", goods_total: "", amount: "", courier: "", tracking_no: "", logistics: "",
      ship_to: "", items: [], buyer: "", remark: "", _op: "",
    };

    (c.allCellRows || []).forEach((row) => {
      const rowText = row.join(" ");
      // 物流行：整行是一段「物流信息：快递公司 运单号 复制 ✅轨迹…」，直接提取快递公司+单号。
      // 判定用「首列以物流信息开头」（冒号可选，兼容集运仓组件），避免把含「物流信息」按钮的
      // 商品行（首列是商品名）误判为物流行而丢掉 商品信息/状态/金额。
      if (/物流信息\s*[:：]/.test(rowText) || /^物流信息/.test(String(row[0] || ""))) {
        parseLogisticsRow(rec, rowText);
        return;
      }
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

    // 表外物流：三路取并集，先到先得（已有值则不再覆盖）
    //   ① DOM 锚定（首选）：以本订单 table 为锚点就近搜索，与页面结构/标签文案无关；
    //   ② 平面文本窗口配对（兜底）：body.innerText 按「订单编号窗口」切段；
    //   ③ 每路解析后都跑一次宽松兜底（公司名为英文、标签非「物流信息」时仍能抓到单号）。
    const domText = collectLogiByDom(c.el);
    if (domText && !rec.tracking_no) {
      parseLogisticsRow(rec, domText);
      parseLogisticsLoose(rec, domText);
    }
    const outerSegs = logiById && logiById[oid];
    if (outerSegs && outerSegs.length && !rec.tracking_no) {
      const joined = outerSegs.join("\n");
      parseLogisticsRow(rec, joined);
      parseLogisticsLoose(rec, joined);
    }

    const op = rec._op || "";
    // 操作列里有「物流信息」按钮但没解析到物流行 → 明确标记，避免导出里出现无法解释的空白
    if (!rec.logistics && /物流信息/.test(op)) rec.logistics = "可查(点物流信息)";
    if (!rec.tracking_no && /物流信息/.test(op) && !rec.courier) rec.courier = "可查(点物流信息)";
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
  // 用户需求（v2.4）：抓取 订单号 / 订单·售后状态 / 物品名称 / 快递公司 / 快递单号（分两列），
  // 收货信息、买家等不抓；导出时与发票页数据按订单号合并补齐。
  function orderRecordsToCard(recs) {
    const seq = ["order_id", "order_status", "items", "courier", "tracking_no"];
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
      const recs = parseOrderTable(c, orderTemplate, logiById);
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
    const sourceLabel = plat === "custom" ? "ecom-order-helper/custom" : "ecom-order-helper/" + plat;
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
    a.download = `电商订单信息汇总_${dt}.csv`;
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
      XLSX.writeFile(wb, `电商订单信息汇总_${dt}.xlsx`); // 浏览器环境自动触发下载
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
          const rowsText = dataRows.slice(0, 4).map((r) =>
            Array.from(r.querySelectorAll("th, td")).map((c) => c.innerText.replace(/\s+/g, " ").trim()).join(" ¦ ")
          );
          const firstRow = dataRows[0]
            ? Array.from(dataRows[0].querySelectorAll("th, td")).map((c) => c.innerText.replace(/\s+/g, " ").trim())
            : [];
          return { idx, totalRows: dataRows.length, headers, firstRow, rowsText };
        });
        // 物流配对（与本扩展抓取逻辑一致的「订单窗口」法：直接验证「订单号→物流段」配对）
        const logiMap = {};
        try {
          const txt = String((document.body && document.body.innerText) || "").replace(/\s+/g, " ");
          const ids = [];
          const idRe = /订单编号[:：]\s*([A-Za-z]*\d[\d\-]{5,})/g;
          let mm;
          while ((mm = idRe.exec(txt)) !== null) ids.push({ oid: mm[1], start: mm.index, end: mm.index + mm[0].length });
          const labelRe = /物流信息\s*[:：]?/g;
          for (let i = 0; i < ids.length; i++) {
            const from = ids[i].end;
            const to = i + 1 < ids.length ? ids[i + 1].start : txt.length;
            const win = txt.slice(from, to);
            const hits = [];
            let m2;
            labelRe.lastIndex = 0;
            while ((m2 = labelRe.exec(win)) !== null) hits.push(m2.index);
            for (let k = 0; k < hits.length; k++) {
              const s = hits[k];
              const e = k + 1 < hits.length ? hits[k + 1] : win.length;
              const seg = win.slice(s, e).trim();
              if (seg) (logiMap[ids[i].oid] = logiMap[ids[i].oid] || []).push(seg);
            }
          }
        } catch (e) { /* 忽略 */ }
        const outerLogi = Object.keys(logiMap).slice(0, 80).map((oid) => ({
          oid,
          segs: logiMap[oid].map((s) => s.slice(0, 400)),
        }));
        // DOM 锚定探针（与抓取逻辑同源）：逐张订单表输出就近抓到的容器文本，
        // domText 为空 = 该订单周围压根没有物流文本（可据此判断是结构问题还是未渲染）
        const normEl = (el) => String((el && (el.innerText != null ? el.innerText : el.textContent)) || "").replace(/\s+/g, " ").trim();
        const logiProbe = [];
        Array.from(document.querySelectorAll("table")).forEach((tbl, idx) => {
          const h = normEl(tbl);
          const om = h.match(/订单编号[:：]\s*([A-Za-z]*\d[\d\-]{5,})/);
          if (!om) return;
          let node = tbl, found = "";
          for (let d = 0; node && d < 14 && !found; d++) {
            const t = normEl(node);
            if (t && t.length >= 20 && t.length < 8000) {
              const idCount = (t.match(/订单编号/g) || []).length;
              if (idCount <= 1) {
                if (/物流信息|快递|速递|速运|运单|包裹/.test(t)) found = t;
              } else { break; }
            }
            if (!found && node.parentElement && node.parentElement.children) {
              const kids = Array.from(node.parentElement.children);
              const i = kids.indexOf(node);
              if (i >= 0) {
                const parts = [];
                for (let k = i + 1; k < kids.length; k++) {
                  const tt = normEl(kids[k]);
                  if (!tt) continue;
                  if (/订单编号/.test(tt)) break;
                  parts.push(tt);
                }
                const s = parts.join(" ").trim();
                if (s && /物流信息|快递|速递|速运|运单|包裹/.test(s)) found = s;
              }
            }
            node = node.parentElement;
          }
          logiProbe.push({ idx, oid: om[1], domLen: found.length, domText: found.slice(0, 400) });
        });
        return { url: location.href, title: document.title, outerLogi, logiProbe, tables };
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
