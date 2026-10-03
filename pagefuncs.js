// ===== 页面注入函数库（pagefuncs.js）=====
// 本文件同时被两处使用：
//   ① popup.html 加载 —— 弹窗内直接调用这些函数做「抓取本页 / 诊断」；
//   ② 通过 chrome.scripting.executeScript({files:["pagefuncs.js"]}) 注入商家后台页面，
//      让「抓取全部页」的循环能在**页面内**运行（弹窗被关掉也不会中断）。
// 所有函数必须自包含（executeScript 序列化只带函数源码，不带闭包变量）。
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
  // 港澳台/跨境件（集运仓、二段物流）的快递公司常以**繁体**渲染：
  // 「極兔速遞HK JT0024585595081」——简体词表匹配不到「速遞」，导致整条丢弃。
  // 此处统一转简体输出，避免同一快递出现繁简两种写法。
  const T2S = { "遞": "递", "運": "运", "貨": "货", "郵": "邮", "專": "专", "圓": "圆", "順": "顺", "豐": "丰", "韻": "韵", "達": "达", "龍": "龙", "東": "东", "蘇": "苏", "寧": "宁", "廈": "厦", "門": "门", "廣": "广", "國": "国", "際": "际", "優": "优", "極": "极", "網": "网", "絡": "络", "標": "标", "準": "准", "聯": "联", "華": "华", "飛": "飞", "臺": "台", "灣": "湾", "遠": "远", "騰": "腾", "訊": "讯", "鐵": "铁", "電": "电", "車": "车", "環": "环", "遞": "递" };
  function toSimp(s) {
    return String(s || "").replace(/[遞運貨郵專圓順豐韻達龍東蘇寧廈門廣國際優極網絡標準聯華飛臺灣遠騰訊鐵電車環]/g, (c) => T2S[c] || c);
  }

  function parseLogisticsRow(rec, rowText) {
    const text = String(rowText || "").replace(/物流信息\s*[:：]?/, " ");
    const courierRe = /([\u4e00-\u9fa5]{2,10}(?:快递|速运|速递|邮政|货运|物流|包裹|快运|专递|快遞|速遞|貨運|郵政|專遞|快運|承運|速運))[A-Za-z]{0,6}/g;
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
        couriers.push(toSimp(m[1]));
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
    // 公司名兜底：优先取运单号前面紧邻的中文词（2~10 字，含繁体则转简体）；
    // 「極兔速遞HK JT0024585595081」这类中文名 + 路由后缀（HK）的写法，需回溯跳过拉丁后缀。
    const before = scope.slice(0, scope.indexOf(wb));
    const cnm = before.match(/([\u4e00-\u9fa5]{2,10})\s*(?:[A-Za-z]{1,6})?\s*$/);
    const enm = before.match(/([A-Za-z][A-Za-z&.\-]{1,15})\s*$/);
    rec.tracking_no = wb;
    rec.courier = cnm ? toSimp(cnm[1]) : (enm ? enm[1] : "");
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
        parseLogisticsLoose(rec, rowText); // 冗余保护：异体字/英文公司名时仍能抓到单号
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

// ===== 注入：分页器识别（必须自包含）=====
// 为什么必须「先定位分页器容器」：拼多多等自研分页器的真实形态（用户诊断截图确认）是
//   ‹  1  18  19  20  21  22  ›        共有 436 条  每页 20 条
// 若在全页面范围内找「纯数字元素」，数量列（1/3）、消息角标（17）、站内信（3）、时间片段
// 都会被当成页码候选 → 点到无关元素 → 页面不变 → 循环误判结束（这是「抓全部页只抓到 1 页」的元凶之一）。
// 因此先按「容器」结构定位分页条：一个不含 table 的容器，其直接子元素里有 ≥2 个互不相同的纯数字。
function pagerInfo() {
  const vis = (el) => !!(el && el.offsetParent !== null);
  const numOf = (el) => {
    const t = String((el && el.innerText) || "").trim();
    return /^\d{1,4}$/.test(t) ? parseInt(t, 10) : 0;
  };
  let list = [];
  try { list = Array.from(document.querySelectorAll("div, ul, ol, nav, section, span")); } catch (e) { list = []; }
  let best = null;
  for (const el of list) {
    if (el.closest && el.closest("table")) continue; // 表格里的数字单元格不是分页器
    const kids = Array.from(el.children || []);
    if (kids.length < 2 || kids.length > 40) continue;
    const nums = kids.filter((k) => numOf(k) > 0 && vis(k));
    if (nums.length < 2) continue;
    const uniq = [];
    nums.forEach((k) => { const n = numOf(k); if (uniq.indexOf(n) === -1) uniq.push(n); });
    if (uniq.length < 2) continue;
    // 类名含 pag/pager/page/PGT 的容器优先（真实分页器几乎都带这类 class）
    const cc = String(el.className || "") + " " + String((el.parentElement && el.parentElement.className) || "");
    const bonus = /pag|pager|page|PGT/i.test(cc) ? 20 : 0;
    const score = bonus + uniq.length * 4 + nums.length - kids.length;
    if (!best || score > best.score) best = { el, nums, uniq, score };
  }
  if (!best) return null;
  let cur = 0;
  for (const k of best.nums) {
    const c = String(k.className || "");
    let aria = "";
    try { aria = String((k.getAttribute && k.getAttribute("aria-current")) || ""); } catch (e) { aria = ""; }
    if (/(^|[^a-z])(active|current|selected|checked)([^a-z]|$)/i.test(c) || aria === "page") {
      cur = numOf(k);
      break;
    }
  }
  let total = 0;
  best.uniq.forEach((n) => { if (n > total) total = n; });
  // 总页数用「共有 N 条 / 每页 M 条」交叉校验（分页器被省略号截断时更准）
  try {
    const t = String((document.body && document.body.innerText) || "").replace(/\s+/g, " ");
    const tm = t.match(/共\s*(?:有)?\s*([\d,]+)\s*条/);
    const pm = t.match(/每页\s*(\d+)\s*条/);
    if (tm && pm) {
      const n = parseInt(String(tm[1]).replace(/[^\d]/g, ""), 10);
      const per = parseInt(pm[1], 10);
      if (n > 0 && per > 0) {
        const calc = Math.ceil(n / per);
        if (calc > total) total = calc;
      }
    }
  } catch (e) { /* 忽略 */ }
  return { el: best.el, nums: best.nums, pages: best.uniq, cur, total };
}

// 点击分页器里的指定页码（返回 { clicked, sel } 或 null；未识别到分页器时返回 null）
function clickPageNumber(n) {
  if (!n || n < 1) return null;
  const p = pagerInfo();
  if (!p) return null;
  const t = String(n);
  const el = p.nums.filter((k) => String((k.innerText || "")).trim() === t)[0];
  if (!el) return null;
  try { el.click(); } catch (e) { return null; }
  return { clicked: true, sel: "pager-num:" + n };
}

// ===== 注入：点击「下一页」（必须自包含）=====
// 多策略（电商后台分页器五花八门：antd / 自研 / 无限滚动）：
//   ⓪ 分页器容器内优先：先点「目标页码（默认 当前页+1）」，再点容器内的「下一页」箭头
//   ① 类名与语义属性（pagination-next / aria-label=下一页 …）
//   ② 文本「下一页 / › / »」
//   ③ 点「当前激活页码 + 1」（自研分页器图标点击无效时最可靠）
//   ④ 跳页输入框填目标页码（targetPage 由调用方维护）
//   ⑤ 滚动到底（兼容无限滚动）
// 返回 { clicked, sel }；全部失败返回 { clicked:false, reason }
function clickNextPage(targetPage) {
  const visible = (el) => !!(el && el.offsetParent !== null);
  const disabled = (el) =>
    /(^|\s)(disabled|ant-pagination-disabled)/.test(String(el.className || "")) ||
    el.getAttribute("aria-disabled") === "true" ||
    el.disabled === true ||
    (el.closest && el.closest("[disabled]"));
  const hit = (el, tag) => {
    if (!el || !visible(el) || disabled(el)) return null;
    try { el.click(); } catch (e) { return null; }
    return { clicked: true, sel: tag };
  };
  let allCands = [];
  try { allCands = Array.from(document.querySelectorAll("button, a, li, span, i, div")); } catch (e) { allCands = []; }

  // ① 类名 / 语义属性
  const sels = [
    ".ant-pagination-next",
    "[class*=pagination] [class*=next]",
    "[class*=pager] [class*=next]",
    "[class*=page] [class*=next]",
    "li[class*=next]", "button[class*=next]", "a[class*=next]",
    "div[class*=next]", "span[class*=next]", "i[class*=next]",
    "button[aria-label*=下一页]", "a[aria-label*=下一页]",
    "[title*=下一页]", "[aria-label*=Next i]", "[title*=Next i]",
  ];

  // ⓪ 分页器容器内优先（最精确：不会点到表格里的数量/角标数字）
  let pg = null;
  try { pg = pagerInfo(); } catch (e) { pg = null; }
  if (pg) {
    const want = (targetPage && targetPage > 1) ? targetPage : (pg.cur > 0 ? pg.cur + 1 : 0);
    if (want) {
      const w = String(want);
      const numEl = pg.nums.filter((k) => String((k.innerText || "")).trim() === w)[0];
      const rNum = numEl ? hit(numEl, "pager-num:" + want) : null;
      if (rNum) return rNum;
    }
    for (const s of sels) {
      let l = [];
      try { l = Array.from(pg.el.querySelectorAll(s)); } catch (e) { l = []; }
      for (const el of l) { const r = hit(el, "pager:" + s); if (r) return r; }
    }
    for (const t of ["下一页", "下页", "后一页", "›", "»", ">"]) {
      for (const el of allCands) {
        if (pg.el.contains && !pg.el.contains(el)) continue;
        if (String(el.innerText || "").trim() !== t) continue;
        const r = hit(el, "pager:text:" + t);
        if (r) return r;
      }
    }
  }

  for (const s of sels) {
    let list = [];
    try { list = Array.from(document.querySelectorAll(s)); } catch (e) { continue; }
    for (const el of list) {
      const r = hit(el, s);
      if (r) return r;
    }
  }

  // ② 文本兜底
  const cands = allCands;
  for (const t of ["下一页", "下页", "后一页", "›", "»", ">"]) {
    for (const el of cands) {
      if ((el.innerText || "").trim() !== t) continue;
      const r = hit(el, "text:" + t);
      if (r) return r;
    }
  }

  // ③ 当前激活页码 + 1
  const numEls = cands.filter((el) => /^\d{1,4}$/.test((el.innerText || "").trim()) && visible(el));
  const active = numEls.find((el) => {
    const c = String(el.className || "");
    return /(^|[^a-z])(active|current|selected|checked|on)([^a-z]|$)/i.test(c) ||
      el.getAttribute("aria-current") === "page" ||
      el.getAttribute("aria-selected") === "true";
  });
  if (active) {
    const n = parseInt((active.innerText || "").trim(), 10);
    const nxt = numEls.find((el) => parseInt((el.innerText || "").trim(), 10) === n + 1);
    const r = hit(nxt, "page+" + n);
    if (r) return r;
  }

  // ④ 跳页输入框（排除「每页条数」类输入框）
  if (targetPage && targetPage > 1) {
    const inputs = Array.from(document.querySelectorAll("input")).filter((el) => {
      if (!visible(el)) return false;
      const hint = String(el.placeholder || "") + " " + String(el.getAttribute("aria-label") || "") + " " + String(el.className || "");
      if (/每页|条\s*\/|size|limit|pageSize/i.test(hint)) return false;
      return /跳|页码|page|jump/i.test(hint);
    });
    for (const inp of inputs) {
      try {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        if (!setter) continue;
        setter.call(inp, String(targetPage));
        inp.dispatchEvent(new Event("input", { bubbles: true }));
        inp.dispatchEvent(new Event("change", { bubbles: true }));
        ["keydown", "keypress", "keyup"].forEach((ev) =>
          inp.dispatchEvent(new KeyboardEvent(ev, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }))
        );
        return { clicked: true, sel: "jump-input:" + targetPage };
      } catch (e) { /* 继续尝试 */ }
    }
  }

  // ⑤ 滚动到底（无限滚动列表兜底）
  try {
    window.scrollTo(0, (document.body && document.body.scrollHeight) || 999999);
    const sc = document.scrollingElement;
    if (sc) sc.scrollTop = sc.scrollHeight;
    return { clicked: true, sel: "scroll" };
  } catch (e) { /* 忽略 */ }

  return { clicked: false, sel: "", reason: "未找到可点击的下一页控件" };
}

// ===== 注入：页面内容签名（用于判断翻页后是否真的换页了）=====
function pageSignature() {
  let txt = "";
  const ts = Array.from(document.querySelectorAll("table"));
  for (const tb of ts) txt += tb.innerText.slice(0, 2000) + "|";
  if (!txt) txt = document.body ? document.body.innerText.slice(0, 2000) : "";
  return txt.slice(0, 3000);
}

// 暴露给「页面内长任务」使用（注入到目标页面的隔离世界里）
if (typeof window !== "undefined") {
  window.__IH_PAGE = { extractTables, clickNextPage, pageSignature, pagerInfo, clickPageNumber };
}

// ===== 页面内长任务：自动翻页抓取全部页（自包含）=====
// 由 popup 注入到商家后台页面执行，进度与结果挂在 window.__IH_GRAB：
//   { running, page, curPage, total, done, note, lastClick, pages: [{ page, tables }] }
// 为什么放在页面里跑：拼多多一页要等 1~3 秒，22 页要几分钟，
// 而浏览器弹窗一旦失焦就被关闭 → 原来跑在弹窗里的循环会被打断，只抓到第 1 页。
// 跑在页面内则弹窗关掉也能继续；popup 只需轮询 window.__IH_GRAB 增量入库。
// v2.7 两处关键修复：
//   ① 开抓前先确认自己在第 1 页。用户常常停在中间页/最后一页（诊断截图：停在 22/22），
//      循环从当前页往后翻自然只剩 1 页 → 这正是「抓全部页却只抓到 1 页」的真正原因。
//   ② 页面右上角加进度浮层：弹窗失焦被关闭后用户仍能看到进度，并可随时「停止抓取」。
async function grabAllInPage(roleKeywords, fields, maxPages) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const G = { running: true, page: 0, curPage: 0, total: 0, done: false, note: "", lastClick: "", pages: [], stop: false };
  try { window.__IH_GRAB = G; } catch (e) { /* 忽略 */ }
  const OV_ID = "__ih_grab_overlay";
  const escHtml = (s) => String(s == null ? "" : s).replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : (c === "<" ? "&lt;" : "&gt;")));

  // ---- 页面内进度浮层（挂到 documentElement，与 body 同级，不污染 body.innerText）----
  function ovEnsure() {
    let el = null;
    try { el = document.getElementById(OV_ID); } catch (e) { el = null; }
    if (el) return el;
    try {
      el = document.createElement("div");
      el.id = OV_ID;
      el.setAttribute("style", [
        "position:fixed", "z-index:2147483647", "right:18px", "top:18px", "width:316px",
        "box-sizing:border-box", "padding:13px 15px", "border-radius:12px",
        "background:#0f1a2e", "color:#e9f0ff", "text-align:left",
        "font:13px/1.7 -apple-system,BlinkMacSystemFont,'Microsoft YaHei',sans-serif",
        "box-shadow:0 12px 34px rgba(0,0,0,.45)", "border:1px solid rgba(122,170,255,.4)"
      ].join(";"));
      const host = document.documentElement || document.body;
      if (!host || !host.appendChild) return null;
      host.appendChild(el);
    } catch (e) { return null; }
    return el;
  }
  function ovRemove() {
    try {
      const el = document.getElementById(OV_ID);
      if (!el) return;
      if (el.remove) el.remove();
      else if (el.parentNode) el.parentNode.removeChild(el);
    } catch (e) { /* 忽略 */ }
  }
  function ovPaint(cur, total, count, method, finalNote) {
    const el = ovEnsure();
    if (!el) return;
    const curTxt = cur > 0 ? String(cur) : "?";
    const totalTxt = total > 0 ? String(total) : "?";
    const pct = total > 0 && cur > 0 ? Math.min(100, Math.round((cur / total) * 100)) : 0;
    const bar = '<div style="height:6px;border-radius:4px;background:rgba(255,255,255,.14);overflow:hidden;margin:8px 0 6px">'
      + '<div style="height:100%;width:' + pct + '%;background:linear-gradient(90deg,#4c8cff,#39d3b4)"></div></div>';
    const head = finalNote
      ? '<div style="font-weight:600;color:#39d3b4">抓取结束</div>'
      : '<div style="font-weight:600">电商订单信息助手 · 抓取全部页</div>';
    const mid = '<div>已抓 <b style="color:#ffd66b">' + count + '</b> 页 · 当前第 <b>' + curTxt + '</b> / ' + totalTxt + ' 页</div>';
    const tip = method ? '<div style="opacity:.7;font-size:12px">翻页方式：' + escHtml(method) + '</div>' : '';
    const note = finalNote ? '<div style="margin-top:3px;color:#ffd66b">' + escHtml(finalNote) + '</div>' : '';
    const btns = finalNote
      ? '<div style="margin-top:9px"><button data-ih-close style="cursor:pointer;border:0;border-radius:6px;padding:5px 12px;background:#2b3b57;color:#dce8ff;font-size:12px">关闭</button></div>'
      : '<div style="margin-top:9px"><button data-ih-stop style="cursor:pointer;border:0;border-radius:6px;padding:5px 12px;background:#3a2b3f;color:#ffd0d0;font-size:12px">停止抓取</button></div>';
    el.innerHTML = head + mid + bar + tip + note + btns;
    try {
      const sb = el.querySelector("[data-ih-stop]");
      if (sb) sb.addEventListener("click", function () { G.stop = true; });
      const cb = el.querySelector("[data-ih-close]");
      if (cb) cb.addEventListener("click", function () { ovRemove(); });
    } catch (e) { /* 忽略 */ }
  }
  // 等页面真的换页并渲染稳定：先等签名变化，再等连续两次签名一致
  async function waitChange(before) {
    for (let i = 0; i < 30; i++) { // 最多 15 秒
      await sleep(500);
      const s = P.pageSignature();
      if (s && s !== before) {
        let prev = "";
        for (let k = 0; k < 20; k++) {
          await sleep(300);
          const s2 = P.pageSignature();
          if (s2 && s2 === prev) return true;
          prev = s2;
        }
        return true;
      }
    }
    return false;
  }

  const P = window.__IH_PAGE;
  if (!P || typeof P.extractTables !== "function") {
    G.running = false; G.done = true; G.note = "页面函数库未注入";
    return { ok: false, note: G.note };
  }
  const limit = maxPages || 200;
  try {
    // ---- ① 读分页器：拿到「当前页 / 总页数」 ----
    let info = null;
    try { info = typeof P.pagerInfo === "function" ? P.pagerInfo() : null; } catch (e) { info = null; }
    if (info) { G.curPage = info.cur || 0; G.total = info.total || 0; }

    // ---- ② 不在第 1 页 → 先回第 1 页 ----
    if (info && info.cur > 1) {
      ovPaint(info.cur, info.total, 0, "", "当前停在第 " + info.cur + " 页，正在回到第 1 页…");
      const beforeBack = P.pageSignature();
      const back = typeof P.clickPageNumber === "function" ? P.clickPageNumber(1) : null;
      if (back && back.clicked) {
        await waitChange(beforeBack);
      } else {
        G.note = "无法回到第 1 页（分页条里没有可点的「1」），将从当前第 " + info.cur + " 页开始";
      }
      let i2 = null;
      try { i2 = typeof P.pagerInfo === "function" ? P.pagerInfo() : null; } catch (e) { i2 = null; }
      if (i2) { G.curPage = i2.cur || G.curPage; G.total = i2.total || G.total; }
    }
    ovPaint(G.curPage, G.total, 0, "");

    // ---- ③ 逐页抓取 ----
    for (let page = 1; page <= limit; page++) {
      if (G.stop) { G.note = G.note || "已手动停止"; break; }
      G.page = page;
      // 提取（翻页后偶发空表 → 重试，避免误判为最后一页）
      let data = null;
      for (let t = 0; t < 3; t++) {
        data = P.extractTables(roleKeywords, fields);
        if (data && data.tables && data.tables.length) break;
        await sleep(1000);
      }
      if (!data || !data.tables || !data.tables.length) {
        G.note = "第 " + page + " 页（页面第 " + (G.curPage || "?") + " 页）未识别到表格";
        break;
      }
      G.pages.push({ page: page, tables: data.tables });
      ovPaint(G.curPage || page, G.total, G.pages.length, G.lastClick);

      // ---- ④ 翻页：优先按「分页器当前页码 + 1」作为绝对目标 ----
      let cur = 0, total = G.total, i3 = null;
      try { i3 = typeof P.pagerInfo === "function" ? P.pagerInfo() : null; } catch (e) { i3 = null; }
      if (i3) { cur = i3.cur || 0; if (i3.total) total = i3.total; }
      if (cur) G.curPage = cur;
      if (total) G.total = total;
      if (total && cur && cur >= total) { G.note = "已到最后一页（共 " + total + " 页）"; break; }
      const target = cur > 0 ? cur + 1 : page + 1;
      const before = P.pageSignature();
      const clicked = P.clickNextPage(target);
      if (!clicked || !clicked.clicked) {
        G.note = "没有下一页了" + (clicked && clicked.reason ? "（" + clicked.reason + "）" : "");
        break;
      }
      G.lastClick = clicked.sel;
      ovPaint(G.curPage || page, G.total, G.pages.length, G.lastClick);
      const changed = await waitChange(before);
      if (!changed) {
        G.note = "翻页后页面未变化（方式：" + clicked.sel + "）";
        break;
      }
    }
    if (G.stop && !G.note) G.note = "已手动停止";
  } catch (e) {
    G.note = "异常：" + (e && e.message ? e.message : String(e));
  }
  G.running = false;
  G.done = true;
  ovPaint(G.curPage || G.page, G.total, G.pages.length, G.lastClick, G.note || ("已抓取 " + G.pages.length + " 页"));
  sleep(12000).then(ovRemove); // 完成提示 12 秒后自动消失（也可点「关闭」）
  return { ok: true, page: G.page, curPage: G.curPage, total: G.pages.length, note: G.note };
}
