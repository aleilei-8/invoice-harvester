// 从「匹配结果」xlsx 生成「按卖家分组可开票」汇总视图（一次性离线脚本）
const fs = require("fs");
const XLSX = require("./xlsx.full.min.js");

const SRC = "_src_match.xlsx"; // 修正版匹配结果（已复制到项目目录）
const OUT = "C:/Users/JoShua/Desktop/1688_按卖家分组可开票汇总_2026-10-06.xlsx";

const buf = fs.readFileSync(SRC);
const wb = XLSX.read(buf, { type: "buffer" });
console.log("SHEETS:", JSON.stringify(wb.SheetNames));

const sheetName = wb.SheetNames.find((n) => /匹配结果/.test(n)) || wb.SheetNames[0];
const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });
console.log("匹配明细行数:", rows.length);
if (rows.length) console.log("字段:", JSON.stringify(Object.keys(rows[0])));

function numOf(v) {
  if (v == null) return 0;
  const m = String(v).replace(/[¥￥$,\s]/g, "").match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : 0;
}
function sellerOf(r) {
  const s = (r["卖家/供应商"] || "").trim();
  return s || "(未识别卖家)";
}

// 分组
const groups = new Map();
rows.forEach((r) => {
  const key = sellerOf(r);
  if (!groups.has(key)) groups.set(key, { seller: key, count: 0, amount: 0, orders: [], tracks: [] });
  const g = groups.get(key);
  g.count += 1;
  g.amount += numOf(r["1688金额"]);
  const oid = (r["1688订单号"] || "").trim();
  const tn = (r["快递单号"] || "").trim();
  if (oid && g.orders.indexOf(oid) === -1) g.orders.push(oid);
  if (tn) g.tracks.push(tn);
});

const list = [...groups.values()].sort((a, b) => b.amount - a.amount);
const totalCount = list.reduce((s, g) => s + g.count, 0);
const totalAmt = list.reduce((s, g) => s + g.amount, 0);

const groupRows = list.map((g) => ({
  "卖家/供应商": g.seller,
  "已匹配可开票订单数": g.count,
  "合计金额(1688实付)": Math.round(g.amount * 100) / 100,
  "关联1688订单号": g.orders.join("；"),
  "快递单号清单": g.tracks.join("；"),
  "开票联系指引": `联系「${g.seller}」按合计金额开具发票，订单号/快递单号见上`,
}));

const sumRow = {
  "卖家/供应商": "【合计】",
  "已匹配可开票订单数": totalCount,
  "合计金额(1688实付)": Math.round(totalAmt * 100) / 100,
  "关联1688订单号": "",
  "快递单号清单": "",
  "开票联系指引": `共 ${list.length} 个卖家，合计可开票金额 ¥${Math.round(totalAmt * 100) / 100}`,
};
groupRows.push(sumRow);

const owb = XLSX.utils.book_new();
const wsGroup = XLSX.utils.json_to_sheet(groupRows);
XLSX.utils.book_append_sheet(owb, wsGroup, "按卖家分组可开票");

// 明细 sheet（保留原始匹配行，便于溯源）
const detailRows = rows.map((r) => ({
  "拼多多订单号": r["拼多多订单号"], "快递单号": r["快递单号"],
  "1688订单号": r["1688订单号"], "卖家/供应商": r["卖家/供应商"],
  "快递公司": r["快递公司"], "1688金额": r["1688金额"],
  "1688货品": r["1688货品"], "拼多多收货人": r["拼多多收货人"],
}));
const wsDetail = XLSX.utils.json_to_sheet(detailRows);
XLSX.utils.book_append_sheet(owb, wsDetail, "匹配明细");

fs.writeFileSync(OUT, XLSX.write(owb, { type: "buffer", bookType: "xlsx" }));
console.log("✅ 已写出:", OUT);
console.log("卖家数:", list.length, "｜ 已匹配可开票订单:", totalCount, "｜ 合计金额: ¥" + (Math.round(totalAmt * 100) / 100));
console.log("Top3 卖家:");
list.slice(0, 3).forEach((g) => console.log(`  - ${g.seller}：${g.count} 单，¥${Math.round(g.amount * 100) / 100}`));
