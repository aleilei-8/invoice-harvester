// 用「修正后的归列逻辑」重算 1688 汇总表（离线校验 v3.0.11 修复是否生效）
const fs = require("fs");
const XLSX = require("./xlsx.full.min.js");

const SRC = ["raw_a.xlsx", "raw_b.xlsx"];
const OUT = "C:/Users/JoShua/Desktop/1688订单汇总_修正版.xlsx";

const A1688_KW = {
  order_id: ["订单编号", "订单号", "订单", "单号", "order", "no.", "编号"],
  seller: ["卖家公司名", "卖家", "供应商", "供货商", "company", "supplier"],
  tracking_no: ["运单号", "物流单号", "快递单号", "waybill"],
  courier: ["物流公司", "快递公司", "承运商"],
  amount: ["实付款", "实付金额", "金额", "价税合计", "应付金额", "amount", "price"],
  items: ["货品标题", "商品", "货品", "item", "product"],
};
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
function parseSheet(rows) {
  const allKeys = new Set();
  rows.forEach((r) => Object.keys(r).forEach((k) => allKeys.add(k)));
  const used = new Set(), colRole = {};
  ["order_id", "tracking_no", "courier", "seller", "amount", "items"].forEach((role) => {
    const kws = (A1688_KW[role] || []).slice().sort((a, b) => String(b).length - String(a).length);
    for (const w of kws) {
      const cands = [...allKeys].filter((k) => !used.has(k) && String(k).toLowerCase().indexOf(String(w).toLowerCase()) !== -1).sort((a, b) => b.length - a.length);
      if (cands.length) { colRole[role] = cands[0]; used.add(cands[0]); return; }
    }
  });
  const sample = (k) => rows.slice(0, 40).map((r) => String(r[k] == null ? "" : r[k]).trim());
  const ratio = (k, fn) => { const vs = sample(k).filter((v) => v); return vs.length ? vs.filter(fn).length / vs.length : 0; };
  const reassign = (role, validator) => {
    const cur = colRole[role];
    if (cur && ratio(cur, validator) >= 0.5) return;
    let best = null, bestRatio = 0.5;
    [...allKeys].forEach((k) => { if (used.has(k) && k !== cur) return; const rt = ratio(k, validator); if (rt > bestRatio) { bestRatio = rt; best = k; } });
    if (best && best !== cur) { if (cur) used.delete(cur); colRole[role] = best; used.add(best); }
  };
  reassign("tracking_no", looksLikeTracking);
  reassign("courier", looksLikeCourier);
  const recs = [];
  rows.forEach((r) => {
    const rec = {};
    for (const role in colRole) rec[role] = r[colRole[role]] != null ? String(r[colRole[role]]).trim() : "";
    if (rec.order_id) recs.push(rec);
  });
  return { colRole, recs };
}

const lib = [];
const seen = new Set();
SRC.forEach((f) => {
  const wb = XLSX.read(fs.readFileSync(f), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  const { colRole, recs } = parseSheet(rows);
  console.log(f + " 归列: " + JSON.stringify(colRole));
  recs.forEach((rec) => {
    const oid = rec.order_id.trim();
    if (seen.has(oid)) return;
    seen.add(oid);
    lib.push(rec);
  });
});
lib.sort((a, b) => (a.order_id > b.order_id ? 1 : -1));
const rows = lib.map((r) => ({
  "1688订单号": r.order_id, "卖家/供应商": r.seller, "快递公司": r.courier,
  "快递单号": r.tracking_no, "金额": r.amount, "货品": r.items,
}));
const wb2 = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb2, XLSX.utils.json_to_sheet(rows), "1688订单汇总");
fs.writeFileSync(OUT, XLSX.write(wb2, { type: "buffer", bookType: "xlsx" }));
const valid = rows.filter((r) => looksLikeTracking(r["快递单号"])).length;
console.log("合并去重后订单数: " + rows.length + " ｜ 快递单号合格(像运单号): " + valid + " / " + rows.length);
console.log("样例: " + JSON.stringify(rows.slice(0, 3), null, 1));
console.log("已写出: " + OUT);
