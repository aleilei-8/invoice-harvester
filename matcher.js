// ===== 1688 × 拼多多 开票工作台（在标签页中运行，文件选择稳定可靠）=====
// 业务流程（代发开票）：
//   PDD 买家申请开票(抬头/税号) → 拼多多卖家按「快递单号+快递公司」匹配 1688 订单号
//   → 按 1688 卖家分组生成开票清单发给卖家开票 → 卖家开好票后把结果文件拖回本页回填状态 → 上传发票到拼多多
"use strict";

const state = { a1688: [], pdd: [], files: [], statusMap: new Map() }; // statusMap: 1688订单号 → 开票状态

function log(msg, cls) {
  const el = document.getElementById("log");
  const line = document.createElement("div");
  if (cls) line.className = cls;
  const t = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  line.textContent = `[${t}] ${msg}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

// ---- 字段角色关键词（与 popup/background 预设一致）----
// 注意：tracking 关键词不要含模糊单字「物流/快递」，否则「物流公司」会被误当运单号列
const A1688_KW = {
  order_id: ["订单编号", "订单号", "订单", "单号", "order", "no.", "编号"],
  seller: ["卖家公司名", "卖家", "供应商", "供货商", "company", "supplier"],
  tracking_no: ["运单号", "物流单号", "快递单号", "waybill"],
  courier: ["物流公司", "快递公司", "承运商"],
  amount: ["实付款", "实付金额", "金额", "价税合计", "应付金额", "amount", "price"],
  items: ["货品标题", "商品", "货品", "item", "product"],
};
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

// 内容校验器（只看值，不看表头）：识别「被误当运单号的公司名」等脏数据
function looksLikeTracking(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return false;
  if (/[\u4e00-\u9fa5]/.test(s)) return false;
  return /\d{6,}/.test(s) || /^[A-Za-z0-9\-]{8,}$/.test(s);
}
function looksLikeCourier(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return false;
  return /快递|速递|速运|物流|邮政|顺丰|京东|德邦|菜鸟|丰网|驿站|中通|申通|圆通|韵达|极兔|百世|天天|EMS|ZTO|STO|YTO|YUNDA|JD|SF/i.test(s);
}

// 稳健归列：角色按优先级处理，关键词越长越优先，且一列只能对应一个角色（避免「物流公司」被抢去当运单号）
function buildColRole(rows, kw) {
  const allKeys = new Set();
  rows.forEach((r) => Object.keys(r).forEach((k) => allKeys.add(k)));
  const used = new Set();
  const colRole = {};
  const roleOrder = ["order_id", "tracking_no", "courier", "invoice_title", "tax_no", "status", "seller", "buyer", "amount", "items"];
  roleOrder.forEach((role) => {
    if (!kw[role]) return;
    const kws = kw[role].slice().sort((a, b) => String(b).length - String(a).length); // 长关键词优先
    for (const w of kws) {
      const cands = [...allKeys]
        .filter((k) => !used.has(k) && String(k).toLowerCase().indexOf(String(w).toLowerCase()) !== -1)
        .sort((a, b) => b.length - a.length); // 同命中取最长表头
      if (cands.length) { colRole[role] = cands[0]; used.add(cands[0]); return; }
    }
  });
  // 内容校验：跟踪号/承运商两列最容易表头歧义，按「值长什么样」再校正一次
  const validators = { tracking_no: looksLikeTracking, courier: looksLikeCourier };
  const sample = (k) => rows.slice(0, 40).map((r) => String(r[k] == null ? "" : r[k]).trim());
  const ratio = (k, fn) => { const vs = sample(k).filter((v) => v); return vs.length ? vs.filter(fn).length / vs.length : 0; };
  ["tracking_no", "courier"].forEach((role) => {
    if (!kw[role]) return;
    const fn = validators[role], cur = colRole[role];
    if (cur && ratio(cur, fn) >= 0.5) return;
    let best = null, bestRatio = 0.5;
    [...allKeys].forEach((k) => {
      if (used.has(k) && k !== cur) return;
      const rt = ratio(k, fn);
      if (rt > bestRatio) { bestRatio = rt; best = k; }
    });
    if (best && best !== cur) { if (cur) used.delete(cur); colRole[role] = best; used.add(best); }
  });
  return colRole;
}
function mapRowsByKw(rows, kw) {
  const colRole = buildColRole(rows, kw);
  return { colRole, rows: rows.map((r) => {
    const rec = {};
    for (const role in colRole) rec[role] = r[colRole[role]] != null ? String(r[colRole[role]]).trim() : "";
    return rec;
  }) };
}

// 读一个文件：取行数最多的工作表 → { rows, sheetNames, wb }（sheetNames 用于识别历史结果文件回填状态）
async function readWorkbook(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
  let best = null, bestN = -1;
  (wb.SheetNames || []).forEach((n) => {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: "", raw: false });
    if (rows.length > bestN) { bestN = rows.length; best = rows; }
  });
  return { rows: best || [], sheetNames: wb.SheetNames || [], wb };
}

// 识别文件归属：表头含 卖家/供应商/物流公司 → 1688；否则含 运单号/订单 → 拼多多
function detectSide(rows) {
  const keys = new Set();
  rows.forEach((r) => Object.keys(r).forEach((k) => keys.add(k)));
  const has = (re) => [...keys].some((k) => re.test(String(k)));
  if (has(/卖家|供应商|供货商|物流公司|承运商/)) return "a1688";
  if (has(/运单号|物流单号|快递单号|订单编号|订单号/)) return "pdd";
  return "unknown";
}

function normTrack(v) { return String(v || "").replace(/[\s\u3000]+/g, "").toUpperCase(); }
function normCourier(v) { return String(v || "").replace(/[\s\u3000（）()]/g, "").toUpperCase(); }
// 快递公司一致性：一方包含另一方（如「中通快递」vs「中通快递(ZTO)」）即视为一致
function courierCheck(a, b) {
  const x = normCourier(a), y = normCourier(b);
  if (!x || !y) return "—";
  return (x.indexOf(y) !== -1 || y.indexOf(x) !== -1) ? "✅一致" : "⚠不一致";
}

function numOf(v) { const m = String(v == null ? "" : v).replace(/[¥￥$,\s]/g, "").match(/-?\d+(?:\.\d+)?/); return m ? parseFloat(m[0]) : 0; }
function renderChips() {
  const box = document.getElementById("chips");
  box.innerHTML = "";
  state.files.forEach((f) => {
    const chip = document.createElement("div");
    chip.className = "file-chip";
    const tagCls = f.side === "a1688" ? "tag-1688" : f.side === "pdd" ? "tag-pdd" : f.side === "status" ? "tag-ok" : "tag-unk";
    const tagTxt = f.side === "a1688" ? "1688" : f.side === "pdd" ? "拼多多" : f.side === "status" ? "状态回填" : "未识别";
    chip.innerHTML = `<span class="tag ${tagCls}">${tagTxt}</span><span>${f.name}</span>` +
      `<span style="color:#6b7280">${f.rows} 行</span>` +
      (f.side === "a1688" ? `<span class="tag tag-ok">订单 ${f.parsed}</span>` : "") +
      (f.side === "status" ? `<span class="tag tag-ok">回填 ${f.parsed}</span>` : "");
    box.appendChild(chip);
  });
  const c = document.getElementById("counts");
  c.innerHTML = `1688 订单：<b>${state.a1688.length}</b> 条 ｜ 拼多多订单：<b>${state.pdd.length}</b> 条` +
    (state.statusMap.size ? ` ｜ 已回填开票状态：<b>${state.statusMap.size}</b> 条` : "");
  document.getElementById("btn-go").disabled = !(state.a1688.length && state.pdd.length);
}

// ---- 历史结果文件回填：识别「开票跟踪表」Sheet，抽取 1688订单号 → 开票状态 ----
function harvestStatus(wb, sheetNames) {
  let n = 0;
  const hit = sheetNames.find((nm) => /开票跟踪|开票状态|跟踪表/.test(nm));
  if (!hit) return 0;
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[hit], { defval: "", raw: false });
  const colRole = buildColRole(rows, { order_id: ["1688订单号", "订单号", "订单编号"], status: ["开票状态", "状态"] });
  if (!colRole.order_id || !colRole.status) return 0;
  rows.forEach((r) => {
    const oid = String(r[colRole.order_id] == null ? "" : r[colRole.order_id]).trim();
    const st = String(r[colRole.status] == null ? "" : r[colRole.status]).trim();
    if (oid && st && !/^(小计|【|合计)/.test(oid)) { state.statusMap.set(oid, st); n++; }
  });
  return n;
}

async function handleFiles(fileList) {
  for (const f of Array.from(fileList)) {
    try {
      const parsed = await readWorkbook(f);
      if (!parsed.rows.length) { log(`⚠️ ${f.name}：无可用数据行`, "warn"); continue; }
      // ① 历史结果文件（含「开票跟踪表」/「匹配结果」Sheet）→ 只回填开票状态，不当数据导入（防污染 1688 库）
      if (parsed.sheetNames.some((nm) => /开票跟踪|开票状态|跟踪表|匹配结果/.test(nm))) {
        const n = harvestStatus(parsed.wb, parsed.sheetNames);
        state.files.push({ name: f.name, side: "status", rows: n, parsed: n });
        if (n > 0) log(`✅ ${f.name} → 识别为历史开票结果：已回填 ${n} 条开票状态（下次匹配自动带入）`, "ok");
        else log(`⚠️ ${f.name} → 识别为结果文件，但其中没有「开票状态」列（旧版格式），无状态可回填`, "warn");
        renderChips();
        continue;
      }
      // ② 正常数据文件
      const side = detectSide(parsed.rows);
      if (side === "a1688") {
        const { colRole, rows: mapped } = mapRowsByKw(parsed.rows, A1688_KW);
        const recs = mapped.filter((r) => r.order_id);
        state.a1688 = state.a1688.concat(recs);
        state.files.push({ name: f.name, side, rows: parsed.rows.length, parsed: recs.length });
        log(`✅ ${f.name} → 识别为 1688 导出表：${recs.length} 条订单（归列：${JSON.stringify(colRole)}）`, "ok");
        await mergeA1688(recs);
      } else if (side === "pdd") {
        const { rows: mapped } = mapRowsByKw(parsed.rows, PDD_KW);
        const recs = mapped.filter((r) => r.tracking_no || r.order_id);
        state.pdd = state.pdd.concat(recs);
        const withInv = recs.filter((r) => r.invoice_title || r.tax_no).length;
        state.files.push({ name: f.name, side, rows: parsed.rows.length, parsed: recs.length });
        log(`✅ ${f.name} → 识别为拼多多导出表：${recs.length} 条订单${withInv ? `（含开票信息 ${withInv} 条）` : "（表内无抬头/税号列，可在下方手动填写）"}`, "ok");
      } else {
        state.files.push({ name: f.name, side: "unknown", rows: parsed.rows.length, parsed: 0 });
        log(`❌ ${f.name}：无法识别归属（表头既无 卖家/物流公司 也无 运单号/订单号），已跳过`, "err");
      }
    } catch (e) {
      log(`❌ ${f.name} 解析失败：${e.message}`, "err");
    }
    renderChips();
  }
}

// 与 background 一致的合并逻辑（按订单号去重），供弹窗计数与后续匹配复用
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
      // 修复历史脏数据：旧值不像运单号/承运商、新值合格 → 覆盖
      if (rec.tracking_no && !looksLikeTracking(ex.tracking_no) && looksLikeTracking(rec.tracking_no)) ex.tracking_no = rec.tracking_no;
      if (rec.courier && !looksLikeCourier(ex.courier) && looksLikeCourier(rec.courier)) ex.courier = rec.courier;
      merged++;
    }
    else { lib.push(rec); added++; }
  });
  await new Promise((res) => chrome.storage.local.set({ a1688_orders: lib }, res));
  log(`入库：新增 ${added} 条、合并更新 ${merged} 条，库内共 ${lib.length} 条 1688 订单`, "info");
}

// 从插件「a1688_orders」库直接载入（1688「导出当前条件」产生的 xlsx 会被后台自动解析入库）
async function loadFromStorage() {
  try {
    const d = await new Promise((res) => chrome.storage.local.get({ a1688_orders: [] }, res));
    const recs = (d.a1688_orders || []).filter((r) => r.order_id);
    if (!recs.length) {
      log("⚠️ 插件库（a1688_orders）为空：请在 1688 订单页筛选条件选「全部」→ 点「导出当前条件」，下载后插件会自动解析入库；或直接上传 1688 导出表", "warn");
      return;
    }
    let added = 0;
    recs.forEach((r) => {
      if (!state.a1688.find((x) => (x.order_id || "").trim() === (r.order_id || "").trim())) { state.a1688.push(r); added++; }
    });
    state.files.push({ name: "【插件库 a1688_orders】", side: "a1688", rows: recs.length, parsed: added });
    renderChips();
    log(`✅ 已从插件已解析库载入 1688 订单 ${recs.length} 条（新增 ${added} 条，本页累计 ${state.a1688.length} 条）`, "ok");
    log("现在上传拼多多导出表，点「匹配并生成开票清单」即可", "info");
  } catch (e) {
    log("❌ 读取插件库失败：" + e.message, "err");
  }
}

// 从插件「pdd_orders」库直接载入（拼多多后台导出的订单表会被后台自动解析入库）
async function loadFromStoragePdd() {
  try {
    const d = await new Promise((res) => chrome.storage.local.get({ pdd_orders: [] }, res));
    const recs = (d.pdd_orders || []).filter((r) => r.order_id || r.tracking_no);
    if (!recs.length) {
      log("⚠️ 插件库（pdd_orders）为空：请在拼多多商家后台导出订单表，下载后插件会自动解析入库；或直接上传拼多多导出表", "warn");
      return;
    }
    let added = 0;
    recs.forEach((r) => {
      const key = (r.order_id || "") + "|" + (r.tracking_no || "");
      if (!state.pdd.find((x) => ((x.order_id || "") + "|" + (x.tracking_no || "")) === key)) { state.pdd.push(r); added++; }
    });
    state.files.push({ name: "【插件库 pdd_orders】", side: "pdd", rows: recs.length, parsed: added });
    renderChips();
    log(`✅ 已从插件库载入拼多多订单 ${recs.length} 条（新增 ${added} 条，本页累计 ${state.pdd.length} 条）`, "ok");
  } catch (e) {
    log("❌ 读取拼多多插件库失败：" + e.message, "err");
  }
}

// ---- 核心：匹配 + 生成开票三件套 ----
function doMatch() {
  const aByTrack = {};
  state.a1688.forEach((a) => {
    const t = normTrack(a.tracking_no);
    if (t && !aByTrack[t]) aByTrack[t] = a;
  });
  const manualTitle = (document.getElementById("inv-title").value || "").trim();
  const manualTax = (document.getElementById("inv-tax").value || "").trim();
  const matched = [], pUnmatched = [];
  const hitA = new Set();
  let dupTrack = 0, courierWarn = 0;
  state.pdd.forEach((p) => {
    const t = normTrack(p.tracking_no);
    const a = t ? aByTrack[t] : null;
    if (a) {
      if (hitA.has(a.order_id)) dupTrack++;
      hitA.add(a.order_id);
      const cc = courierCheck(a.courier, p.courier);
      if (cc === "⚠不一致") courierWarn++;
      matched.push({
        "拼多多订单号": p.order_id, "快递单号": t,
        "快递公司(拼多多填写)": p.courier || "",
        "1688订单号": a.order_id, "卖家/供应商": a.seller, "快递公司(1688)": a.courier,
        "快递公司校验": cc,
        "1688金额": a.amount, "1688货品": a.items,
        "发票抬头": p.invoice_title || manualTitle, "税号": p.tax_no || manualTax,
        "拼多多收货人": p.buyer, "拼多多金额": p.amount, "拼多多商品": p.items,
        "开票状态": state.statusMap.get(a.order_id) || "待开票",
      });
    } else pUnmatched.push(p);
  });

  // ===== Sheet 1：匹配结果（明细对账）=====
  const out = {
    "匹配结果": matched.length ? matched : [{ "提示": "无匹配" }],
  };

  // ===== Sheet 2：开票清单_按卖家（直接复制发给 1688 卖家；同一 1688 订单只开一张票，按订单号去重）=====
  let invRows = [], sellerCnt = 0, invTotal = 0;
  if (matched.length) {
    const groups = new Map();
    const seen = new Set();
    matched.forEach((r) => {
      const oid = (r["1688订单号"] || "").trim();
      if (oid && seen.has(oid)) return; // 多个 PDD 单共用同一 1688 运单 → 只开一张票
      if (oid) seen.add(oid);
      const key = (r["卖家/供应商"] || "").trim() || "(未识别卖家)";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    });
    const list = [...groups.entries()].sort((x, y) =>
      y[1].reduce((s, r) => s + numOf(r["1688金额"]), 0) - x[1].reduce((s, r) => s + numOf(r["1688金额"]), 0));
    list.forEach(([seller, orders]) => {
      let amt = 0;
      orders.forEach((r) => {
        amt += numOf(r["1688金额"]);
        invRows.push({
          "卖家/供应商": seller, "1688订单号": r["1688订单号"], "1688货品": r["1688货品"],
          "1688金额": r["1688金额"], "快递公司": r["快递公司(1688)"], "快递单号": r["快递单号"],
          "发票抬头": r["发票抬头"], "税号": r["税号"], "开票状态": r["开票状态"],
        });
      });
      amt = Math.round(amt * 100) / 100;
      invTotal += amt;
      sellerCnt++;
      invRows.push({
        "卖家/供应商": `【小计】${seller}`, "1688订单号": `共 ${orders.length} 单`,
        "1688金额": amt, "快递公司": "", "快递单号": "", "发票抬头": "", "税号": "",
        "开票状态": `联系「${seller}」按抬头开票`,
      });
    });
    invTotal = Math.round(invTotal * 100) / 100;
    invRows.push({
      "卖家/供应商": "【合计】", "1688订单号": `${sellerCnt} 个卖家`,
      "1688金额": invTotal, "快递公司": "", "快递单号": "", "发票抬头": manualTitle, "税号": manualTax,
      "开票状态": `共 ${seen.size} 张发票（按 1688 订单去重）`,
    });
    out["开票清单_按卖家"] = invRows;
  }

  // ===== Sheet 3：开票跟踪表（下次把结果文件拖回本页即可回填状态）=====
  if (matched.length) {
    out["开票跟踪表"] = matched.map((r) => ({
      "拼多多订单号": r["拼多多订单号"], "快递单号": r["快递单号"], "快递公司": r["快递公司(1688)"],
      "1688订单号": r["1688订单号"], "卖家/供应商": r["卖家/供应商"], "1688金额": r["1688金额"],
      "开票状态": r["开票状态"],
    }));
  }

  // ===== Sheet 4/5：未匹配 =====
  out["未匹配_拼多多"] = pUnmatched.length ? pUnmatched.map((p) => ({ "拼多多订单号": p.order_id, "快递单号": p.tracking_no, "快递公司": p.courier, "收货人": p.buyer, "发票抬头": p.invoice_title || "", "税号": p.tax_no || "" })) : [{ "提示": "无" }];
  const aLeft = state.a1688.filter((a) => !hitA.has(a.order_id));
  out["未匹配_1688"] = aLeft.length ? aLeft.map((a) => ({ "1688订单号": a.order_id, "卖家": a.seller, "快递公司": a.courier, "快递单号": a.tracking_no })) : [{ "提示": "无" }];

  const owb = XLSX.utils.book_new();
  Object.keys(out).forEach((sn) => {
    const ws = XLSX.utils.json_to_sheet(out[sn]);
    XLSX.utils.book_append_sheet(owb, ws, sn.slice(0, 28));
  });
  const dt = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(owb, `1688_拼多多_开票匹配_${dt}.xlsx`);
  log(`✅ 匹配完成：命中 <b>${matched.length}</b> 条 ｜ 拼多多未匹配 ${pUnmatched.length} 条 ｜ 1688 未匹配 ${aLeft.length} 条` +
    (dupTrack ? ` ｜ ${dupTrack} 条 PDD 订单共用同一 1688 运单（已按 1688 订单去重开票）` : "") +
    (courierWarn ? ` ｜ <b>⚠ ${courierWarn} 条快递公司与拼多多填写不一致，请人工核对</b>` : ""), "ok");
  log(`结果文件含 ${Object.keys(out).length} 个 Sheet：匹配结果 / 开票清单_按卖家 / 开票跟踪表 / 未匹配。` +
    `「开票清单_按卖家」共 ${sellerCnt} 个卖家 / ${seenSize(invRows)} 张票 / 合计 ¥${invTotal}，可直接复制发给 1688 卖家`, "info");
  log("卖家开好票后：把本次下载的结果文件重新拖回本页 → 自动回填「开票状态」，再对照跟踪表逐单上传发票到拼多多", "info");
}
function seenSize(invRows) {
  const s = new Set();
  invRows.forEach((r) => { const o = String(r["1688订单号"] || ""); if (/^\d/.test(o)) s.add(o); });
  return s.size;
}

// ---- 交互绑定 ----
document.addEventListener("DOMContentLoaded", () => {
  const drop = document.getElementById("drop");
  const inp = document.getElementById("files");
  drop.addEventListener("click", () => inp.click());
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault(); drop.classList.remove("over");
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });
  inp.addEventListener("change", (e) => {
    if (e.target.files && e.target.files.length) handleFiles(e.target.files);
    e.target.value = "";
  });
  document.getElementById("btn-load-lib").addEventListener("click", loadFromStorage);
  document.getElementById("btn-load-pdd").addEventListener("click", loadFromStoragePdd);
  document.getElementById("btn-go").addEventListener("click", doMatch);
  document.getElementById("btn-reset").addEventListener("click", () => {
    state.a1688 = []; state.pdd = []; state.files = []; state.statusMap = new Map();
    renderChips();
    log("已清空，可重新导入文件", "info");
  });
  log("页面就绪。流程：① 1688 订单页条件选「全部」→「导出当前条件」（下载后自动入库，也可点左侧按钮调入或直接上传导出表）→ ② 上传拼多多导出表 → ③ 匹配生成开票清单发卖家 → ④ 卖家开好票后把结果文件拖回来回填状态", "info");
});
