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
// 因此先按「容器」结构定位分页条。
//
// v2.9（用户第二次实测：抓 3 页后卡死，浮层诊断显示「已尝试：pager:[class*="next"]:skipped /
// pager:[class*="next"]:skipped / scroll」）证明**只有结构法远远不够**：那个时刻连一个页码候选
// 都没生成（分页条重渲染后「数字不再是容器的直接子元素」/ 页码窗口里没有目标页），
// 于是整个候选表只剩两个被判定 disabled 的 next 候选 → 直接掉到「滚动到底」这条死路。
// 现在改成三级定位，任一级命中即可：
//   ① 文案锚点法：「每页 N 条」所在的最内层元素 → 向上找含 ≥2 个页码的祖先（最稳）
//   ② 结构法：不含 table、直接子元素里有 ≥2 个互不相同的纯数字的容器（v2.7/v2.8 沿用的那条）
//   ③ 反向法：全页面「可见、不在表格内、不在本扩展浮层内」的纯数字元素 → 共同祖先（最宽）
function pagerRow() {
  const vis = (el) => !!(el && el.offsetParent !== null);
  const clean = (s) => String(s == null ? "" : s).replace(/\s+/g, "");
  const numOf = (el) => {
    const t = clean(el && el.innerText);
    return /^\d{1,4}$/.test(t) ? parseInt(t, 10) : 0;
  };
  const q = (r, s) => {
    try { return (r && r.querySelectorAll) ? Array.prototype.slice.call(r.querySelectorAll(s)) : []; } catch (e) { return []; }
  };
  const ours = (el) => { try { return !!(el && el.closest && el.closest("#__ih_grab_overlay")); } catch (e) { return false; } };
  const inTable = (el) => { try { return !!(el && el.closest && el.closest("table")); } catch (e) { return false; } };
  // 取容器内「最内层」的纯数字元素（页码）：若其后代里还有纯数字元素，它只是外层包装
  function innermostNums(root) {
    const all = q(root, "li, a, button, span, i, b, em, div, label, strong");
    const nums = all.filter((e) => numOf(e) > 0);
    return nums.filter((e) => {
      for (let i = 0; i < nums.length; i++) {
        const o = nums[i];
        if (o === e) continue;
        try { if (e.contains && e.contains(o)) return false; } catch (err) { /* 忽略 */ }
      }
      return true;
    });
  }
  function uniqOf(nums) {
    const u = [];
    for (let i = 0; i < nums.length; i++) { const n = numOf(nums[i]); if (n > 0 && u.indexOf(n) === -1) u.push(n); }
    return u;
  }
  // ① 文案锚点法：分页条旁永远有「每页 N 条」，从这里向上找，一定能找到页码所在容器
  try {
    let anchor = null;
    const cands = q(document, "div, span, em, label, b, strong, i, a, button, li, section, nav, p, ul, ol");
    for (const el of cands) {
      if (!el || ours(el) || inTable(el)) continue;
      const t = clean(el.innerText);
      if (!t || t.length > 40 || !/每页\d+条/.test(t)) continue;
      if (anchor && clean(anchor.innerText).length <= t.length) continue;
      anchor = el;
    }
    if (anchor) {
      let up = anchor, lv = 0;
      while (up && lv++ < 8) {
        const nums = innermostNums(up);
        if (uniqOf(nums).length >= 2) return { el: up, nums: nums, uniq: uniqOf(nums), via: "anchor" };
        up = up.parentElement || null;
      }
    }
  } catch (e) { /* 忽略 */ }
  // ② 结构法
  let list = [];
  try { list = Array.from(document.querySelectorAll("div, ul, ol, nav, section, span")); } catch (e) { list = []; }
  let best = null;
  for (const el of list) {
    if (el.closest && el.closest("table")) continue; // 表格里的数字单元格不是分页器
    if (el && ours && ours(el)) continue;             // 也不能是本扩展自己的进度浮层
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
  if (!best) return reverseRow(); // ③ 反向法
  return { el: best.el, nums: best.nums, uniq: best.uniq, via: "struct" };
}

// ③ 反向法（最后的兜底）：分页条五花八门，但「页码 = 一堆相邻的纯数字」永远成立。
// 取全页面「可见、不在表格内、不在本扩展浮层内」的纯数字元素的共同祖先。
function reverseRow() {
  const vis = (el) => !!(el && el.offsetParent !== null);
  const numOf = (el) => {
    const t = String((el && el.innerText) || "").trim();
    return /^\d{1,4}$/.test(t) ? parseInt(t, 10) : 0;
  };
  const ours = (el) => { try { return !!(el && el.closest && el.closest("#__ih_grab_overlay")); } catch (e) { return false; } };
  const inTable = (el) => { try { return !!(el && el.closest && el.closest("table")); } catch (e) { return false; } };
  const uniqOf = (nums) => {
    const u = [];
    for (let i = 0; i < nums.length; i++) { const n = numOf(nums[i]); if (n > 0 && u.indexOf(n) === -1) u.push(n); }
    return u;
  };
  let all = [];
  try {
    all = Array.prototype.slice.call(document.querySelectorAll("li, a, button, span, i, b, em, div, label, strong"))
      .filter((e) => numOf(e) > 0 && vis(e) && !ours(e) && !inTable(e));
  } catch (e) { all = []; }
  if (all.length < 2 || uniqOf(all).length < 2) return null;
  let up = all[0], lv = 0;
  while (up && lv++ < 10) {
    const inside = [];
    for (let i = 0; i < all.length; i++) {
      try { if (up.contains && up.contains(all[i])) inside.push(all[i]); } catch (e) { /* 忽略 */ }
    }
    if (uniqOf(inside).length >= 2) return { el: up, nums: inside, uniq: uniqOf(inside), via: "reverse" };
    up = up.parentElement || null;
  }
  return null;
}

// ===== 注入：分页器完整信息（当前页 / 总页数 / 页码列表 / 用的是哪级识别法）=====
function pagerInfo() {
  const clean = (s) => String(s == null ? "" : s).replace(/\s+/g, "");
  const numOf = (el) => {
    const t = clean(el && el.innerText);
    return /^\d{1,4}$/.test(t) ? parseInt(t, 10) : 0;
  };
  let row = null;
  try { row = pagerRow(); } catch (e) { row = null; }
  if (!row) return null;
  const nums = row.nums || [];
  const uniq = (row.uniq && row.uniq.length) ? row.uniq : [];
  let cur = 0, total = 0;
  // 当前页：① 自身/父级 class 含 active/current ② aria-current ③ 样式与兄弟明显不同的那个
  for (const k of nums) {
    const c = String(k.className || "");
    let pc = "", aria = "";
    try { pc = String((k.parentElement && k.parentElement.className) || ""); } catch (e) { pc = ""; }
    try { aria = String((k.getAttribute && k.getAttribute("aria-current")) || ""); } catch (e) { aria = ""; }
    if (/(^|[^a-z])(active|current|selected|checked)([^a-z]|$)/i.test(c + " " + pc) || aria === "page" || aria === "true") {
      cur = numOf(k);
      break;
    }
  }
  if (!cur) {
    // 样式兜底：自研分页器常常只给当前页改背景/描边，连 active 类都不加
    try {
      const keys = nums.map((el) => {
        const cs = (typeof window !== "undefined" && window.getComputedStyle) ? window.getComputedStyle(el) : null;
        if (!cs) return "";
        return [cs.backgroundColor, cs.color, cs.borderColor, cs.fontWeight].join("|");
      });
      if (keys.length >= 2 && keys.indexOf("") === -1) {
        const cnt = {};
        keys.forEach((k) => { cnt[k] = (cnt[k] || 0) + 1; });
        const singles = Object.keys(cnt).filter((k) => cnt[k] === 1);
        if (singles.length === 1) cur = numOf(nums[keys.indexOf(singles[0])]);
      }
    } catch (e) { /* 忽略 */ }
  }
  for (let i = 0; i < uniq.length; i++) { if (uniq[i] > total) total = uniq[i]; }
  // 总页数用「共有 N 条 / 每页 M 条」交叉校验（页码被省略号截断时更准）
  try {
    const t = clean((document.body && document.body.innerText) || "");
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
  return { el: row.el, nums: nums, pages: uniq, cur: cur, total: total, via: row.via || "" };
}

// ===== 注入：分页器结构诊断（万一还是认不出分页条，回传这一段即可精确定位）=====
function pagerDump() {
  const clean = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const q = (r, s) => {
    try { return (r && r.querySelectorAll) ? Array.prototype.slice.call(r.querySelectorAll(s)) : []; } catch (e) { return []; }
  };
  const info = (el) => {
    let rect = null;
    const chain = [];
    try {
      const r = el.getBoundingClientRect && el.getBoundingClientRect();
      if (r) rect = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
    } catch (e) { rect = null; }
    try {
      let p = el, n = 0;
      while (p && n++ < 3) { chain.push(String(p.tagName || "") + "." + String(p.className || "")); p = p.parentElement; }
    } catch (e) { /* 忽略 */ }
    return {
      tag: String(el.tagName || ""),
      cls: String(el.className || "").slice(0, 90),
      txt: clean(el.innerText).slice(0, 24),
      rect: rect,
      chain: chain,
    };
  };
  const out = { url: "", via: "", rowText: "", rowHtml: "", nums: [], arrows: [], countText: "", pageSizeText: "", bodyHead: "" };
  try { out.url = String(location.href); } catch (e) { /* 忽略 */ }
  try {
    const row = pagerRow();
    if (row) {
      out.via = row.via || "";
      out.rowText = clean(row.el.innerText).slice(0, 300);
      try { out.rowHtml = String(row.el.outerHTML || "").slice(0, 1500); } catch (e) { out.rowHtml = ""; }
      out.nums = (row.nums || []).slice(0, 30).map(info);
    } else {
      out.via = "none";
    }
  } catch (e) { out.via = "err:" + (e && e.message ? e.message : String(e)); }
  try {
    const t = clean((document.body && document.body.innerText) || "");
    out.countText = (t.match(/共\s*(?:有)?\s*[\d,]+\s*条/) || [""])[0];
    out.pageSizeText = (t.match(/每页\s*\d+\s*条/) || [""])[0];
    out.bodyHead = t.slice(0, 300);
  } catch (e) { /* 忽略 */ }
  try {
    const ar = [];
    for (const el of q(document, "a, button, li, span, i, div, b, em, strong, svg")) {
      if (ar.length >= 40) break;
      const c = String(el.className || "");
      const tx = clean(el.innerText);
      if (!/next|prev|arrow|pag|page|PGT|forward|right|more/i.test(c) &&
        ["下一页", "下页", "›", "»", "❯", "→", ">", "...", "…"].indexOf(tx) === -1) continue;
      ar.push(info(el));
    }
    out.arrows = ar;
  } catch (e) { /* 忽略 */ }
  return out;
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

// ===== 注入：元素可点性判定 + 点击执行（必须自包含）=====
// v2.8 核心：v2.7 的「点一下就认为翻页成功」在真实后台不成立——用户实测浮层显示
// 「翻页方式：pager:li[class*="next"]」但页面纹丝不动。三大原因：
//   ① 命中的元素被装饰层/遮罩盖住，el.click() 到不了真正的按钮；
//   ② handler 绑在 <li> 内部的 <a>/<span> 上，点 <li> 无效；
//   ③ 少数自研组件只认完整鼠标事件序列（pointerdown→mousedown→…→click）。
// 对策：候选元素按可靠度排序 → 逐个点击 → 每个点完等页面「真的换了页」才算成功。

// 是否禁用：class 含 disabled/disable（兼容 PGT-next-disabled / xxx_disabled）
// 或带 aria-disabled / disabled 属性，或近 2 层祖先带禁用类
// v2.9 收紧两处：① 祖先只看 2 层（v2.8 看 4 层，分页条外面的通用包装类一旦含 disable 会把
// 所有候选一起误杀）；② 遇到本扩展自己的进度浮层立即停止上溯。
function isDisabled(el) {
  if (!el) return true;
  const hard = (c) => /(^|[^a-z])(disabled|disable|unclickable)([^a-z]|$)/i.test(String(c == null ? "" : c));
  if (hard(el.className)) return true;
  try {
    if (el.getAttribute && (el.getAttribute("aria-disabled") === "true" || el.getAttribute("aria-disabled") === "1")) return true;
    if (el.hasAttribute && el.hasAttribute("disabled")) return true;
  } catch (e) { /* 忽略 */ }
  if (el.disabled === true) return true;
  try {
    let p = el.parentElement || null, n = 0;
    while (p && n++ < 2) {
      if (p.id === "__ih_grab_overlay") return false;
      if (hard(p.className)) return true;
      p = p.parentElement || null;
    }
  } catch (e) { /* 忽略 */ }
  return false;
}

// 是否「看起来能点」：非禁用 + 有尺寸 + 计算样式没被隐藏
// 拿不到样式信息时（老浏览器 / 单元测试的假 DOM）一律放行，只在明确不可点时拒绝
function elClickable(el) {
  if (!el) return false;
  if (isDisabled(el)) return false;
  try {
    const cs = (typeof window !== "undefined" && window.getComputedStyle) ? window.getComputedStyle(el) : null;
    if (cs) {
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      if (parseFloat(cs.opacity || "1") === 0) return false;
      if (cs.pointerEvents === "none") return false;
    }
  } catch (e) { /* 忽略 */ }
  try {
    if (el.getBoundingClientRect) {
      const r = el.getBoundingClientRect();
      if (r && (r.width < 2 || r.height < 2)) return false;
    }
  } catch (e) { /* 忽略 */ }
  return true;
}

// 执行一次点击：mode="native" 用原生 click（真人点的其实是最内层那个元素），
// mode="events" 额外补发完整鼠标事件序列。两种情况都优先点「中心坐标处最顶层的元素」
function clickEl(el, mode) {
  if (!el) return false;
  const doClick = (t) => {
    if (!t) return;
    if (mode === "events") {
      try {
        const r = t.getBoundingClientRect ? t.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
        const cx = r.left + (r.width || 0) / 2, cy = r.top + (r.height || 0) / 2;
        const o = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0 };
        if (t.dispatchEvent) {
          const mk = (type, Ctor, extra) => {
            try { return new Ctor(type, Object.assign({}, o, extra || {})); } catch (e) { return null; }
          };
          if (typeof PointerEvent === "function") {
            const pd = mk("pointerdown", PointerEvent, { pointerId: 1, pointerType: "mouse", isPrimary: true, buttons: 1 });
            if (pd) t.dispatchEvent(pd);
          }
          const md = mk("mousedown", MouseEvent, { buttons: 1 });
          if (md) t.dispatchEvent(md);
          const mu = mk("mouseup", MouseEvent, { buttons: 0 });
          if (mu) t.dispatchEvent(mu);
          if (typeof PointerEvent === "function") {
            const pu = mk("pointerup", PointerEvent, { pointerId: 1, pointerType: "mouse", isPrimary: true, buttons: 0 });
            if (pu) t.dispatchEvent(pu);
          }
          const ck = mk("click", MouseEvent, { buttons: 0 });
          if (ck) t.dispatchEvent(ck);
        }
      } catch (e) { /* 忽略 */ }
    }
    if (typeof t.click === "function") {
      try { t.click(); } catch (e) { /* 忽略 */ }
    } else if (t.dispatchEvent) {
      try { t.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window })); } catch (e) { /* 忽略 */ }
    }
  };
  let target = null;
  try {
    if (el.getBoundingClientRect && document.elementFromPoint) {
      const r = el.getBoundingClientRect();
      if (r && r.width > 0 && r.height > 0) {
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (hit && hit !== el && !(el.contains && el.contains(hit))) target = hit;
      }
    }
  } catch (e) { /* 忽略 */ }
  if (!target && el.querySelector) {
    try { target = el.querySelector('a, button, [role="button"], svg, i, span'); } catch (e) { target = null; }
  }
  doClick(target || el);
  return true;
}

// 生成「翻到目标页」的候选元素，按可靠度从高到低：
//   ① 分页条内文本 == 目标页码（点它 + 它的父级）
//   ② 当前页码元素往后的第一个非省略号兄弟（结构位置最贴近分页器真实逻辑）
//   ③ 分页条内 next / arrow / forward 类名或语义属性
//   ④ 分页条内箭头文本元素（含其父 li：handler 有时绑在父级）
//   ⑤ **位置法**：分页条里最大页码之后的那个元素（很多自研分页器的箭头没有任何可辨识 class）
//   ⑥ 分页条内「最后一个非页码/非省略号元素」
//   ⑦ 全局 next 类名/属性 → 全局箭头文本 → 全局「激活页码 + 1」（沿用 v2.7/v2.8）
//   ⑧ **全局数字兜底**：页面上任何「文本 == 目标页码」且不在表格内、不在浮层内的可见元素
//      （v2.8 的致命缺口：分页条一旦认错，候选表就是空的，只剩「滚动到底」这条死路）
function pagerCandidates(targetPage) {
  const out = [];
  const seen = [];
  const push = (el, sel, exact) => {
    if (!el || seen.indexOf(el) !== -1) return;
    seen.push(el);
    out.push({ el: el, sel: sel, exact: !!exact });
  };
  const q = (root, s) => {
    try { return (root && root.querySelectorAll) ? Array.prototype.slice.call(root.querySelectorAll(s)) : []; } catch (e) { return []; }
  };
  const txt = (el) => String((el && (el.innerText != null ? el.innerText : el.textContent)) || "").replace(/\s+/g, "");
  const arrowTexts = ["下一页", "下页", "后一页", "›", "»", "❯", "→", ">"];
  const isEllipsis = (t) => !t || t === "..." || t === "…" || t === "•••" || t === "···";
  const ours = (el) => { try { return !!(el && el.closest && el.closest("#__ih_grab_overlay")); } catch (e) { return false; } };
  const inTable = (el) => { try { return !!(el && el.closest && el.closest("table")); } catch (e) { return false; } };
  let pg = null, row = null;
  try { pg = pagerInfo(); } catch (e) { pg = null; }
  try { row = pagerRow(); } catch (e) { row = null; }
  const scope = (row && row.el) || (pg && pg.el) || null;
  const rowNums = (row && row.nums) || (pg && pg.nums) || [];
  const cur = (pg && pg.cur) || 0;
  const want = (targetPage && targetPage > 1) ? targetPage : (cur > 0 ? cur + 1 : 0);
  const w = String(want);
  if (scope) {
    // ① 分页条内精确命中目标页码
    if (want) {
      for (const k of rowNums) {
        if (txt(k) !== w) continue;
        push(k, "pager-num:" + want, true);
        if (k.parentElement) push(k.parentElement, "pager-num-parent:" + want, true);
      }
    }
    // ② 当前页码之后的第一个非省略号兄弟
    let curEl = null;
    for (const k of rowNums) { if (cur > 0 && txt(k) === String(cur)) { curEl = k; break; } }
    if (curEl) {
      let sib = curEl.nextElementSibling || null, g = 0;
      while (sib && g++ < 8) {
        const t = txt(sib);
        if (isEllipsis(t)) { sib = sib.nextElementSibling || null; continue; }
        if (/^\d{1,4}$/.test(t)) {
          if (want && parseInt(t, 10) === want) push(sib, "pager-sib-num:" + t, true);
        } else {
          push(sib, "pager-sib:" + t.slice(0, 4), false);
          if (sib.parentElement) push(sib.parentElement, "pager-sib-parent:" + t.slice(0, 4), false);
        }
        break;
      }
    }
    // 箭头扫描的候选范围：先分页条本身，再放宽到它的父容器。
    // 为什么需要放宽：结构法常常只认到「页码那一小撮」的容器（页码的直接父级），
    // 而左右箭头在那个容器**外面**（真实截图形态）。不放宽就会「页码找到了、箭头却找不到」，
    // 页码窗口里又没有目标页 → 候选表为空 → 直接掉到滚动兜底（用户第二次实测的现场）。
    const scopes = [scope];
    const pgSels = ['[class*="next"]', '[class*="Next"]', '[class*="arrow"]', '[class*="Arrow"]', '[class*="forward"]', '[class*="Forward"]', '[class*="right"]', '[class*="Right"]', "[aria-label*=下一页]", "[title*=下一页]", "[aria-label*=Next]", "[title*=Next]"];
    try {
      const up = scope.parentElement;
      if (up && (!up.parentElement || String(txt(up)).length <= 200)) scopes.push(up);
    } catch (e) { /* 忽略 */ }
    for (let si = 0; si < scopes.length; si++) {
      const sc = scopes[si];
      const tag = si === 0 ? "pager:" : "pagerUp:";
      // ③ 箭头（类名 / 语义属性）
      for (const s of pgSels) {
        for (const el of q(sc, s)) push(el, tag + s, false);
      }
      // ④ 箭头文本（含父级）
      for (const el of q(sc, "li, a, button, span, i, div, svg")) {
        const t = txt(el);
        if (arrowTexts.indexOf(t) === -1) continue;
        push(el, tag + "text:" + t, false);
        if (el.parentElement) push(el.parentElement, tag + "text-parent:" + t, false);
      }
      // ⑤ 位置法：最大页码之后的下一个元素。
      // 先在同级里找；同级没有（页码被包在子容器里）就沿着父级往上，取「那个包装容器的下一个兄弟」。
      // 注意：这里**不能**把「没有文本」当成省略号跳过——图标型箭头本来就没有文本，
      // 恰恰是要找的目标（用户现场那个箭头就是既无 class 关键字、又无文本）。
      if (rowNums.length) {
        let last = null, lastN = 0;
        for (const k of rowNums) { const n = parseInt(txt(k), 10); if (n > lastN) { lastN = n; last = k; } }
        let node = last, found = false, g = 0;
        while (node && !found && g++ < 5) {
          let sib = node.nextElementSibling || null, h = 0;
          while (sib && h++ < 5) {
            const t = txt(sib);
            if (t === "..." || t === "…" || t === "•••" || t === "···") { sib = sib.nextElementSibling || null; continue; }
            push(sib, "pager-after-last:" + t.slice(0, 4), false);
            if (sib.parentElement) push(sib.parentElement, "pager-after-last-parent", false);
            found = true;
            break;
          }
          node = node.parentElement || null;
        }
      }
    }
    // ⑥ 分页条内「最后一个非页码/非省略号元素」
    if (!out.length) {
      let kids = [];
      try { kids = Array.prototype.slice.call(scope.children || []); } catch (e) { kids = []; }
      for (let i = kids.length - 1; i >= 0; i--) {
        const t = txt(kids[i]);
        if (isEllipsis(t) || /^\d{1,4}$/.test(t)) continue;
        push(kids[i], "pager-last:" + t.slice(0, 4), false);
        break;
      }
    }
  }
  const globSels = [".ant-pagination-next", '[class*="pagination"] [class*="next"]', '[class*="pager"] [class*="next"]', "li[class*=next]", "button[class*=next]", "a[class*=next]", "[aria-label*=下一页]", "[title*=下一页]"];
  for (const s of globSels) {
    for (const el of q(document, s)) push(el, s, false);
  }
  for (const t of ["下一页", "下页", "后一页", "›", "»", "❯"]) {
    for (const el of q(document, "a, button, li, span, i")) {
      if (txt(el) !== t) continue;
      push(el, "text:" + t, false);
      if (el.parentElement) push(el.parentElement, "text-parent:" + t, false);
    }
  }
  const numsAll = q(document, "button, a, li, span, i, div").filter((el) => /^\d{1,4}$/.test(txt(el)));
  const act = numsAll.filter((el) => {
    const c = String(el.className || "");
    let aria = "";
    try { aria = String((el.getAttribute && el.getAttribute("aria-current")) || ""); } catch (e) { aria = ""; }
    return /(^|[^a-z])(active|current|selected|checked|on)([^a-z]|$)/i.test(c) || aria === "page";
  })[0];
  if (act) {
    const n = parseInt(txt(act), 10);
    const nx = numsAll.filter((el) => parseInt(txt(el), 10) === n + 1)[0];
    push(nx, "page+" + n, true);
  }
  // ⑧ 全局数字兜底（最后一条路）
  if (want) {
    for (const el of q(document, "li, a, button, span, i, b, em, div, label, strong")) {
      if (txt(el) !== w) continue;
      if (inTable(el) || ours(el)) continue;
      push(el, "num-any:" + want, true);
      if (el.parentElement) push(el.parentElement, "num-any-parent:" + want, true);
    }
  }
  return out;
}

// ===== 注入：翻到目标页（一体化：候选逐个点击 + 逐个验证）=====
// 这是修「翻页无效」的关键函数：不再「点一下就认为成功」，而是
//   候选排序 → 每个候选点一次 → 等最多 ~2.4 秒看页面是否真的换了页 → 没换就试下一个。
// 这样即使命中错元素 / 被遮挡 / 需要完整事件序列，只要候选表里有「真能用的那个」就能翻过去。
// 返回 { clicked, sel, page, mismatch, tried, reason }
async function goToNextPage(targetPage, beforeSig, onTry) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const P = (typeof window !== "undefined" && window.__IH_PAGE) || null;
  const tried = [];
  if (!P) return { clicked: false, sel: "", reason: "页面函数库未注入", tried: tried };
  const sig = () => { try { return P.pageSignature ? P.pageSignature() : ""; } catch (e) { return ""; } };
  const keyOf = () => { try { return P.pageKey ? P.pageKey() : ""; } catch (e) { return ""; } };
  const curOf = () => { try { const i = P.pagerInfo ? P.pagerInfo() : null; return i && i.cur ? i.cur : 0; } catch (e) { return 0; } };
  const base = beforeSig != null ? beforeSig : sig();
  const baseKey = keyOf();
  const tell = (label) => { if (typeof onTry === "function") { try { onTry(label); } catch (e) { /* 忽略 */ } } };
  // 「真的换页了吗」的判定：优先用「页面上的订单号序列」——
  // 它不会像文本签名那样被时间戳/角标/渲染时序骗到（v2.8 用文本签名，会出现「同一页被当成
  // 好几页」的假成功，也会因为噪声把没翻动的页当成翻动了）。拿不到订单号时才退回文本签名。
  const moved = () => {
    const k2 = keyOf();
    if (baseKey && k2) return k2 !== baseKey;
    const s = sig();
    return !!(s && s !== base);
  };
  const waitMoved = async (tries) => {
    for (let k = 0; k < tries; k++) { await sleep(400); if (moved()) return true; }
    return false;
  };
  if (targetPage && curOf() === targetPage) return { clicked: true, sel: "already:" + targetPage, page: targetPage, tried: tried };
  const cands = pagerCandidates(targetPage);
  const rounds = [
    { mode: "native", max: 6, label: "", force: false },
    { mode: "events", max: 3, label: "（事件序列）", force: false },
    // 强制轮：连「看起来被禁用」的候选也点一次。
    // 用户第二次实测现场就是「两个 next 候选都被判 disabled → 一个都不点 → 直接掉到滚动兜底」，
    // 而很多自研分页器的 disabled 只是加了样式，点击 handler 仍在。
    { mode: "events", max: 3, label: "（强制）", force: true }
  ];
  for (const rd of rounds) {
    let n = 0;
    for (const c of cands) {
      if (n >= rd.max) break;
      const okClick = elClickable(c.el);
      if (!okClick && !rd.force) { tried.push(c.sel + ":skipped"); continue; }
      if (targetPage && curOf() === targetPage) return { clicked: true, sel: "already:" + targetPage, page: targetPage, tried: tried };
      n++;
      clickEl(c.el, rd.mode);
      tried.push(c.sel + rd.label + (okClick ? "" : ":force"));
      tell(c.sel + rd.label);
      if (await waitMoved(6)) {
        const page = curOf();
        return { clicked: true, sel: c.sel + rd.label, page: page, mismatch: !!(targetPage && page && page !== targetPage), tried: tried };
      }
    }
  }
  if (targetPage && targetPage > 1) {
    const inputs = [];
    try {
      Array.prototype.slice.call(document.querySelectorAll("input")).forEach((el) => {
        if (!elClickable(el)) return;
        const hint = String(el.placeholder || "") + " " + String((el.getAttribute && el.getAttribute("aria-label")) || "") + " " + String(el.className || "");
        if (/每页|条\s*\/|size|limit|pageSize/i.test(hint)) return;
        if (!/跳|页码|page|jump|go/i.test(hint)) return;
        inputs.push(el);
      });
    } catch (e) { /* 忽略 */ }
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
        tried.push("jump-input:" + targetPage);
        tell("跳页输入框:" + targetPage);
        if (await waitMoved(6)) return { clicked: true, sel: "jump-input:" + targetPage, page: curOf(), tried: tried };
      } catch (e) { /* 继续尝试 */ }
    }
  }
  try {
    tried.push("scroll");
    tell("滚动到底");
    window.scrollTo(0, (document.body && document.body.scrollHeight) || 999999);
    const sc = document.scrollingElement;
    if (sc) sc.scrollTop = sc.scrollHeight;
    if (await waitMoved(6)) return { clicked: true, sel: "scroll", page: curOf(), tried: tried };
  } catch (e) { /* 忽略 */ }
  return { clicked: false, sel: "", reason: "所有翻页方式都试过但页面未变化", tried: tried };
}

// ===== 注入：点击「下一页」（同步单次：取第一个可点候选，供测试与诊断用）=====
// 真正用于「抓取全部页」的是上面的 goToNextPage（带验证）；这个同步版只做单次试探。
// 返回 { clicked, sel, tried }；全部失败返回 { clicked:false, reason }
function clickNextPage(targetPage) {
  const cands = pagerCandidates(targetPage);
  for (const c of cands) {
    if (!elClickable(c.el)) continue;
    clickEl(c.el, "native");
    return { clicked: true, sel: c.sel, tried: [c.sel] };
  }
  if (targetPage && targetPage > 1) {
    const inputs = [];
    try {
      Array.prototype.slice.call(document.querySelectorAll("input")).forEach((el) => {
        const hint = String(el.placeholder || "") + " " + String(el.getAttribute("aria-label") || "") + " " + String(el.className || "");
        if (/每页|条\s*\/|size|limit|pageSize/i.test(hint)) return;
        if (!/跳|页码|page|jump/i.test(hint)) return;
        inputs.push(el);
      });
    } catch (e) { /* 忽略 */ }
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
        return { clicked: true, sel: "jump-input:" + targetPage, tried: ["jump-input:" + targetPage] };
      } catch (e) { /* 继续尝试 */ }
    }
  }
  try {
    window.scrollTo(0, (document.body && document.body.scrollHeight) || 999999);
    const sc = document.scrollingElement;
    if (sc) sc.scrollTop = sc.scrollHeight;
    return { clicked: true, sel: "scroll", tried: ["scroll"] };
  } catch (e) { /* 忽略 */ }
  return { clicked: false, sel: "", reason: "未找到可点击的下一页控件", tried: [] };
}

// ===== 注入：页面内容签名（用于判断翻页后是否真的换页了）=====
function pageSignature() {
  let txt = "";
  const ts = Array.from(document.querySelectorAll("table"));
  for (const tb of ts) txt += tb.innerText.slice(0, 2000) + "|";
  if (!txt) txt = document.body ? document.body.innerText.slice(0, 2000) : "";
  return txt.slice(0, 3000);
}

// ===== 注入：页面「身份指纹」（比 pageSignature 可靠得多）=====
// 把所有订单号（260708-334286067311450 这种 6-15 位形态）按出现顺序拼起来。
// 用途：① 判断翻页是否真的生效；② 判断连续两页是不是同一页（防重复入库 + 防「假翻页」）。
// 它只由订单号构成，不受时间戳、角标、渲染时序噪声影响。
function pageKey() {
  let t = "";
  try { t = String((document.body && document.body.innerText) || ""); } catch (e) { t = ""; }
  if (!t) {
    try {
      const ts = Array.from(document.querySelectorAll("table"));
      for (const tb of ts) t += String(tb.innerText || "") + " ";
    } catch (e) { /* 忽略 */ }
  }
  const ids = [];
  try {
    const re = /(\d{6}-\d{15})(?!\d)/g;
    let m;
    while ((m = re.exec(t)) !== null) {
      if (ids.indexOf(m[1]) === -1) ids.push(m[1]);
      if (ids.length >= 60) break;
    }
  } catch (e) { /* 忽略 */ }
  return ids.join(",");
}

// 暴露给「页面内长任务」使用（注入到目标页面的隔离世界里）
// ver：让弹窗能识别「页面里跑着的循环是不是当前版本的代码」（更新插件后老页面不会自动换代码）
if (typeof window !== "undefined") {
  window.__IH_PAGE_VER = "3.0.7";
  window.__IH_PAGE = {
    ver: "3.0.7", extractTables, clickNextPage, pageSignature, pageKey, pagerInfo, pagerRow,
    clickPageNumber, pagerCandidates, elClickable, clickEl, goToNextPage, pagerDump,
  };
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
  const G = { running: true, page: 0, curPage: 0, total: 0, done: false, note: "", lastClick: "", pagerVia: "", pages: [], stop: false };
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
    const tip = (method || G.pagerVia)
      ? '<div style="opacity:.7;font-size:12px">翻页方式：' + escHtml(method || "—") + (G.pagerVia ? " · 分页器：" + escHtml(G.pagerVia) : "") + '</div>'
      : '';
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
  G.ver = P.ver || ""; // 供弹窗判断「页面里跑的是不是当前版本的循环」
  const limit = maxPages || 200;

  // 翻到目标页并确认真的换了页。
  // v2.8：优先用页面函数库里的 goToNextPage（多候选逐个点击 + 逐个验证）；
  // 若页面里是旧版函数库，则退化为「单次点击 + 等变化」，保证兼容。
  async function goNext(target, before, onTry) {
    if (typeof P.goToNextPage === "function") {
      try {
        return await P.goToNextPage(target, before, onTry);
      } catch (e) {
        return { clicked: false, sel: "", reason: "翻页异常：" + (e && e.message ? e.message : String(e)), tried: [] };
      }
    }
    const r = P.clickNextPage(target);
    if (!r || !r.clicked) return { clicked: false, sel: "", reason: (r && r.reason) || "未找到翻页控件", tried: (r && r.tried) || [] };
    const ok = await waitChange(before);
    return ok
      ? { clicked: true, sel: r.sel, tried: [r.sel] }
      : { clicked: false, sel: r.sel, reason: "翻页后页面未变化（" + r.sel + "）", tried: [r.sel] };
  }

  // 等页面渲染稳定（连续两次签名相同）——翻页后表格可能仍在重绘，抓早了会拿到半张表
  async function waitStable() {
    let prev = "";
    for (let k = 0; k < 20; k++) {
      await sleep(300);
      const s = P.pageSignature();
      if (s && s === prev) return true;
      prev = s;
    }
    return false;
  }

  // 页面身份指纹：优先用订单号序列（可靠），退化到文本签名
  function sigKeyOf() {
    try {
      if (typeof P.pageKey === "function") { const k = P.pageKey(); if (k) return "K:" + k; }
    } catch (e) { /* 忽略 */ }
    try { return "S:" + P.pageSignature(); } catch (e) { return ""; }
  }
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
    let prevKey = ""; // 上一页的「身份指纹」（订单号序列），用于识别「假翻页」
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
      // 假翻页识别：内容与上一页完全相同 → 刚才那次翻页其实没生效，
      // 不能再把同一页当成新页入库（否则「已抓 3 页」里可能有两页是重复的）
      const curKey = sigKeyOf();
      if (prevKey && curKey && curKey === prevKey) {
        G.note = "第 " + page + " 页与上一页内容完全相同（翻页未生效），已停止以免重复；（分页器：" + (G.pagerVia || "未识别") + "）";
        break;
      }
      prevKey = curKey;
      G.pages.push({ page: page, tables: data.tables });
      ovPaint(G.curPage || page, G.total, G.pages.length, G.lastClick);

      // ---- ④ 翻页：目标 = 「分页器当前页码 + 1」 ----
      let cur = 0, total = G.total, i3 = null;
      try { i3 = typeof P.pagerInfo === "function" ? P.pagerInfo() : null; } catch (e) { i3 = null; }
      if (i3) { cur = i3.cur || 0; if (i3.total) total = i3.total; if (i3.via) G.pagerVia = i3.via; }
      if (cur) G.curPage = cur;
      if (total) G.total = total;
      if (total && cur && cur >= total) { G.note = "已到最后一页（共 " + total + " 页）"; break; }
      const target = cur > 0 ? cur + 1 : G.pages.length + 1;
      // 翻页失败允许再试一次（有些后台分页条懒渲染 / 首次点击只是聚焦）。
      // 重试前重读分页器当前页，目标改成「新的当前页 + 1」——绝不按旧目标硬点（会跳页漏抓）。
      let res = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        let tg = target;
        if (attempt > 0) {
          await sleep(1500);
          let i4 = null;
          try { i4 = typeof P.pagerInfo === "function" ? P.pagerInfo() : null; } catch (e) { i4 = null; }
          if (i4 && i4.cur) { G.curPage = i4.cur; tg = i4.cur + 1; }
        }
        const before = P.pageSignature();
        res = await goNext(tg, before, function (lbl) {
          G.lastClick = lbl;
          ovPaint(G.curPage || page, G.total, G.pages.length, lbl);
        });
        if (res && res.clicked) break;
        if (G.stop) break;
        // 「到最后一页 / 找不到控件」不是卡顿，重试没有意义
        if (res && /最后一页|没有下一页|未找到/.test(res.reason || "")) break;
      }
      if (!res || !res.clicked) {
        const why = (res && res.reason) || "未知";
        const tail = (res && res.tried && res.tried.length) ? "（已尝试：" + res.tried.slice(0, 10).join(" / ") + "）" : "";
        const diag = "（分页器：" + (G.pagerVia || "未识别") + "，当前页 " + (G.curPage || "?") + "，目标 " + target + "）";
        // 「找不到控件 / 最后一页」是正常收尾，别吓用户；真的翻不动才报「翻页失败」
        G.note = (/最后一页|没有下一页|未找到/.test(why) ? "没有下一页了（" + why + "）" : "翻页失败：" + why + diag) + tail;
        break;
      }
      G.lastClick = res.sel;
      if (res.page) G.curPage = res.page;
      // 跳页保护：一下子跳到别的页 = 目标页码不在分页条窗口里。
      // 先把目标页点回来；点不回来就停下并说明，绝不静默继续（否则中间那些页会被漏掉）。
      if (res.mismatch && res.page && target && res.page !== target) {
        let fixed = false;
        try {
          const back = typeof P.clickPageNumber === "function" ? P.clickPageNumber(target) : null;
          if (back && back.clicked) { await waitChange(P.pageSignature()); fixed = true; }
        } catch (e) { /* 忽略 */ }
        let i5 = null;
        try { i5 = typeof P.pagerInfo === "function" ? P.pagerInfo() : null; } catch (e) { i5 = null; }
        if (fixed && i5 && i5.cur === target) {
          G.curPage = target;
        } else {
          G.note = "翻页跳页：目标第 " + target + " 页、实际到第 " + res.page + " 页，已停止以免漏页（方式：" + res.sel + "）";
          break;
        }
      }
      ovPaint(G.curPage || page, G.total, G.pages.length, G.lastClick);
      await waitStable(); // 等新一页渲染稳定，再进入下一轮提取
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

// ===== 1688 订单列表：诊断探针（诊断驱动，绝不猜 DOM）=====
// 1688 订单列表多为现代 div 卡片（非 <table>），且运单号常不在列表行内（藏在「查看物流」/官方导出里）。
// 因此先做一次诊断，拿到真实结构后再定稿「自动翻页 + 提取」逻辑，避免盲目写选择器。
function elPath1688(el) {
  try {
    const parts = [];
    let e = el;
    for (let i = 0; i < 6 && e && e.nodeType === 1; i++) {
      let s = e.tagName.toLowerCase();
      if (e.id) s += "#" + e.id;
      else if (e.className && typeof e.className === "string") {
        const cs = e.className.trim().split(/\s+/).slice(0, 2).join(".");
        if (cs) s += "." + cs;
      }
      parts.unshift(s);
      e = e.parentElement;
    }
    return parts.join(" > ");
  } catch (e) { return ""; }
}

// 找「订单卡片」祖先：从含「订单编号」的叶子向上爬，取第一个含多个订单关键字的容器
function firstOrderCard1688() {
  const leaves = Array.from(document.querySelectorAll("*")).filter((el) => {
    const t = (el.innerText || "").slice(0, 30);
    // 放宽：订单编号 / 订单号 / 运单号 任一带货信息即算候选叶子（避免在 iframe 列表里漏抓）
    return /(订单编号|订单号|运单号|物流单号)/.test(t) && el.children.length <= 4;
  });
  if (!leaves.length) return null;
  let el = leaves[0];
  for (let i = 0; i < 12 && el; i++) {
    const txt = (el.innerText || "").replace(/\s+/g, " ");
    const score = (txt.match(/订单编号/g) || []).length
      + (/卖家/.test(txt) ? 1 : 0) + (/实付/.test(txt) ? 1 : 0)
      + (/货品|商品/.test(txt) ? 1 : 0) + (/物流|运单/.test(txt) ? 1 : 0);
    if (score >= 2 && el.querySelectorAll("*").length > 5) return el;
    el = el.parentElement;
  }
  return leaves[0].parentElement || leaves[0];
}

// 安装网络探针：捕获「导出所选订单/导出」触发的 fetch / XHR（含 URL、参数、响应体），
// 用于后续「自动翻页 + 驱动官方导出 + 页内合并为单文件」（官方导出含运单号，fidelity 最高）。
// 1688 导出多为 fetch 下载（response 是 xlsx 二进制或 JSON），这里把响应体也一并捕获：
//   - 文本/JSON：截取前 1200 字符，便于确认数据结构
//   - 二进制（xlsx）：记录字节长度 + 前 32 字节魔数（PK\x03\x04 即 zip/xlsx），供后续解析
// 1688 导出接口网络探针（v3.0.5 起「脚本注入即武装」，无需先点诊断）。
// 目标：捕获官方「导出所选订单/导出全部」提交请求（method+url+body）及其响应，
// 以及最终 xlsx 直链，供后续 grab1688() 程序化重放（按页/时间段分段导出后页内合并）。
function installNetHook1688() {
  try {
    if (window.__IH_NET_HOOKED) return;
    window.__IH_NET_HOOKED = true;
    window.__IH_NET = window.__IH_NET || [];
    window.__IH_EXPORT = window.__IH_EXPORT || null;   // 最近一次导出「提交」请求
    window.__IH_XLSX = window.__IH_XLSX || null;        // 最近一次 xlsx 响应/直链
    const seen = new Set();
    const cap = (info) => {
      try {
        const key = (info.kind || "") + "|" + (info.url || "");
        if (seen.has(key)) return;                       // 去重，避免 beacon/打点刷屏
        if (window.__IH_NET.length >= 120) window.__IH_NET.shift();
        window.__IH_NET.push(info); seen.add(key);
      } catch (e) { /* 忽略 */ }
    };
    // 静态资源（<script>/<link> 不走 XHR/fetch，这里只是兜底过滤）不参与捕获
    const isStatic = (u) => /\.(js|css|woff2?|ttf|png|jpe?g|gif|svg|ico|map|webp)(\?|$)/i.test(u || "");
    // 命中导出/订单/交易/列表/异步任务相关请求（用于标记 __IH_EXPORT）
    const isExport = (u) => /export|download|订单|order|excel|\.xls|trade|列表|list|task|异步|async|query|search/i.test(u || "");
    const isSubmit = (u) => /export|order|trade/i.test(u || "");
    // ── XMLHttpRequest ──（捕获全部非静态请求，导出类额外标记）
    const OW = window.XMLHttpRequest;
    const oxhr = OW.prototype.open;
    OW.prototype.open = function (m, u) { this.__ih_url = String(u); this.__ih_method = m; return oxhr.apply(this, arguments); };
    const osend = OW.prototype.send;
    OW.prototype.send = function (b) {
      const url = this.__ih_url;
      if (!isStatic(url)) {
        const req = { kind: "xhr", method: this.__ih_method, url: url, reqBody: b != null ? String(b).slice(0, 4000) : null, t: Date.now() };
        cap(req);
        if (isSubmit(url)) window.__IH_EXPORT = req;
        const self = this;
        this.addEventListener("load", function () {
          try {
            const ct = (self.getResponseHeader && self.getResponseHeader("content-type")) || "";
            const cd = (self.getResponseHeader && self.getResponseHeader("content-disposition")) || "";
            let snippet = "";
            try { snippet = String(self.responseText || "").slice(0, 1500); } catch (e) { /* 二进制响应读不到文本属正常 */ }
            const info = { kind: "xhr-resp", url: url, status: self.status, contentType: ct, contentDisposition: cd, respHead: snippet, t: Date.now() };
            cap(info);
            if (window.__IH_EXPORT && window.__IH_EXPORT.url === url) window.__IH_EXPORT.resp = info;
          } catch (e) { /* 忽略 */ }
        });
      }
      return osend.apply(this, arguments);
    };
    // ── fetch ──
    const ofetch = window.fetch;
    window.fetch = function (u, o) {
      const url = String(u);
      if (!isStatic(url)) {
        const req = { kind: "fetch", method: (o && o.method) || "GET", url: url, reqBody: (o && o.body) ? String(o.body).slice(0, 4000) : null, t: Date.now() };
        cap(req);
        if (isSubmit(url)) window.__IH_EXPORT = req;
        return ofetch.apply(this, arguments).then(async (resp) => {
          try {
            const ct = (resp.headers && resp.headers.get && resp.headers.get("content-type")) || "";
            const cd = (resp.headers && resp.headers.get && resp.headers.get("content-disposition")) || "";
            if (/attachment/.test(cd) || /excel|xls|zip|octet|download/i.test(ct) || /\.xls/i.test(url)) {
              const buf = await resp.clone().arrayBuffer();
              const head = Array.from(new Uint8Array(buf.slice(0, 8)));
              const info = { kind: "fetch-resp", url: url, isBinary: true, contentType: ct, contentDisposition: cd,
                contentLength: String(buf.byteLength), magicBytes: head,
                isXlsx: (head[0] === 0x50 && head[1] === 0x4B && head[2] === 0x03 && head[3] === 0x04), t: Date.now() };
              cap(info); window.__IH_XLSX = info;
            } else {
              const txt = await resp.clone().text();
              const info = { kind: "fetch-resp", url: url, isBinary: false, contentType: ct, contentDisposition: cd,
                contentLength: String(txt.length), respHead: txt.slice(0, 1500), t: Date.now() };
              cap(info);
              if (window.__IH_EXPORT && window.__IH_EXPORT.url === url) window.__IH_EXPORT.resp = info;
            }
          } catch (e) { /* 响应体读取失败不影响主流程 */ }
          return resp;
        });
      }
      return ofetch.apply(this, arguments);
    };
    // ── 拦截 <a download> 点击，捕获导出文件直链（「下载」按钮多为此形态） ──
    document.addEventListener("click", (e) => {
      try {
        const a = e.target && e.target.closest ? e.target.closest("a") : null;
        if (a && a.href && /\.xls/i.test(a.href)) {
          window.__IH_XLSX = { kind: "anchor", url: a.href, text: (a.innerText || "").slice(0, 40), t: Date.now() };
        }
      } catch (e) { /* 忽略 */ }
    }, true);
  } catch (e) { /* 忽略 */ }
}

// 1688 订单列表诊断：frame 感知 + iframe 枚举 + 列表/分页/字段/导出接口探针。
// 1688 买家工作台是 frame 化 SPA，订单列表常跑在 iframe 子应用里，故诊断必须逐帧进行，
// 否则顶层帧只能看到导航、抓不到订单 DOM、也拦不到 iframe 内的导出请求。
function rectArr(el) {
  const r = (el && el.getBoundingClientRect && el.getBoundingClientRect()) || { x: 0, y: 0, width: 0, height: 0 };
  return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
}

// 渲染感知：1688 订单列表是 Angular SPA，诊断注入时 <app-root> 常尚未注水，
// 必须轮询等到「导出按钮/订单行」出现再采样，否则采到的全是空壳。
function waitForOrderUI(timeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const probe = () => {
      const d = document;
      const exportBtn = Array.from(d.querySelectorAll("button,a,div,[role=button],span"))
        .find((e) => /导出/.test((e.innerText || "").replace(/\s+/g, " ")));
      const rows = d.querySelectorAll("tr").length;
      const cards = d.querySelectorAll('[class*="order"],[class*="Order"]').length;
      const ready = !!exportBtn || rows > 0 || cards > 3;
      if (ready || Date.now() - t0 > timeoutMs) {
        resolve({ waitedMs: Date.now() - t0, ready: !!ready, foundExport: !!exportBtn, rows, cards });
      } else {
        setTimeout(probe, 300);
      }
    };
    probe();
  });
}

async function diagnose1688() {
  const isTop = (window === window.top);
  const out = {
    platform: "1688",
    isTop: isTop,
    inIframe: !isTop,
    frameUrl: location.href,
    frameOrigin: location.origin,
    title: document.title,
    ts: Date.now(),
  };
  const body = (document.body && document.body.innerText || "").replace(/\s+/g, " ");
  out.bodySample = body.slice(0, 500);
  // 本帧是否含订单内容（决定真正的抓取应在哪一帧）
  const orderSignals = {
    order_id: /订单编号|订单号/.test(body),
    seller: /卖家|供应商|供货商|店铺/.test(body),
    courier: /物流公司|承运商/.test(body),
    tracking: /运单号/.test(body),
    amount: /实付款|实付金额|总金额|合计/.test(body),
    logistics: /物流|快递|速递|速运|包裹/.test(body),
  };
  out.inlineFields = orderSignals;
  // 订单帧信号：正文含订单字段「或」URL/标题命中订单列表页（列表卡片可能渲染在跨域子 iframe，
  // 正文读不到，但 frameUrl/title 足以定位真正的订单帧）。
  const urlTitleHit = /buyer-order-list|trade-order-list|已买到的货品|order_list|orderlist/i.test(location.href + " " + document.title);
  out.hasOrderContent = !!(orderSignals.order_id || orderSignals.tracking
    || (orderSignals.logistics && orderSignals.seller) || urlTitleHit);
  out.urlTitleHit = urlTitleHit;
  // 渲染感知：订单帧是 Angular SPA，诊断需等注水完成才能采到真实控件（导出/下一页/全选）
  out.renderWait = null;
  if (urlTitleHit) {
    try { out.renderWait = await waitForOrderUI(8000); } catch (e) { out.renderWait = "err:" + e.message; }
  }
  out.tableCount = document.querySelectorAll("table").length;
  out.sampleOrderIds = (body.match(/[0-9]{15,}/g) || []).slice(0, 6);
  // ── 关键控件探测：全选 / 导出 / 下一页（用于后续自动翻页+驱动导出） ──
  const btnTxt = (el) => ((el.innerText || el.getAttribute("title") || el.getAttribute("aria-label") || el.value || el.alt || "").toString().replace(/\s+/g, " ").trim());
  const clickable = Array.from(document.querySelectorAll("button,a,input,[role=button],[class*='btn'],div,[onclick]"));
  const btnRe = /导出|全选|下一页|上一页|尾页|首页|共\s*\d+\s*页|第\s*\d+\s*页|页$/;
  const btns = [];
  for (const el of clickable) {
    const t = btnTxt(el);
    const lower = t.toLowerCase();
    if (btnRe.test(t) || /export|select.?all|next|prev/i.test(lower)) {
      const r = (el.getBoundingClientRect && el.getBoundingClientRect()) || { width: 0, height: 0 };
      if (r.width === 0 && r.height === 0 && el.tagName !== "A") continue;
      btns.push({ tag: el.tagName, cls: String(el.className || "").slice(0, 80), text: t.slice(0, 40), id: el.id || "", rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] });
    }
  }
  out.buttons = btns.slice(0, 40);
  out.buttonCount = btns.length;
  // 全量可点元素文案（去重、截断）——用于拿到「批量导出」面板的真实按钮文字，据此定稿自动导出
  try {
    out.allButtonTexts = Array.from(document.querySelectorAll("button,a,[role=button],li,span,label"))
      .map(btnTxt).filter((t) => t && t.length <= 24)
      .filter((t, i, a) => a.indexOf(t) === i).slice(0, 90);
  } catch (e) { out.allButtonTexts = []; }
  // 勾选框（全选通常在列表表头）
  const cbs = Array.from(document.querySelectorAll("input[type=checkbox],input[type=radio]"));
  out.checkboxCount = cbs.length;
  out.checkboxSample = cbs.slice(0, 8).map((c) => ({ cls: String(c.className || "").slice(0, 60), id: c.id || "", checked: !!c.checked, ariaLabel: c.getAttribute("aria-label") || "" }));
  // 精确定位导出/翻页/全选控件（供定稿自动抓取直接命中，避免猜选择器）
  const btnTextOf = (e) => ((e.innerText || e.getAttribute("title") || e.getAttribute("aria-label") || "").toString().replace(/\s+/g, " ").trim());
  const findBtn = (re) => Array.from(document.querySelectorAll("button,a,div,[role=button],span,li")).find((e) => re.test(btnTextOf(e)));
  const eb = findBtn(/导出/);
  out.exportButton = eb ? { tag: eb.tagName, cls: String(eb.className || "").slice(0, 90), text: btnTextOf(eb).slice(0, 40), id: eb.id || "", ariaLabel: eb.getAttribute("aria-label") || "", rect: rectArr(eb) } : null;
  const nb = findBtn(/下一页|下页|›|»|next/i);
  out.nextPageButton = nb ? { tag: nb.tagName, cls: String(nb.className || "").slice(0, 90), text: btnTextOf(nb).slice(0, 30), id: nb.id || "", rect: rectArr(nb) } : null;
  const cbAll = Array.from(document.querySelectorAll("input[type=checkbox]")).find((c) => {
    const l = (c.getAttribute("aria-label") || c.getAttribute("title") || (c.closest("[class*='header']") ? "header" : "")).toLowerCase();
    return /全选|select.?all|header|表头/.test(l);
  }) || document.querySelector("input[type=checkbox]");
  out.selectAllCheckbox = cbAll ? { cls: String(cbAll.className || "").slice(0, 60), id: cbAll.id || "", ariaLabel: cbAll.getAttribute("aria-label") || "", inHeader: !!cbAll.closest("[class*='header']") } : null;
  const pt = (document.body && document.body.innerText || "").match(/共\s*\d+\s*页|第\s*\d+\s*\/\s*\d+\s*页|\d+\s*\/\s*\d+\s*页/);
  out.pagerText = pt ? pt[0] : null;
  // 本帧 HTML 取样（截断，便于看清真实按钮 class / 列表结构；跨域子 iframe 内容读不到属正常）
  try { out.htmlSample = (document.body && document.body.innerHTML || "").slice(0, 6000); } catch (e) { out.htmlSample = ""; }
  // 分页器（复用已验证引擎）
  try { out.pager = (typeof pagerInfo === "function") ? pagerInfo() : null; } catch (e) { out.pager = "err:" + e.message; }
  try { out.pagerDump = (typeof pagerDump === "function") ? pagerDump() : null; } catch (e) { out.pagerDump = "err:" + e.message; }
  // 订单卡片容器探测
  const card = firstOrderCard1688();
  out.orderCard = card ? {
    tag: card.tagName, cls: String(card.className || "").slice(0, 90),
    path: elPath1688(card), childCount: card.querySelectorAll("*").length,
  } : null;
  out.sampleCardText = card ? card.innerText.replace(/\s+/g, " ").slice(0, 1500) : null;
  // 列出本帧内的 iframe（顶层帧最关键；订单列表常跑在 iframe 子应用里）
  const iframes = Array.from(document.querySelectorAll("iframe")).map((f) => ({
    src: f.src || "", id: f.id || "", name: f.name || "", cls: String(f.className || "").slice(0, 60),
  }));
  out.iframeCount = iframes.length;
  out.iframes = iframes;
  // 导出接口网络探针（本帧安装；allFrames 注入后每帧都会装，故 iframe 内的导出也能捕获）
  installNetHook1688();
  out.netHook = "若 exportApi 一直为空，说明 content_scripts 未在该页面加载时武装（页面在装扩展前已打开）。点弹窗「武装网络探针」即可免刷新即时武装；或直接点「下载」让 chrome.downloads 捕获 xlsx（不依赖探针）。downloads 字段来自 chrome.downloads 直查，只要点过「下载」就一定有。";
  out.netCaptured = window.__IH_NET ? window.__IH_NET.slice(-12) : [];
  out.exportApi = window.__IH_EXPORT || null;   // 最近一次捕获到的导出「提交」请求（method+url+body+响应）
  out.xlsxCaptured = window.__IH_XLSX || null;  // 最近一次捕获到的 xlsx 直链/响应
  // 直接查询浏览器下载（比仅读 storage 更可靠：只要点过「下载」，这里一定有；
  // 且它不依赖 content_scripts 武装，后台始终在监听 chrome.downloads）
  let dlQuery = [];
  try {
    dlQuery = await new Promise((res) => {
      if (chrome && chrome.downloads && chrome.downloads.query) {
        chrome.downloads.query({ orderBy: ["-startTime"], limit: 12 }, (items) => {
          res((items || [])
            .filter((it) => /\.xls/i.test(it.filename || it.url || ""))
            .map((it) => ({ id: it.id, url: it.url, filename: it.filename, startTime: it.startTime, state: it.state, mime: it.mime })));
        });
      } else res([]);
    });
  } catch (e) { dlQuery = []; }
  out.downloads = dlQuery;
  // 后台已用 SheetJS 自动解析并入库的 1688 订单数（点「下载」后自动产生）
  let a1688 = 0;
  try {
    const s = await new Promise((res) => chrome.storage.local.get({ a1688_orders: [] }, (x) => res(x)));
    a1688 = (s.a1688_orders || []).length;
  } catch (e) { a1688 = 0; }
  out.a1688Count = a1688;
  return out;
}

// 1688 自动抓取（v3.0.12）。
// 血泪教训：**不能靠 URL 正则判断「哪一帧是订单帧」**——g.alicdn.com/platform/xdomain-storage/frame.html
// 这类跨域桥接帧的 hash 里 URL 编码携带了 buyer-order-list.html，会被误判成订单帧，而它内部没有任何控件，
// 于是「共尝试 0 页」。现在改为：① 桥接帧直接跳过；② 以「DOM 里有没有订单/导出控件」为判据；
// ③ 弹窗侧先给所有帧打分选帧（probe1688Frames），再定点执行本函数。
// 导出链（与 1688 买家订单页实际按钮对齐）：
//   优先「导出当前条件」= 当前筛选下的全部订单，一次拿全，不必逐页；
//   兜底「全选 → 导出所选订单 → 下载」逐页导出（每页上限 100/实际 pageSize）。
async function grab1688(opts) {
  opts = opts || {};
  const log = [];
  const L = (m) => { log.push(String(m)); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const TXT = (e) => ((e.innerText || e.textContent || e.getAttribute("title") || e.getAttribute("aria-label") || e.value || "").toString().replace(/\s+/g, " ").trim());
  const visible = (e) => { try { const r = e.getBoundingClientRect(); return !!r && r.width > 0 && r.height > 0; } catch (x) { return false; } };
  // ★ 穿透 Shadow DOM（v3.0.14）：1688 订单列表(air.1688.com)把整块 UI 渲染在 shadow root 内，
  //   querySelectorAll / innerText 默认进不去 → document.body.innerText 只剩 1 个字符、按钮列表为空
  //   （帧体检实证：frame 179 标题=已买到的货品 但 bodyLen=1）。故所有查询都要递归进 shadowRoot。
  const shadowRoots = () => {
    const acc = [];
    const walk = (root) => {
      try { root.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) { acc.push(el.shadowRoot); walk(el.shadowRoot); } }); }
      catch (e) { /* 忽略 */ }
    };
    walk(document);
    return acc;
  };
  const deepAll = (sel) => {
    const out = [];
    try { document.querySelectorAll(sel).forEach((e) => out.push(e)); } catch (e) { /* 忽略 */ }
    shadowRoots().forEach((r) => { try { r.querySelectorAll(sel).forEach((e) => out.push(e)); } catch (e) { /* 忽略 */ } });
    return out;
  };
  const deepText = () => {
    let s = String((document.body && document.body.innerText) || "");
    shadowRoots().forEach((r) => { try { s += " " + String(r.textContent || ""); } catch (e) { /* 忽略 */ } });
    return s.replace(/\s+/g, " ");
  };
  // 只认「短文案 + 可见」的元素并按文案长度升序，避免匹配到包含该字样的外层大容器
  const findBtns = (re, maxLen) => {
    const lim = maxLen || 20;
    return deepAll("button,a,[role=button],span,li,label,div")
      .filter((e) => visible(e))
      .map((e) => ({ e: e, t: TXT(e) }))
      .filter((x) => x.t && x.t.length <= lim && re.test(x.t))
      .sort((a, b) => a.t.length - b.t.length);
  };
  // Angular/React 下单纯 el.click() 偶尔不触发，补发指针事件
  // v3.3.5：不再额外 dispatch 合成 click——原来「合成 click + host.click()」会把页面
  // 点击 handler 触发两次（1688 导出场景实证：一次点击创建两个导出任务 → 下载两份
  // 相同清单，Downloads 里 26779115/26779116 两个连续任务 ID 同秒创建）。
  // 保留 pointer/mouse 按下抬起序列维持按压态，click 只由 host.click() 派发一次。
  const clickEl = (el) => {
    const host = (el.closest && (el.closest("button,a,[role=button]")) || el);
    try { ["pointerdown", "mousedown", "mouseup"].forEach((t) => host.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }))); } catch (e) { /* 忽略 */ }
    try { host.click(); } catch (e) { /* 忽略 */ }
    return TXT(host) || TXT(el);
  };
  // ★ v3.0.15：按「文本节点」反查控件。
  //   起因：deepText 里明明命中「导出按钮」，但 findBtns（要求「可见」+「文案 ≤12 字」）一个都找不到。
  //   说明导出入口此刻没渲染成可见按钮（折叠/懒渲染），或「导出」二字只存在于 <script>/<template> 文本里。
  //   TreeWalker 直接扫文本节点：不触发 innerText 的强制布局、也不依赖元素标签，Shadow DOM 内同样有效。
  const nodesContaining = (kw) => {
    const out = [];
    const seen = [];
    [document].concat(shadowRoots()).forEach((r) => {
      try {
        const tw = document.createTreeWalker(r, NodeFilter.SHOW_TEXT, null, false);
        let n;
        while ((n = tw.nextNode())) {
          if (String(n.nodeValue || "").indexOf(kw) === -1) continue;
          const p = n.parentElement;
          if (!p) continue;
          // 脚本/模板/样式里的字样不是按钮 → 排除（这正是 deepText 会误命中的地方）
          if (/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT|HEAD)$/.test(String(p.tagName || "").toUpperCase())) continue;
          if (seen.indexOf(p) === -1) { seen.push(p); out.push(p); }
        }
      } catch (e) { /* 忽略 */ }
    });
    return out;
  };
  // 把「文字所在元素」提升为真正可点的按钮：最多上溯 5 层，优先 <button>/<a>/role=button，
  // 其次第一个「可见且文案 ≤40 字」的祖先；跨 shadow 边界时用 getRootNode().host 继续往上。
  const elevate = (el) => {
    let cur = el;
    let firstVisible = null;
    for (let i = 0; i < 5 && cur; i++) {
      const tag = String(cur.tagName || "").toLowerCase();
      const role = cur.getAttribute ? cur.getAttribute("role") : "";
      if (tag === "button" || tag === "a" || role === "button") return cur;
      const t = TXT(cur).trim();
      if (visible(cur) && t && t.length <= 40 && !firstVisible) firstVisible = cur;
      cur = cur.parentElement || (cur.getRootNode && cur.getRootNode().host) || null;
    }
    return firstVisible || el;
  };
  // 由「文本关键词」反查可点按钮（跨 Shadow DOM）。kws 是关键词数组，返回去重后的 {e,t} 列表。
  const btnsFromText = (kws) => {
    const seen = [];
    const out = [];
    kws.forEach((kw) => nodesContaining(kw).forEach((p) => {
      const el = elevate(p);
      if (seen.indexOf(el) !== -1) return;
      seen.push(el);
      const t = TXT(el).trim();
      if (t && t.length <= 30) out.push({ e: el, t: t });
    }));
    return out;
  };
  // 找一个含「导出」的可点控件：先精确文案、再兜底任意含关键词的（跨 Shadow DOM）
  const findExportBtn = (exactRe) => {
    const hits = [];
    nodesContaining("导出").forEach((p) => {
      const el = elevate(p);
      const t = TXT(el).trim();
      if (!t || t.length > 40) return;
      if (hits.some((h) => h.e === el)) return;
      hits.push({ e: el, t: t });
    });
    if (!hits.length) return { hits: [], pick: null };
    const exact = hits.filter((h) => exactRe.test(h.t)).sort((a, b) => a.t.length - b.t.length);
    const vis = (exact.length ? exact : hits).filter((h) => visible(h.e));
    return { hits: hits, pick: vis[0] || exact[0] || hits[0] || null };
  };
  // 全量排查日志：把含「导出」的元素连 tag/尺寸/可见性一起摊出来，便于精确定位是「没渲染」还是「渲染了但不可见」
  const dumpExport = (hits) => {
    if (!hits || !hits.length) {
      L("  · 全表（含 ShadowRoot）没有任何含「导出」的元素 → deepText 命中的字样来自 <script>/<template>，导出入口此刻未渲染");
      return;
    }
    L("  · 含「导出」的元素 " + hits.length + " 个，逐个摊开：");
    hits.slice(0, 12).forEach((h, i) => {
      let box = "尺寸未知";
      try { const b = h.e.getBoundingClientRect(); box = Math.round(b.width) + "×" + Math.round(b.height) + " @y" + Math.round(b.top); } catch (e) { /* 忽略 */ }
      L("    " + (i + 1) + ". 「" + h.t.slice(0, 24) + "」 <" + String(h.e.tagName || "").toLowerCase() + "> " + box + (visible(h.e) ? "" : " 【不可见】"));
    });
  };
  // 懒渲染兜底：把窗口与所有可滚动容器滚到底再滚回原位，逼出底部操作栏（1688 常把导出条懒渲染）
  const revealBars = async () => {
    try {
      const y = window.scrollY || 0;
      window.scrollTo(0, (document.body && document.body.scrollHeight) || 0);
      await sleep(700);
      window.scrollTo(0, y);
    } catch (e) { /* 忽略 */ }
    try {
      deepAll("div,section,main,ul,ol,tbody").slice(0, 3000).forEach((e) => {
        try { if (e.clientHeight > 100 && e.scrollHeight > e.clientHeight + 80) e.scrollTop = e.scrollHeight; } catch (x) { /* 忽略 */ }
      });
    } catch (e) { /* 忽略 */ }
    await sleep(1000);
    try { deepAll("div,section,main,ul,ol,tbody").slice(0, 3000).forEach((e) => { try { e.scrollTop = 0; } catch (x) { /* 忽略 */ } }); } catch (e) { /* 忽略 */ }
    await sleep(600);
  };
  const frameUrl = location.href;
  // ① 跨域桥接帧：绝不在这里抓
  if (/xdomain-storage/i.test(frameUrl)) return { skipped: true, reason: "bridge-frame", frame: frameUrl.slice(0, 120), log };
  const bodyText = () => deepText();
  // ② 判据：DOM 里有没有订单导出控件 / 订单字样（不再只看 URL 正则；且穿透 Shadow DOM）
  const hasExportUI = /导出所选订单|导出当前条件|导出全部|导出当前页|批量导出|批量付款/.test(bodyText());
  const urlHit = /buyer-order-list|trade-order-list|已买到的货品|buyList|买家工作台/i.test(frameUrl + " " + document.title);
  if (!opts.force && !hasExportUI && !urlHit) return { skipped: true, reason: "no-order-ui", frame: frameUrl.slice(0, 120), log };
  const srCount = shadowRoots().length;
  L("订单帧开始抓取: " + frameUrl.slice(0, 120));
  L("帧内证据：导出控件=" + (hasExportUI ? "有" : "无") + " / URL或标题命中=" + (urlHit ? "是" : "否") + " / ShadowRoot×" + srCount + " / 可见正文 " + bodyText().length + " 字");
  const allBtns = findBtns(/./, 16).map((x) => x.t).filter((t, i, a) => a.indexOf(t) === i).slice(0, 30);
  L("可见控件：" + (allBtns.length ? allBtns.join(" │ ") : "(空)"));
  const maxPages = opts.maxPages || 200;
  // 读插件「a1688_orders」库当前条数（content script 可直接访问 chrome.storage）
  const getCount = () => new Promise((res) => {
    try { chrome.storage.local.get({ a1688_orders: [] }, (d) => res(Array.isArray(d.a1688_orders) ? d.a1688_orders.length : 0)); }
    catch (e) { res(0); }
  });
  // 自适应等待：后台把 xlsx 解析并入 a1688_orders，轮询条数增长即代表已入库
  const waitDownload = async (since, timeoutMs) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const n = await getCount();
      if (n > since) return n;
      await sleep(1000);
    }
    return await getCount();
  };
  // 找「下载」入口：导出记录列表里的下载可能是 a/button/span/图标，取页面上最上面那一条（最新报表在最上）
  const findDownloadLinks = () => deepAll("a,button,span,div")
    .map((e) => ({ e: e, t: TXT(e).trim() }))
    .filter((x) => /下载/.test(x.t) && x.t.length <= 8 && visible(x.e))
    .sort((a, b) => { try { return a.e.getBoundingClientRect().top - b.e.getBoundingClientRect().top; } catch (x) { return 0; } });
  // 自适应等待「下载」链接出现（导出任务生成需数秒，不再死等固定时长）
  const waitDownloadLink = async (timeoutMs) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const dls = findDownloadLinks();
      if (dls.length) return dls[0].e;
      await sleep(1000);
    }
    return null;
  };
  // 导出常带二次确认弹窗（确定/确认导出/继续）
  const clickConfirm = () => {
    const c = findBtns(/^(确定|确认|确认导出|继续|继续导出|立即导出|好的|我知道了)$/, 10)[0];
    if (c) { const t = clickEl(c.e); L("已点确认弹窗「" + t + "」"); return true; }
    return false;
  };
  // ★ v3.0.16：1688 的「批量导出」弹窗（标题「批量导出」，正文提示"两次导出间隔 ≥5 秒 / 报表保管 30 天"）
  //   两颗按钮是「查看过往导出报表」和「生成新报表」——既不是「确定」也不是「下载」，
  //   旧逻辑只找 确定/确认 就干等，永远等不到 → 这里显式处理。
  //   正确流程：生成新报表 →（等生成）→ 查看过往导出报表 → 点最新那条「下载」。
  const handleExportDialog = async () => {
    await sleep(1200);
    const cand = btnsFromText(["生成", "报表", "导出", "查看"]);
    const uniq = cand.filter((h, i, a) => a.findIndex((x) => x.t === h.t) === i);
    const pick = (re) => uniq.filter((h) => re.test(h.t)).sort((a, b) => a.t.length - b.t.length)[0] || null;
    const gen = pick(/生成新报表|生成报表/) || pick(/^生成/);
    const past = pick(/查看过往导出报表|过往导出报表|导出报表|导出记录/);
    if (!gen && !past) return false;
    L("检测到「批量导出」弹窗，按钮：" + uniq.map((h) => h.t).slice(0, 8).join(" │ "));
    if (gen) { clickEl(gen.e); L("已点击「" + gen.t + "」生成新报表（1688 要求两次导出间隔 ≥5 秒）"); await sleep(5000); }
    let dl = findDownloadLinks()[0];
    if (!dl && past) {
      clickEl(past.e); L("已点击「" + past.t + "」查看导出记录"); await sleep(3000);
      const d2 = await waitDownloadLink(20000);
      if (d2) dl = { e: d2 };
    }
    if (dl) { clickEl(dl.e); L("已点击「下载」"); return true; }
    L("⚠ 已处理导出弹窗，但没捕捉到「下载」链接（若浏览器直接下载，后台仍会入库）");
    return true;
  };
  // 1688 明示「两次导出间隔 ≥5 秒」，逐页导出必须留足间隔，否则会被平台拒
  let lastExportAt = 0;
  const respectExportGap = async () => {
    const need = 6000 - (Date.now() - lastExportAt);
    if (lastExportAt && need > 0) { L("（距上次导出不足 5 秒，等待 " + Math.ceil(need / 1000) + "s）"); await sleep(need); }
    lastExportAt = Date.now();
  };
  // 兜底：1688 保管 30 天内的导出报表 → 把「查看过往导出报表」里能下的都拉一遍。
  // 后台按订单号去重合并，**重复下载无害**，所以历史报表能被这条直接补全。
  const harvestPastReports = async (maxDl) => {
    const past = btnsFromText(["报表", "导出"]).filter((h) => /查看过往导出报表|过往导出报表|导出报表/.test(h.t)).sort((a, b) => a.t.length - b.t.length)[0];
    if (!past) { L("找不到「查看过往导出报表」入口，跳过历史报表兜底"); return 0; }
    clickEl(past.e); L("打开导出记录（「" + past.t + "」）…");
    await sleep(3000);
    let total = 0;
    for (let i = 0; i < (maxDl || 12); i++) {
      const next = findDownloadLinks().find((x) => !x.e.__ihDl);
      if (!next) { if (i === 0) L("导出记录里没有可点的「下载」链接"); break; }
      next.e.__ihDl = true;
      const before = await getCount();
      clickEl(next.e);
      L("点击导出记录里的「下载」（第 " + (i + 1) + " 条）");
      const after = await waitDownload(before, 25000);
      if (after > before) { total += after - before; L("  → 入库 +" + (after - before) + "（库内共 " + after + " 条）"); }
      else L("  → 该条未产生新增（可能已下过/还没生成好）");
      await sleep(1500);
    }
    if (total) L("✅ 历史导出报表兜底：共补入 " + total + " 条");
    return total;
  };
  const clickSelectAll = () => {
    const byTxt = findBtns(/^全选(本页|当前页|全部)?$/, 14)[0];
    if (byTxt) return clickEl(byTxt.e);
    const cb = deepAll("input[type=checkbox]").find((c) => visible(c));
    if (cb) { try { cb.click(); } catch (e) { /* 忽略 */ } return "表头勾选框"; }
    return "";
  };
  // 读取当前页码（1688 分页器常见「X / Y」或高亮数字）
  const curPageNo = () => {
    const txt = bodyText();
    const m = txt.match(/第\s*(\d+)\s*页|(\d+)\s*\/\s*(\d+)\s*页/);
    if (m) return parseInt(m[1] || m[2], 10);
    const cur = deepAll('[aria-current="page"]')[0];
    if (cur) { const n = parseInt(String(TXT(cur)).replace(/\D/g, ""), 10); if (n) return n; }
    return 0;
  };
  // 估算总量（= 总页数 × 每页条数），用于判断「导出当前条件」是否真的一次拿全
  let pageSize = 10;
  try { const ps = parseInt(new URL(frameUrl).searchParams.get("pageSize") || "0", 10); if (ps > 0 && isFinite(ps)) pageSize = ps; } catch (e) { /* 用默认 10 */ }
  let totalPages = 0;
  const pm = bodyText().match(/(\d+)\s*\/\s*(\d+)\s*页?/);
  if (pm) totalPages = parseInt(pm[2], 10) || 0;
  const estTotal = totalPages ? totalPages * pageSize : 0;

  let since = await getCount();
  L("起始库内 " + since + " 条；分页信息：共 " + (totalPages || "?") + " 页 × 每页 " + pageSize + " 条 → 估算总量 " + (estTotal || "未知") + " 条");

  // ── 阶段 A：一次性「导出当前条件」（当前筛选下的全部订单，一次拿全，最省事）──
  L("正在定位导出控件（先滚动一遍，逼出可能懒渲染的底部操作栏）…");
  await revealBars();
  const rA = findExportBtn(/导出当前条件|导出全部符合条件|导出符合当前条件|按当前条件导出|全部导出|导出全部|导出筛选结果/);
  const expAll = rA.pick;
  if (expAll) {
    L("检测到「" + expAll.t + "」，尝试一次性导出当前筛选条件下的全部订单…");
    await respectExportGap();
    clickEl(expAll.e);
    await sleep(1200);
    const dlgA = await handleExportDialog();
    if (!dlgA) {
      clickConfirm();
      const dl = await waitDownloadLink(25000);
      if (dl) { clickEl(dl); L("已点击「下载」"); }
      else L("25s 内未出现「下载」链接（若浏览器直接下载，后台仍会捕获，无需担心）");
    }
    const n = await waitDownload(since, 45000);
    if (n > since) {
      const got = n - since;
      L("一次性导出入库 +" + got + " 条（库内共 " + n + " 条）");
      if (estTotal && got >= estTotal * 0.9) {
        L("✅ 已覆盖估算总量（" + got + "/" + estTotal + "），判定一次拿全，结束抓取");
        return { log, frame: frameUrl.slice(0, 120), exportApi: window.__IH_EXPORT || null, total: n, mode: "exportAll" };
      }
      if (!estTotal && got >= 100) {
        L("✅ 未取得分页信息但已入库 " + got + " 条（≥100），判定一次拿全，结束抓取");
        return { log, frame: frameUrl.slice(0, 120), exportApi: window.__IH_EXPORT || null, total: n, mode: "exportAll" };
      }
      L("⚠ 只拿到 " + got + " 条" + (estTotal ? "（估算总量 " + estTotal + "）" : "") + "，说明「导出当前条件」是页级的，继续逐页补齐（已入库的去重保留）");
      since = n;
    } else {
      L("⚠ 一次性导出未入库 → 试着从「导出记录」把 30 天内的历史报表补全…");
      await harvestPastReports(12);
      const n2 = await getCount();
      if (n2 > since) { L("历史报表补入 +" + (n2 - since) + " 条（库内共 " + n2 + " 条）"); since = n2; }
      else L("导出记录也没有新增，回退到「全选 + 逐页导出所选订单」");
    }
    await sleep(1000);
  } else {
    L("未发现「导出当前条件」按钮，走逐页导出");
    L("── 导出入口排查（含「导出」文本的候选）──");
    dumpExport(rA.hits);
  }

  // ── 阶段 B：逐页「全选 → 导出所选订单 → 下载 → 翻页」──
  let page = 1;
  let stall = 0;
  for (; page <= maxPages; page++) {
    L("── 第 " + page + " 页（库内 " + since + " 条）──");
    const sa = clickSelectAll();
    if (sa) { L("已点击「" + sa + "」"); await sleep(800); }
    else L("⚠ 未找到「全选」控件");
    // 1688 点表头全选后常弹出「全选本页 / 全选全部」二选一，跟着点一次
    const scope = findBtns(/^(全选本页|全选当前页|全选全部|全选所有.*|选择全部.*)$/, 14)[0];
    if (scope && scope.t !== sa) { L("已点全选范围「" + clickEl(scope.e) + "」"); await sleep(800); }
    // 有些站点的导出按钮要在「勾选」之后才渲染出来 → 找不到就再滚动唤醒一次后重扫
    const RE = /导出所选订单|导出选中订单|导出所选|导出当前页|导出选中/;
    let rB = findExportBtn(RE);
    if (!rB.pick) { await revealBars(); rB = findExportBtn(RE); }
    const expSel = rB.pick;
    if (!expSel) {
      L("⚠ 未找到导出按钮，终止");
      L("── 导出入口排查（点过「全选」后仍未出现导出控件）──");
      dumpExport(rB.hits);
      break;
    }
    await respectExportGap();
    clickEl(expSel.e);
    L("已点击「" + expSel.t + "」");
    await sleep(1200);
    const dlgB = await handleExportDialog();
    if (!dlgB) {
      clickConfirm();
      const dl = await waitDownloadLink(25000);
      if (dl) { clickEl(dl); L("已点击「下载」"); }
      else L("25s 内未出现「下载」链接（若浏览器直接下载，后台仍会捕获）");
    }
    const after = await waitDownload(since, 45000);
    if (after > since) { L("已入库（库内 " + after + " 条，+" + (after - since) + "）"); since = after; stall = 0; }
    else {
      stall++;
      L("⚠ 本页未检测到新增（连续 " + stall + " 次）");
      if (stall >= 2) { L("连续两页无新增，判定无法继续导出，结束抓取"); break; }
    }
    await sleep(900);
    // 翻页
    const beforePage = curPageNo();
    const next = findBtns(/下一页|下页|^›$|^»$|^>$|next/i, 8)[0];
    if (next) { clickEl(next.e); L("已点击「下一页」"); }
    else { L("未找到「下一页」按钮（可能已是末页），结束抓取"); break; }
    await sleep(2600);
    const afterPage = curPageNo();
    if (beforePage && afterPage && afterPage <= beforePage) { L("页码未推进（" + beforePage + "→" + afterPage + "），判定已到末页，结束抓取"); break; }
  }
  const total = await getCount();
  L("抓取结束，共尝试 " + (page - 1) + " 页；库内 1688 订单合计 " + total + " 条");
  return { log, frame: frameUrl.slice(0, 120), exportApi: window.__IH_EXPORT || null, total, mode: "paged" };
}

// ═══ v3.3.0：单次受控导出（顶层，供弹窗定点调用）═══
// 教训固化：绝不自动循环、绝不重试、绝不遍历历史报表（v3.2.0 疯狂下载事故）。
// 用户在弹窗点一下 → 这里只点一次页面导出按钮 → 处理确认/批量导出弹窗 → 结束。
// 下载后的 xlsx 由后台 chrome.downloads 被动捕获解析入库。
(function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const TXT = (e) => ((e.innerText || e.textContent || e.getAttribute("title") || e.getAttribute("aria-label") || e.value || "").toString().replace(/\s+/g, " ").trim());
  const visible = (e) => { try { const r = e.getBoundingClientRect(); return !!r && r.width > 0 && r.height > 0; } catch (x) { return false; } };
  const shadowRoots = () => {
    const acc = [];
    const walk = (root) => { try { root.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) { acc.push(el.shadowRoot); walk(el.shadowRoot); } }); } catch (e) { /* 忽略 */ } };
    walk(document);
    return acc;
  };
  const deepAll = (sel) => {
    const out = [];
    try { document.querySelectorAll(sel).forEach((e) => out.push(e)); } catch (e) { /* 忽略 */ }
    shadowRoots().forEach((r) => { try { r.querySelectorAll(sel).forEach((e) => out.push(e)); } catch (e) { /* 忽略 */ } });
    return out;
  };
  // v3.3.5：不再额外 dispatch 合成 click——原来「合成 click + host.click()」会把页面
  // 点击 handler 触发两次（1688 导出场景实证：一次点击创建两个导出任务 → 下载两份
  // 相同清单，Downloads 里 26779115/26779116 两个连续任务 ID 同秒创建）。
  // 保留 pointer/mouse 按下抬起序列维持按压态，click 只由 host.click() 派发一次。
  const clickEl = (el) => {
    const host = (el.closest && (el.closest("button,a,[role=button]")) || el);
    try { ["pointerdown", "mousedown", "mouseup"].forEach((t) => host.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }))); } catch (e) { /* 忽略 */ }
    try { host.click(); } catch (e) { /* 忽略 */ }
    return TXT(host) || TXT(el);
  };
  const nodesContaining = (kw) => {
    const out = [];
    const seen = [];
    [document].concat(shadowRoots()).forEach((r) => {
      try {
        const tw = document.createTreeWalker(r, NodeFilter.SHOW_TEXT, null, false);
        let n;
        while ((n = tw.nextNode())) {
          if (String(n.nodeValue || "").indexOf(kw) === -1) continue;
          const p = n.parentElement;
          if (!p) continue;
          if (/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT|HEAD)$/.test(String(p.tagName || "").toUpperCase())) continue;
          if (seen.indexOf(p) === -1) { seen.push(p); out.push(p); }
        }
      } catch (e) { /* 忽略 */ }
    });
    return out;
  };
  const elevate = (el) => {
    let cur = el;
    let firstVisible = null;
    for (let i = 0; i < 5 && cur; i++) {
      const tag = String(cur.tagName || "").toLowerCase();
      const role = cur.getAttribute ? cur.getAttribute("role") : "";
      if (tag === "button" || tag === "a" || role === "button") return cur;
      const t = TXT(cur).trim();
      if (visible(cur) && t && t.length <= 40 && !firstVisible) firstVisible = cur;
      cur = cur.parentElement || (cur.getRootNode && cur.getRootNode().host) || null;
    }
    return firstVisible || el;
  };
  const btnsFromText = (kws) => {
    const seen = [];
    const out = [];
    kws.forEach((kw) => nodesContaining(kw).forEach((p) => {
      const el = elevate(p);
      if (seen.indexOf(el) !== -1) return;
      seen.push(el);
      const t = TXT(el).trim();
      if (t && t.length <= 30) out.push({ e: el, t: t });
    }));
    return out;
  };
  const findExportBtn = (exactRe) => {
    const hits = [];
    nodesContaining("导出").forEach((p) => {
      const el = elevate(p);
      const t = TXT(el).trim();
      if (!t || t.length > 40) return;
      if (hits.some((h) => h.e === el)) return;
      hits.push({ e: el, t: t });
    });
    if (!hits.length) return { hits: [], pick: null };
    const exact = hits.filter((h) => exactRe.test(h.t)).sort((a, b) => a.t.length - b.t.length);
    const vis = (exact.length ? exact : hits).filter((h) => visible(h.e));
    return { hits: hits, pick: vis[0] || exact[0] || hits[0] || null };
  };
  const isDisabled = (e) => {
    if (!e) return false;
    if (e.disabled === true) return true;
    if (e.getAttribute("disabled") !== null || e.getAttribute("aria-disabled") === "true") return true;
    // 阿里 Fusion 组件的禁用态是类名（如 next-btn-disabled / btn-disabled），不是 disabled 属性
    if (/disabled/i.test(String(e.className || ""))) {
      // v3.3.3：部分组件会在亮按钮上残留 disabled 样式类——计算样式 cursor=pointer 的一定是可点亮按钮
      try { if (window.getComputedStyle && window.getComputedStyle(e).cursor === "pointer") return false; } catch (x) { /* 忽略 */ }
      return true;
    }
    return false;
  };
  // 勾选数统计（v3.3.1 重写）：1688 买家工作台用阿里 Fusion 自定义勾选框——
  // 真 input 是视觉隐藏的（width>0 判定会漏），勾选态挂在外壳类名 next-checkbox-checked 上。
  // 所以：① input[type=checkbox]:checked 直接用 :checked 伪类（不过滤可见性）；
  //       ② [role=checkbox][aria-checked=true]；③ 类名含 checkbox 且含 checked 的外壳元素。
  // 外壳与 input 双计问题：外壳若内部包含已勾选 input 则跳过（由 input 代表）。
  const countChecked = () => {
    let n = 0;
    const seen = [];
    const add = (el) => {
      if (!el || seen.indexOf(el) !== -1) return;
      let hasChk = false;
      try { hasChk = !!el.querySelector('input[type=checkbox]:checked'); } catch (e) { /* 忽略 */ }
      if (hasChk) return; // 外壳元素，由其内部的 input 代表，避免双计
      seen.push(el); n++;
    };
    [document].concat(shadowRoots()).forEach((r) => {
      try { r.querySelectorAll('input[type=checkbox]:checked').forEach(add); } catch (e) { /* 忽略 */ }
      try { r.querySelectorAll('[role=checkbox]').forEach((el) => { if (el.getAttribute("aria-checked") === "true") add(el); }); } catch (e) { /* 忽略 */ }
      try {
        r.querySelectorAll('[class*="checkbox"]').forEach((el) => {
          if (/(^|[\s-])checked([\s-$]|$)/i.test(String(el.className || ""))) add(el);
        });
      } catch (e) { /* 忽略 */ }
    });
    return n;
  };
  const RE_SEL = /导出所选订单|导出选中订单|导出所选|导出选中/;
  const RE_COND = /导出当前条件|导出全部符合条件|导出符合当前条件|按当前条件导出|全部导出|导出筛选结果/;
  // 勾选/按钮状态探测（v3.3.1）：mode="selected"|"condition"，返回该模式下导出按钮的实际状态。
  // 1688 页面按钮亮 = 有勾选（按钮状态最权威）；勾选数只作展示与兜底。
  window.__IH_PAGE_SEL = function (mode) {
    mode = mode === "condition" ? "condition" : "selected";
    const RE = mode === "condition" ? RE_COND : RE_SEL;
    const r = findExportBtn(RE);
    // v3.3.3：合并「所有」exact 可见候选的亮灰态——任一亮即算可用。
    // 之前只看 pick（第一个命中元素），买家工作台工具栏结构不同很容易挑错元素/误判为灰。
    let anyEnabled = false, anyDisabled = false, exactVis = 0;
    (r.hits || []).forEach((h) => {
      if (!RE.test(h.t) || !visible(h.e)) return;
      exactVis++;
      if (isDisabled(h.e)) anyDisabled = true; else anyEnabled = true;
    });
    return {
      mode: mode,
      checked: countChecked(),
      btnFound: !!r.pick,
      btnDisabled: r.pick ? isDisabled(r.pick.e) : null,
      anyEnabled: anyEnabled,
      anyDisabled: anyDisabled,
      exactVis: exactVis,
      hitCount: (r.hits || []).length,
      btnText: r.pick ? r.pick.t : null,
      frame: location.href.slice(0, 100),
    };
  };
  window.__IH_PAGE_EXPORT = async function (mode, skipCheck) {
    const out = { mode: mode, ok: false, frame: location.href.slice(0, 120), log: [] };
    const L2 = (m) => out.log.push(String(m));
    if (/xdomain-storage/i.test(location.href)) { out.err = "bridge-frame"; return out; }
    const isCond = mode === "condition";
    const RE = isCond ? RE_COND : RE_SEL;
    // v3.3.5 判定权上收：弹窗侧已经用 __IH_PAGE_SEL 逐帧探测并 fail-open 放行后才调用本函数，
    // 页面侧不再做第二套校验——两套逻辑各判各的，页面工具栏重渲染的瞬间必然分叉
    // （v3.3.1~v3.3.4 四连「请先在1688选择要导出的订单」事故的共同根因）。
    // skipCheck=1（popup 固定传）：直接选最佳候选点击，绝不拦截；点错灰按钮=无害 no-op。
    const r = findExportBtn(RE);
    if (!r.pick) { out.err = "btn-not-found"; L2("⚠ 未找到导出按钮（候选 " + r.hits.length + " 个含「导出」元素）"); return out; }
    // 候选优先级：exact+可见+亮 > exact+可见 > exact——同文案置灰副本场景自动挑亮的那个
    const exactHits = (r.hits || []).filter((h) => RE.test(h.t));
    const visHits = exactHits.filter((h) => visible(h.e));
    const enabledHits = visHits.filter((h) => !isDisabled(h.e));
    const target = enabledHits[0] || visHits[0] || exactHits[0] || r.pick;
    L2("候选 exact " + exactHits.length + " / 可见 " + visHits.length + " / 亮 " + enabledHits.length + "，勾选 " + countChecked() + " 项 → 点击「" + target.t + "」" + (isDisabled(target.e) ? "（疑似置灰，仍尝试）" : "（亮）"));
    if (!skipCheck) {
      // 仅在未传 skipCheck（非弹窗调用/调试）时保留兜底校验
      if (!isCond && !enabledHits.length && countChecked() === 0) {
        out.err = "no-selection";
        L2("⚠ 未检测到亮着的「导出所选订单」且勾选数为 0。「导出所选订单」只能导出当前页勾选的订单（不支持跨页选择）——请先在 1688 买家工作台全选或点选要导出的订单");
        return out;
      }
      if (isCond && !visHits.length) {
        out.err = "btn-disabled";
        L2("⚠「" + target.t + "」按钮当前不可见或是灰的（可能订单还在加载），稍等几秒重试");
        return out;
      }
    }
    const netBefore = (window.__IH_NET || []).length;
    const exportBefore = window.__IH_EXPORT || null;
    const clickT = Date.now();
    clickEl(target.e);
    L2("已点击「" + target.t + "」");
    // 等待并观察：本次点击是否已直接触发导出（下载/导出接口提交）。
    // 三路信号判定（v3.3.2 修复重复下载）：① 网络捕获条目增加；② 最近导出提交对象变化；③ xlsx 响应晚于点击。
    await sleep(2200);
    const netAfter = (window.__IH_NET || []).length;
    const xlsxAfter = window.__IH_XLSX ? window.__IH_XLSX.t : 0;
    const fired = netAfter > netBefore || window.__IH_EXPORT !== exportBefore || xlsxAfter > clickT;
    // 「生成新报表」弹窗仅当「点击主按钮未触发导出」时才点一次；否则与主按钮重复触发 → 下载两份相同清单。
    // v3.3.5：必须过滤 visible——页面 DOM 里有预渲染但隐藏的「生成新报表」弹窗模板，
    // 点隐藏按钮会凭空创建第二个导出任务（双份清单帮凶之一）；弹窗没真正弹出就不补点。
    const gen = btnsFromText(["生成新报表"]).filter((g) => visible(g.e))[0] || null;
    if (gen && !fired) {
      clickEl(gen.e);
      L2("弹窗已点「生成新报表」（点击「" + target.t + "」未直接触发下载，由生成新报表发起导出）");
      out.dialog = true;
    } else if (gen && fired) {
      L2("「生成新报表」弹窗出现，但点击「" + target.t + "」已触发导出，为避免重复下载不再点「生成新报表」");
    } else if (!gen) {
      const c = btnsFromText(["确定", "确认导出", "继续导出", "立即导出"]).filter((x) => visible(x.e)).sort((a, b) => a.t.length - b.t.length)[0];
      if (c && !fired) { clickEl(c.e); L2("已点确认「" + c.t + "」"); }
    }
    out.ok = true;
    return out;
  };
})();

if (typeof window !== "undefined") {
  window.__IH_PAGE = window.__IH_PAGE || {};
  window.__IH_PAGE.diagnose1688 = diagnose1688;
  window.__IH_PAGE.grab1688 = grab1688;
  window.__IH_PAGE.ver = "3.3.5";
  window.__IH_PAGE_VER = "3.3.5";
  // 脚本注入即武装网络探针：用户后续在页面上的任何导出都会被捕获，无需先点诊断
  try { installNetHook1688(); } catch (e) { /* 忽略 */ }
}
