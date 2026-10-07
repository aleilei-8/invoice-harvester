// 真实结果文件回归：旧格式识别 + 新格式状态回填（使用真实 SheetJS）
const fs = require("fs");
require("vm").runInThisContext(fs.readFileSync("./xlsx.full.min.js", "utf8"), { filename: "xlsx.full.min.js" });
global.document = { addEventListener: () => {}, getElementById: () => ({ value: "", addEventListener: () => {} }) };
global.chrome = { storage: { local: { get: (d, cb) => cb({ a1688_orders: [] }), set: () => {} } } };
require("vm").runInThisContext(fs.readFileSync("./matcher.js", "utf8"), { filename: "matcher.js" });

(async () => {
  let fails = 0;
  const assert = (c, m) => { console.log((c ? "PASS" : "FAIL") + ": " + m); if (!c) fails++; };

  // ① 旧格式结果文件：识别为结果文件、不污染数据、无状态可回填
  const buf = fs.readFileSync("1688_拼多多_匹配结果_2026-10-07.xlsx");
  const parsed = await readWorkbook({ arrayBuffer: async () => buf });
  assert(parsed.sheetNames.some((nm) => /匹配结果/.test(nm)), "旧结果文件含「匹配结果」Sheet，会被识别为结果文件");
  assert(harvestStatus(parsed.wb, parsed.sheetNames) === 0, "旧格式无「开票状态」列 → 回填 0（仅跳过导入）");

  // ② 新格式：开票跟踪表 → 状态回填
  const wb3 = { SheetNames: ["开票跟踪表"], Sheets: { "开票跟踪表": XLSX.utils.json_to_sheet([
    { "拼多多订单号": "P1", "快递单号": "78x", "快递公司": "中通", "1688订单号": "A200", "卖家/供应商": "s", "1688金额": "10", "开票状态": "已开票" },
    { "拼多多订单号": "", "快递单号": "", "快递公司": "", "1688订单号": "【小计】s", "卖家/供应商": "", "1688金额": "", "开票状态": "共 1 单" },
  ]) } };
  assert(harvestStatus(wb3, wb3.SheetNames) === 1, "新格式回填 1 条（小计行排除）");
  assert(state.statusMap.get("A200") === "已开票", "A200 → 已开票");
  console.log(fails === 0 ? "=== 真实文件回归全部通过 ===" : `=== ${fails} 项失败 ===`);
  process.exit(fails ? 1 : 0);
})();
