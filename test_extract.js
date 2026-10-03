// 测试 extractTables（注入函数）：用最小假 DOM 模拟拼多多真实表格结构
// 用法：node test_extract.js
const fs = require("fs");
const path = require("path");

const D = __dirname;
let fail = 0;
function check(name, cond) {
  console.log((cond ? "  ✓ " : "  ✗ ") + name);
  if (!cond) fail++;
}

// ---- 从 popup.js 抽出自包含的 extractTables 源码并求值 ----
const src = fs.readFileSync(path.join(D, "popup.js"), "utf8");
const m = src.match(/function extractTables\(roleKeywords, fields\) \{[\s\S]*?\n\}/);
if (!m) { console.error("未找到 extractTables 函数"); process.exit(1); }
const extractTables = new Function(
  "return (" + m[0] + ");"
)();

// ---- 最小假 DOM ----
function cell(text) { return { innerText: text }; }
function row(cells, isTh) {
  const cs = cells.map(cell);
  return {
    querySelector(sel) { return sel === "th" && isTh ? {} : null; },
    querySelectorAll(sel) { return sel === "th, td" ? cs : []; },
  };
}
function table(rows) {
  return { querySelectorAll(sel) { return sel === "tr" ? rows : []; } };
}
function makeDoc(tables) {
  return { querySelectorAll(sel) { return sel === "table" ? tables : []; } };
}

// 拼多多关键词预设（与 popup.js 保持一致）
const PDD_KW = {
  buyer_title: ["发票抬头", "抬头", "公司名称", "购买方名称", "购方名称", "名称"],
  tax_no: ["企业税号", "税号", "纳税人识别号", "统一社会信用代码", "识别号", "信用代码", "tax", "tin", "纳税人"],
  order_id: ["订单号", "订单编号", "订单", "单号", "order", "no.", "编号"],
  tracking_no: ["快递单号", "物流单号", "运单号", "货运单号", "tracking", "waybill", "物流"],
  amount: ["发票金额", "金额", "价税合计", "开票金额", "实付金额", "合计", "金额(元)", "amount", "price", "价税"],
  items: ["物品", "商品", "发票内容", "货物", "货品", "商品名称", "item", "product", "内容", "品名"],
  invoice_date: ["开票时间", "开票日期", "开票日期时间"],
  apply_date: ["申请时间", "申请日期", "apply"],
  buyer: ["买家", "收货人", "购买方", "customer", "consignee", "收件人"],
};

// ================================================================
console.log("[A] 拼多多真实结构：粘性表头单独成表 + 数据表（诊断原文结构）");
// 表 0：真实表头（th），无数据行 —— 拼多多把表头单独渲染
const realHeaders = ["", "订单号", "订单状态", "售后状态", "申请时间", "发票金额", "开票方式", "发票种类", "发票类型", "抬头类型", "发票抬头", "企业税号", "其他信息", "发票邮寄地址", "承诺开票时间", "操作"];
const t0 = table([row(realHeaders, true)]);
// 表 1：数据表，无 th，首行数据被旧版误当表头
const data1 = ["", "251012-155629667940889 逾期未开票", "已收货", "正常", "2026-02-28 20:38:10", "¥14.85", "手动", "电票", "蓝票", "企业", "新疆智源常安商贸有限公司", "91650106MAEBKLB17B", "开户银行：中国农业银行;", "-", "2026-03-30 20:38:10 已逾期186天", "录入发票"];
const data2 = ["", "260307-493397010721912 逾期未开票", "已收货", "正常", "2026-04-17 12:26:09", "¥11.21", "手动", "电票", "蓝票", "企业", "长沙慧泽美百货有限公司", "91430102MAEFUWCL51", "-", "-", "2026-05-17 12:26:09 已逾期139天", "录入发票"];
const t1 = table([row(data1, false), row(data2, false)]);

global.document = makeDoc([t0, t1]);
let res = extractTables(PDD_KW, []);
check("合并后只输出 1 张数据表", res.tables.length === 1);
const T = res.tables[0];
check("两行数据都在（误当表头的那行已恢复）", T && T.rowCount === 2);
if (T) {
  const roleOf = (i) => T.roleMap[i] || "";
  check("订单号 → order_id", roleOf(1) === "order_id");
  check("申请时间 → apply_date", roleOf(4) === "apply_date");
  check("发票金额 → amount", roleOf(5) === "amount");
  check("发票抬头 → buyer_title", roleOf(10) === "buyer_title");
  check("企业税号 → tax_no", roleOf(11) === "tax_no");
  check("抬头类型 不抢 buyer_title", roleOf(9) === "");
  check("订单状态 不抢 order_id", roleOf(2) === "");
  check("承诺开票时间 不映射为 invoice_date", roleOf(14) === "");
  check("首行数据可取到发票抬头", T.rows[0][10] === "新疆智源常安商贸有限公司");
  check("第二行税号正确", T.rows[1][11] === "91430102MAEFUWCL51");
}

// ================================================================
console.log("[B] 回归：普通表格（th 表头 + 数据行在同一张表）");
const h2 = ["订单编号", "发票抬头", "税号", "金额"];
const t2 = table([
  row(h2, true),
  row(["1234567890", "甲公司", "91110000X", "¥100.00"], false),
  row(["9876543210", "乙公司", "91220000Y", "¥55.50"], false),
]);
global.document = makeDoc([t2]);
res = extractTables(PDD_KW, []);
check("识别 1 张表 2 行", res.tables.length === 1 && res.tables[0].rowCount === 2);
if (res.tables[0]) {
  const rm = res.tables[0].roleMap;
  check("订单编号→order_id", (rm[0] || "") === "order_id");
  check("发票抬头→buyer_title", (rm[1] || "") === "buyer_title");
  check("税号→tax_no", (rm[2] || "") === "tax_no");
  check("金额→amount", (rm[3] || "") === "amount");
}

// ================================================================
console.log("[C] 无表头表：内容嗅探兜底");
const t3 = table([
  row(["2603007-49339701071913", "¥19.88", "备注文字"], false),
  row(["2603007-49339701071999", "¥6.93", "备注文字"], false),
]);
global.document = makeDoc([t3]);
res = extractTables(PDD_KW, []);
check("识别 1 张表 2 行", res.tables.length === 1 && res.tables[0].rowCount === 2);
if (res.tables[0]) {
  const rm = res.tables[0].roleMap;
  check("嗅探：数字长串列→order_id", (rm[0] || "") === "order_id");
  check("嗅探：¥列→amount", (rm[1] || "") === "amount");
}

// ================================================================
console.log("[D] 数据表在前、纯表头表在后（DOM 顺序颠倒也能合并）");
const t4 = table([row(data1, false), row(data2, false)]); // 无 th
const t5 = table([row(realHeaders, true)]);                // 纯表头
global.document = makeDoc([t4, t5]);
res = extractTables(PDD_KW, []);
check("仍识别 1 张表", res.tables.length === 1);
if (res.tables[0]) {
  check("表头来自后面的纯表头表", res.tables[0].headers[10] === "发票抬头");
  check("行数正确", res.tables[0].rowCount === 2);
}

console.log("\n" + (fail === 0 ? "ALL TESTS PASSED ✅" : fail + " TEST(S) FAILED ❌"));
process.exit(fail === 0 ? 0 : 1);
