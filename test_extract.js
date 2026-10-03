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
  invoice_kind: ["发票种类", "发票类别", "种类"],
  invoice_type: ["发票类型", "蓝票", "红票"],
  extra_info: ["其他信息", "开户银行", "开户行"],
  order_id: ["订单号", "订单编号", "订单", "单号", "order", "no.", "编号"],
  order_status: ["订单/售后状态", "订单状态", "成交状态"],
  after_sale: ["售后状态", "售后"],
  tracking_no: ["快递单号", "物流单号", "运单号", "货运单号", "tracking", "waybill"],
  logistics: ["物流信息", "物流"],
  amount: ["发票金额", "实收金额", "金额", "价税合计", "开票金额", "实付金额", "合计", "金额(元)", "amount", "price", "价税"],
  items: ["商品信息", "商品名称", "物品", "商品", "发票内容", "货物", "货品", "宝贝标题", "item", "product", "内容", "品名"],
  invoice_date: ["开票时间", "开票日期", "开票日期时间"],
  apply_date: ["申请时间", "申请日期", "apply"],
  buyer: ["买家", "收货人", "购买方", "customer", "consignee", "收件人"],
};

const FIELDS_META = [
  { key: "buyer_title", label: "发票抬头" },
  { key: "tax_no", label: "税号" },
  { key: "invoice_kind", label: "发票种类" },
  { key: "invoice_type", label: "发票类型" },
  { key: "extra_info", label: "其他信息" },
  { key: "order_id", label: "订单号" },
  { key: "order_status", label: "订单状态" },
  { key: "after_sale", label: "售后状态" },
  { key: "trans_time", label: "成交时间" },
  { key: "qty", label: "数量" },
  { key: "goods_total", label: "商品总价" },
  { key: "amount", label: "金额" },
  { key: "tracking_no", label: "快递单号" },
  { key: "logistics", label: "物流信息" },
  { key: "ship_to", label: "收货信息" },
  { key: "items", label: "物品" },
  { key: "invoice_date", label: "开票时间" },
  { key: "apply_date", label: "申请时间" },
  { key: "buyer", label: "买家" },
  { key: "remark", label: "备注" },
];

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
  check("发票种类 → invoice_kind", roleOf(7) === "invoice_kind");
  check("发票类型 → invoice_type", roleOf(8) === "invoice_type");
  check("其他信息 → extra_info", roleOf(12) === "extra_info");
  check("抬头类型 不抢 buyer_title", roleOf(9) === "");
  check("订单状态 → order_status（不抢 order_id）", roleOf(2) === "order_status");
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

// ================================================================
console.log("[E] 拼多多订单查询页（真实结构+截图物流行）：每订单独立 table = 订单编号行 + 商品行 + 物流行");
// 表 0：纯表头模板表（含 商品信息/订单·售后状态…，0 数据行）
const orderTpl = ["", "商品信息", "订单/售后状态", "数量", "商品总价(元)", "实收金额(元)", "收货信息", "买家", "操作/备注"];
const t0o = table([row(orderTpl, true)]);
// 订单 1（已收货，物流行 = 极兔速递 J1309616537749，截图真实文本）
const o1Head = ["", "订单编号：\n260708-334286067311450\n复制\n成交时间：2026-07-08 15:26"];
const o1Row = ["透明提拉乳贴防下垂聚拢上托硅胶胸贴防走光贴婚纱隐形乳头贴 ID: 655442592834 商品编码: 1688-818421643724 1对裸装,透明提拉圆8cm", "已收货", "1", "9.90", "9.90", "**** 查看 **** **** **** ****", "香*** 发起聊天", "查看详情 添加备注 物流信息"];
const o1Logi = ["物流信息：极兔速递 J1309616537749 复制 ✅ 您的快件已签收，签收人：【小江浔浔瑶台代收】，如遇物品问题无法找我家/平台，请联系快递员（千）"];
// 订单 2（已收货，物流行 = 中通快递 7901738059807，行文含电话号码，验证不误抓电话）
const o2Head = ["", "订单编号：\n260708-431185017272152\n复制\n成交时间：2026-07-08 05:50"];
const o2Row = ["宝娜斯胸贴防走光夏季薄款防水防汗轻薄学生无痕游泳上托自粘运动 ID: 655801575336 商品编码: 1688-647592645256 袋装一对（圆形）,（均码）", "已收货", "3", "15.72", "14.94", "**** 查看 **** **** **** ****", "**** 发起聊天", "查看详情 修改备注 物流信息"];
const o2Logi = ["物流信息：中通快递 7901738059807 复制 ✅ 您的快件已送达，如有问题请联系快递员【芳哥：15062222167】，无需找我/家/平台，签收人：家人，网点电话：0510-66123255"];
// 订单 3（已取消，无物流行）
const o3Head = ["", "订单编号：\n260706-493124329023938\n复制\n下单时间：2026-07-06 23:37"];
const o3Row = ["时尚卷内衣防走光贴双面隐形贴衣领固定贴双面胶 clothing tape ID: 659606645941 商品编码: 1688-670977647116 16mm*5M胶带壳带卡+3个卷,均码", "已取消", "1", "12.50", "10.63", "**** 查看 **** **** **** ****", "9*** 发起聊天", "查看详情 添加备注"];
// 真实 DOM：每个订单是独立的 <table>（数据行数 = 商品行 + 物流行）
const t6 = table([row(o1Head, true), row(o1Row, false), row(o1Logi, false)]);
const t7 = table([row(o2Head, true), row(o2Row, false), row(o2Logi, false)]);
const t8 = table([row(o3Head, true), row(o3Row, false)]);
global.document = makeDoc([t0o, t6, t7, t8]);
res = extractTables(PDD_KW, FIELDS_META);
check("订单查询页合并为 1 张表（orderMode）", res.tables.length === 1 && res.tables[0].orderMode === true);
if (res.tables[0]) {
  const T6 = res.tables[0];
  check("还原出 3 个订单", T6.rowCount === 3);
  check("订单页只输出 4 列（订单号/物品/快递单号/物流信息）", T6.headers.length === 4 &&
    T6.headers.join("|") === "订单号|物品|快递单号|物流信息");
  check("不含收货信息/买家/金额等列", T6.headers.indexOf("收货信息") === -1 &&
    T6.headers.indexOf("买家") === -1 && T6.headers.indexOf("金额") === -1);
  const col = (label) => T6.headers.indexOf(label);
  const get = (r, label) => r[col(label)];
  // 订单 1
  const r0 = T6.rows.find((r) => get(r, "订单号") === "260708-334286067311450");
  check("订单1 存在且订单号正确", !!r0);
  check("订单1 物品取自商品信息", r0 && get(r0, "物品").indexOf("透明提拉乳贴") !== -1);
  check("订单1 快递单号=J1309616537749（字母开头运单号）", r0 && get(r0, "快递单号") === "J1309616537749");
  check("订单1 物流信息含快递公司「极兔速递」", r0 && get(r0, "物流信息").indexOf("极兔速递") !== -1);
  check("订单1 物流信息含运单号", r0 && get(r0, "物流信息") === "极兔速递 J1309616537749");
  // 订单 2
  const r1 = T6.rows.find((r) => get(r, "订单号") === "260708-431185017272152");
  check("订单2 存在", !!r1);
  check("订单2 快递单号=7901738059807（不误抓行内电话 15062222167）", r1 && get(r1, "快递单号") === "7901738059807");
  check("订单2 物流信息含「中通快递」", r1 && get(r1, "物流信息").indexOf("中通快递") !== -1);
  check("订单2 物品取自商品信息", r1 && get(r1, "物品").indexOf("宝娜斯胸贴") !== -1);
  // 订单 3（已取消、无物流行 → 物流列为空）
  const r2 = T6.rows.find((r) => get(r, "订单号") === "260706-493124329023938");
  check("订单3 存在", !!r2);
  check("订单3 无物流行 → 快递单号为空", r2 && get(r2, "快递单号") === "");
  check("订单3 无物流按钮标记（操作列无「物流信息」）", r2 && get(r2, "物流信息") === "");
}

console.log("\n" + (fail === 0 ? "ALL TESTS PASSED ✅" : fail + " TEST(S) FAILED ❌"));
process.exit(fail === 0 ? 0 : 1);
