// 轻量后台：初始化本地汇总库 + 捕获 1688 官方导出 xlsx 并就地解析
try { importScripts("xlsx.full.min.js"); } catch (e) { /* SheetJS 未加载则仅记录下载、不解析 */ }

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get("invoice_records", (data) => {
    if (!Array.isArray(data.invoice_records)) {
      chrome.storage.local.set({ invoice_records: [] });
    }
  });
});

// 接收 content 注入时回传的抓取结果（备用通道）
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === "PING") { sendResponse({ ok: true }); return; }
  if (msg.type === "GET_A1688") {
    chrome.storage.local.get({ a1688_orders: [], __ih_parse_log: [] }, (d) => {
      sendResponse({ orders: d.a1688_orders || [], log: d.__ih_parse_log || [] });
    });
    return true; // 异步响应
  }
});

// 1688 导出字段关键词（与 popup 预设一致，仅用于从 xlsx 表头自动归列）
// 注意：tracking 关键词不要含模糊单字「物流/快递」，否则「物流公司」会被误当运单号列
const A1688_KW = {
  order_id: ["订单编号", "订单号", "订单", "单号", "order", "no.", "编号"],
  seller: ["卖家公司名", "卖家", "供应商", "供货商", "company", "supplier"],
  tracking_no: ["运单号", "物流单号", "快递单号", "waybill"],
  courier: ["物流公司", "快递公司", "承运商"],
  amount: ["实付款", "实付金额", "金额", "价税合计", "应付金额", "amount", "price"],
  items: ["货品标题", "商品", "货品", "item", "product"],
};
// 拼多多导出字段关键词（订单导出表；含开票信息列则一并入库）
const PDD_KW = {
  order_id: ["订单编号", "订单号", "订单", "单号", "order", "no.", "编号"],
  tracking_no: ["运单号", "物流单号", "快递单号", "waybill"],
  courier: ["快递公司", "物流公司", "承运商", "物流名称"],
  invoice_title: ["发票抬头", "抬头名称", "抬头", "开票名称"],
  tax_no: ["纳税人识别号", "纳税人识别码", "税号", "统一社会信用代码"],
  buyer: ["买家", "收货人", "收件人", "customer", "consignee"],
  amount: ["实付金额", "订单金额", "应付金额", "金额", "amount", "price"],
  items: ["商品名称", "商品", "货物", "item", "product"],
};

// 内容校验器（不依赖表头，只看值）：用于识别「被误当运单号的公司名」等脏数据
function looksLikeTracking(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return false;
  if (/[\u4e00-\u9fa5]/.test(s)) return false;          // 含中文 → 是公司名/状态，不是运单号
  return /\d{6,}/.test(s) || /^[A-Za-z0-9\-]{8,}$/.test(s); // 纯数字/字母数字，长度足够
}
function looksLikeCourier(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return false;
  return /快递|速递|速运|物流|邮政|顺丰|京东|德邦|菜鸟|丰网|驿站|中通|申通|圆通|韵达|极兔|百世|天天|EMS|ZTO|STO|YTO|YUNDA|JD|SF/i.test(s);
}

// 从 xlsx 二进制解析订单（kw 决定归列角色：A1688_KW / PDD_KW）
function parseXlsxBytes(buf, kw) {
  kw = kw || A1688_KW;
  if (typeof XLSX === "undefined") return { ok: false, err: "SheetJS 未加载" };
  let wb;
  try { wb = XLSX.read(new Uint8Array(buf), { type: "array" }); }
  catch (e) { return { ok: false, err: "XLSX.read 失败：" + e.message }; }
  let bestName = null, bestRows = -1;
  (wb.SheetNames || []).forEach((name) => {
    try {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: "" });
      if (rows.length > bestRows) { bestRows = rows.length; bestName = name; }
    } catch (e) { /* 忽略坏表 */ }
  });
  if (!bestName) return { ok: false, err: "无可用工作表" };
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[bestName], { defval: "" });
  // 收集所有表头列名 → 稳健归列（角色优先级 + 长关键词优先 + 一列一角色）
  const allKeys = new Set();
  rows.forEach((r) => Object.keys(r).forEach((k) => allKeys.add(k)));
  const used = new Set();
  const colRole = {};
  const roleOrder = ["order_id", "tracking_no", "courier", "invoice_title", "tax_no", "seller", "buyer", "amount", "items"];
  roleOrder.forEach((role) => {
    const kws = (kw[role] || []).slice().sort((a, b) => String(b).length - String(a).length);
    for (const w of kws) {
      const cands = [...allKeys]
        .filter((k) => !used.has(k) && String(k).toLowerCase().indexOf(String(w).toLowerCase()) !== -1)
        .sort((a, b) => b.length - a.length);
      if (cands.length) { colRole[role] = cands[0]; used.add(cands[0]); break; }
    }
  });
  // 内容校验：若某角色命中的列内容不像该角色，改选全表内容最像的列（防止表头歧义）
  const sample = (k) => rows.slice(0, 40).map((r) => String(r[k] == null ? "" : r[k]).trim());
  const ratio = (k, fn) => { const vs = sample(k).filter((v) => v); return vs.length ? vs.filter(fn).length / vs.length : 0; };
  const reassign = (role, validator) => {
    const cur = colRole[role];
    if (cur && ratio(cur, validator) >= 0.5) return; // 已命中列内容合格，不动
    let best = null, bestRatio = 0.5;
    [...allKeys].forEach((k) => {
      if (used.has(k) && k !== cur) return; // 不抢别的角色已占用的列
      const rt = ratio(k, validator);
      if (rt > bestRatio) { bestRatio = rt; best = k; }
    });
    if (best && best !== cur) {
      if (cur) used.delete(cur);
      colRole[role] = best;
      used.add(best);
    }
  };
  reassign("tracking_no", looksLikeTracking);
  reassign("courier", looksLikeCourier);
  const records = [];
  rows.forEach((r) => {
    const rec = {};
    for (const role in colRole) rec[role] = r[colRole[role]] != null ? String(r[colRole[role]]).trim() : "";
    if (rec.order_id) records.push(rec);
  });
  return { ok: true, sheet: bestName, total: rows.length, matched: records.length, colRole, records };
}

// 尝试抓取下载直链并解析（扩展带 host 权限，可绕过 CORS；blob: 也能 fetch）
async function tryFetchParse(url, kw) {
  try {
    const resp = await fetch(url, { credentials: "include" });
    if (!resp.ok) return { ok: false, err: "HTTP " + resp.status };
    const buf = await resp.arrayBuffer();
    return parseXlsxBytes(buf, kw);
  } catch (e) {
    return { ok: false, err: String((e && e.message) || e) };
  }
}

// 把解析结果并入 a1688_orders（按订单号去重），并写解析日志供弹窗展示
async function mergeA1688(records) {
  const d = await new Promise((res) => chrome.storage.local.get({ a1688_orders: [] }, res));
  const lib = d.a1688_orders || [];
  let added = 0, merged = 0;
  records.forEach((rec) => {
    const oid = (rec.order_id || "").trim();
    if (!oid) return;
    const ex = lib.find((x) => (x.order_id || "").trim() === oid);
    if (ex) {
      for (const role in rec) if (!ex[role] && rec[role]) ex[role] = rec[role];
      // 修复历史脏数据：旧值明显不是该角色内容（如运单号列里是"中通快递(ZTO)"）而新值合格 → 覆盖
      if (rec.tracking_no && !looksLikeTracking(ex.tracking_no) && looksLikeTracking(rec.tracking_no)) ex.tracking_no = rec.tracking_no;
      if (rec.courier && !looksLikeCourier(ex.courier) && looksLikeCourier(rec.courier)) ex.courier = rec.courier;
      merged++;
    } else { lib.push(rec); added++; }
  });
  await new Promise((res) => chrome.storage.local.set({ a1688_orders: lib }, res));
  return { added, merged, total: lib.length };
}

// 把拼多多解析结果并入 pdd_orders（按订单号去重；开票信息有则覆盖）
async function mergePdd(records) {
  const d = await new Promise((res) => chrome.storage.local.get({ pdd_orders: [] }, res));
  const lib = d.pdd_orders || [];
  let added = 0, merged = 0;
  records.forEach((rec) => {
    const oid = (rec.order_id || "").trim();
    if (!oid && !rec.tracking_no) return;
    const ex = oid ? lib.find((x) => (x.order_id || "").trim() === oid) : null;
    if (ex) {
      for (const role in rec) if (rec[role]) ex[role] = rec[role]; // PDD 报表为最新快照，新值直接覆盖
      merged++;
    } else { lib.push(rec); added++; }
  });
  await new Promise((res) => chrome.storage.local.set({ pdd_orders: lib }, res));
  return { added, merged, total: lib.length };
}

function pushParseLog(entry) {
  chrome.storage.local.get({ __ih_parse_log: [] }, (d) => {
    const arr = d.__ih_parse_log || [];
    arr.unshift(entry);
    chrome.storage.local.set({ __ih_parse_log: arr.slice(0, 20) });
  });
}

// 捕获 1688 官方导出产生的 xlsx 下载：记录直链，并就地解析抽取订单字段。
// 注意：onCreated 阶段 filename 常不完整、url 通常不带 .xlsx 扩展名，
// 因此这里只做「记录」，等 onChanged 状态变为 complete 后再按最终文件名判断并解析。
chrome.downloads.onCreated.addListener((item) => {
  if (!/^https?:/i.test(item.url || "")) return;
  const entry = {
    id: item.id, url: item.url, filename: item.filename || "",
    startTime: item.startTime, state: item.state || "in_progress",
    parse: null,
  };
  chrome.storage.local.get({ __ih_downloads: [] }, (d) => {
    const arr = d.__ih_downloads || [];
    arr.push(entry);
    chrome.storage.local.set({ __ih_downloads: arr.slice(-80) });
  });
  // 等下载完成再解析（此时才有最终文件名/最终 URL）
  const onComplete = async (delta) => {
    if (delta.id !== item.id || !delta.state) return;
    chrome.downloads.onChanged.removeListener(onComplete);
    if (delta.state.current !== "complete") {
      pushParseLog({ ts: Date.now(), filename: item.filename, url: item.url, ok: false, err: "下载未完成：" + delta.state.current });
      return;
    }
    let dl = null;
    try { dl = (await chrome.downloads.search({ id: item.id }))[0]; } catch (e) { /* 忽略 */ }
    const fname = (dl && dl.filename) || item.filename || "";
    const furl = (dl && (dl.finalUrl || dl.url)) || item.url || "";
    const looksXlsx = /\.(xlsx|xls|csv)$/i.test(fname) || /\.(xlsx|xls|csv)(\?|$)/i.test(furl);
    const host1688 = /1688\.com|alicdn\.com|aliyun|taobao/i.test(furl);
    const hostPdd = /pinduoduo\.com|yangkeduo\.com|pddpic\.com/i.test(furl);
    if (!looksXlsx && !host1688 && !hostPdd) {
      pushParseLog({ ts: Date.now(), filename: fname, url: furl, ok: false, err: "非 Excel/非 1688/拼多多 下载，已跳过解析" });
      return;
    }
    // 按来源平台路由：拼多多 → PDD_KW → pdd_orders；1688 → A1688_KW → a1688_orders
    const side = hostPdd && !host1688 ? "pdd" : "a1688";
    const kw = side === "pdd" ? PDD_KW : A1688_KW;
    // 就地解析：抓直链 → SheetJS → 抽取字段 → 并入对应库
    let pr = await tryFetchParse(furl, kw);
    if (!pr.ok && furl !== item.url) pr = await tryFetchParse(item.url, kw);
    let merge = null;
    if (pr.ok) {
      try { merge = side === "pdd" ? await mergePdd(pr.records) : await mergeA1688(pr.records); }
      catch (e) { pr.err = "入库失败：" + e.message; pr.ok = false; }
    }
    const logEntry = {
      ts: Date.now(), filename: fname, url: furl, side,
      ok: pr.ok, err: pr.ok ? null : pr.err,
      sheet: pr.sheet || null, total: pr.total || 0, matched: pr.matched || 0,
      colRole: pr.colRole || null, added: merge ? merge.added : 0, merged: merge ? merge.merged : 0,
      libTotal: merge ? merge.total : 0,
    };
    pushParseLog(logEntry);
    // 把解析结论回写下载记录，便于诊断查看
    chrome.storage.local.get({ __ih_downloads: [] }, (d2) => {
      const arr2 = d2.__ih_downloads || [];
      const it = arr2.find((x) => x.id === item.id);
      if (it) it.parse = { ok: pr.ok, err: pr.ok ? null : pr.err, side, matched: pr.matched || 0, libTotal: merge ? merge.total : 0 };
      chrome.storage.local.set({ __ih_downloads: arr2 });
    });
  };
  chrome.downloads.onChanged.addListener(onComplete);
});

chrome.downloads.onChanged.addListener((delta) => {
  chrome.storage.local.get({ __ih_downloads: [] }, (d) => {
    const arr = d.__ih_downloads || [];
    const it = arr.find((x) => x.id === delta.id);
    if (!it) return;
    if (delta.state) it.state = delta.state.current;
    if (delta.filename) it.filename = delta.filename.current;
    if (delta.url) it.url = delta.url.current;
    chrome.storage.local.set({ __ih_downloads: arr });
  });
});
