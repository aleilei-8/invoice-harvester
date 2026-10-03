// Node 单元测试：验证 lib.js 纯逻辑 + 通过 SheetJS 生成/回读 XLSX（与插件内联库一致）
const path = require("path");
const EXT = "C:/Users/JoShua/WorkBuddy/2026-09-10-00-31-02/pdd-invoice-grabber";
const LIB = require(path.join(EXT, "lib.js"));
const XLSX = require(path.join(EXT, "xlsx.full.min.js"));

let fail = 0;
function check(name, cond) {
  if (cond) { console.log("  ✓ " + name); }
  else { console.log("  ✗ " + name); fail++; }
}

// ---- mock 数据：含同公司多笔、未填抬头、带货币符号金额 ----
const recs = [
  { buyer_title: "北京示例科技有限公司", tax_no: "91110000MA01ABCD2X", order_id: "PDD-001", amount: "¥1,234.50", items: "口红" },
  { buyer_title: "北京示例科技有限公司", tax_no: "91110000MA01ABCD2X", order_id: "PDD-002", amount: "200.00", items: "面膜" },
  { buyer_title: "上海测试贸易有限公司", tax_no: "91310000MA02EFGH3Y", order_id: "PDD-003", amount: "88.8", items: "精华" },
  { buyer_title: "", tax_no: "", order_id: "PDD-004", amount: "50", items: "样品" },
];

console.log("[1] parseAmount");
check("¥1,234.50 -> 1234.5", LIB.parseAmount("¥1,234.50") === 1234.5);
check("200.00 -> 200", LIB.parseAmount("200.00") === 200);
check("非法文本 -> 0", LIB.parseAmount("abc") === 0);
check("null -> 0", LIB.parseAmount(null) === 0);

console.log("[2] groupByTitle");
const groups = LIB.groupByTitle(recs);
check("分组数 = 3", groups.length === 3);
const bj = groups.find(g => g.title === "北京示例科技有限公司");
check("北京公司 笔数 = 2", bj && bj.count === 2);
check("北京公司 合计 = 1434.5", bj && bj.total === 1434.5);
check("北京公司 订单列表", bj && bj.orders.join(",") === "PDD-001,PDD-002");
check("按金额降序（北京居首）", groups[0].title === "北京示例科技有限公司");
const empty = groups.find(g => g.title === "(未填写抬头)");
check("未填抬头单独成组", empty && empty.count === 1);

console.log("[3] buildSheets");
const sheets = LIB.buildSheets(recs, { includeGrouped: true });
check("2 个 sheet", sheets.length === 2);
check("明细 sheet 名称", sheets[0].name === "开票明细");
check("明细行数 = 记录数+1(表头)", sheets[0].rows.length === recs.length + 1);
check("汇总 sheet 名称", sheets[1].name === "按抬头汇总");
// 汇总 = 1 表头 + 3 分组 + 1 合计 = 5
check("汇总行数 = 5", sheets[1].rows.length === 5);
const totalRow = sheets[1].rows[4];
check("汇总合计笔数 = 4", totalRow[2] === 4);
check("汇总合计金额正确", Math.abs(totalRow[3] - (1234.5 + 200 + 88.8 + 50)) < 1e-6);
const sheets2 = LIB.buildSheets(recs, { includeGrouped: false });
check("关闭汇总时仅 1 个 sheet", sheets2.length === 1);

console.log("[4] SheetJS 生成 + 回读（与插件内联库一致）");
let wb;
try { wb = LIB.sheetsToWorkbook(sheets, XLSX); }
catch (e) { check("sheetsToWorkbook 不抛错", false); console.log("    " + e.message); }
const fs = require("fs");
const out = "C:/Users/JoShua/WorkBuddy/2026-09-10-00-31-02/pdd-invoice-grabber/test_out.tmp.xlsx";
// 说明：本机 Node 环境下 SheetJS 的 XLSX.writeFile（fs 写入）受限，改用 XLSX.write 生成 buffer，
// 再用 Node fs 落盘并回读——与浏览器内 XLSX.writeFile（触发下载）共用同一套 workbook 构建逻辑。
const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
check("XLSX.write 生成 buffer 非空", buf && buf.length > 0);
fs.writeFileSync(out, buf);
check("已落盘为有效文件", fs.existsSync(out) && fs.statSync(out).size > 0);
let wb2;
try { wb2 = XLSX.read(buf, { type: "buffer" }); }
catch (e) { check("XLSX.read 回读不抛错", false); console.log("    " + e.message); }
const names = wb2.SheetNames;
check("包含两个 sheet 名", names.indexOf("开票明细") >= 0 && names.indexOf("按抬头汇总") >= 0);
const detail = XLSX.utils.sheet_to_json(wb2.Sheets["开票明细"], { header: 1 });
check("回读明细行数一致", detail.length === recs.length + 1);
const sum = XLSX.utils.sheet_to_json(wb2.Sheets["按抬头汇总"], { header: 1 });
check("回读汇总行数一致", sum.length === 5);
check("回读汇总合计金额正确", Math.abs(sum[4][3] - (1234.5 + 200 + 88.8 + 50)) < 1e-6);

console.log("[5] cleanOrderId（混合文本提取纯单号）");
check("「单号 状态」混合文本", LIB.cleanOrderId("2603007-49339701071913 逾期未开票") === "2603007-49339701071913");
check("纯数字单号", LIB.cleanOrderId("20260913-1234567890") === "20260913-1234567890");
check("带前缀文本", LIB.cleanOrderId("订单号：PDD20260913001") === "PDD20260913001");
check("普通文本原样保留", LIB.cleanOrderId("无单号") === "无单号");
check("空值 -> 空串", LIB.cleanOrderId("") === "" && LIB.cleanOrderId(null) === "");

console.log("[6] sniffRole（内容特征嗅探）");
check("订单号列 -> order_id", LIB.sniffRole(["2603007-49339701071913 逾期未开票", "2603033-685496102431352 逾期未开票", "2603011-083571545700889"]) === "order_id");
check("金额列 -> amount", LIB.sniffRole(["¥1,234.50", "200.00", "88.8"]) === "amount");
check("日期列 -> invoice_date", LIB.sniffRole(["2026-09-13 10:00:00", "2026-09-12 09:30:00", "2026年9月10日"]) === "invoice_date");
check("普通文本 -> null", LIB.sniffRole(["已发货", "待付款", "已完成"]) === null);
check("空列 -> null", LIB.sniffRole([]) === null);

console.log("\n" + (fail === 0 ? "ALL TESTS PASSED ✅" : (fail + " TEST(S) FAILED ❌")));
try { if (fs.existsSync(out)) fs.unlinkSync(out); } catch (e) {}
process.exit(fail === 0 ? 0 : 1);
