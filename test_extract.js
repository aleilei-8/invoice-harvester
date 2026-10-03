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
// docIndex：文档顺序（用于 compareDocumentPosition 模拟）
function cell(text) { return { innerText: text }; }
function row(cells, isTh) {
  const cs = cells.map(cell);
  return {
    querySelector(sel) { return sel === "th" && isTh ? {} : null; },
    querySelectorAll(sel) { return sel === "th, td" ? cs : []; },
  };
}
function table(rows, docIndex) {
  return {
    docIndex: docIndex == null ? -1 : docIndex,
    querySelectorAll(sel) { return sel === "tr" ? rows : []; },
    compareDocumentPosition(other) { return other.docIndex > this.docIndex ? 4 : 0; },
  };
}
// 表格外节点（拼多多订单页：物流信息块渲染在订单 <table> 之外的兄弟 div 里）
function logiDiv(text, docIndex) {
  return {
    innerText: text,
    textContent: text,
    docIndex,
    closest() { return null; },
    querySelector() { return null; },
    contains() { return false; },
    compareDocumentPosition(other) { return other.docIndex > this.docIndex ? 4 : 0; },
  };
}
function makeDoc(tables, divs) {
  return {
    querySelectorAll(sel) {
      if (sel === "table") return tables;
      if (sel === "div, span, p, li, section" || sel === "div, span, p, li") return divs || [];
      return [];
    },
  };
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
  courier: ["快递公司", "承运公司", "承运商", "物流公司", "快递"],
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
  { key: "courier", label: "快递公司" },
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
console.log("[E] 拼多多订单查询页（真实 DOM）：每订单 = 独立 table（订单编号行+商品行），物流块在 table 之外的兄弟节点");
// 诊断确认：订单表 totalRows=2（不含物流行），物流信息块是表外元素
const orderTpl = ["", "商品信息", "订单/售后状态", "数量", "商品总价(元)", "实收金额(元)", "收货信息", "买家", "操作/备注"];
const t0o = table([row(orderTpl, true)], 0);
// 订单 1（已收货，物流块 = 极兔速递 JT3169616537749，行文含电话 17770199665）
const o1Head = ["", "订单编号：\n260708-334286067311450\n复制\n成交时间：2026-07-08 15:26"];
const o1Row = ["透明提拉乳贴防下垂聚拢上托硅胶胸贴防走光贴婚纱隐形乳头贴 ID: 655442592834 商品编码: 1688-818421643724 1对裸装,透明提拉圆8cm", "已收货", "1", "9.90", "9.90", "**** 查看 **** **** **** ****", "香*** 发起聊天", "查看详情 添加备注 物流信息"];
const o1Logi = "物流信息：极兔速递 JT3169616537749 复制 ✅ 您的快件已签收，签收人：【小江浔浔杂货店前台代收】。如遇物流问题无需找我家/平台，请联系紧急快递员（江千红，17770199665），投诉… 2026-07-09 11:43:28";
// 订单 2（已收货，物流块 = 中通快递 7901738059807，行文含电话，验证不误抓）
const o2Head = ["", "订单编号：\n260708-431185017272152\n复制\n成交时间：2026-07-08 05:50"];
const o2Row = ["宝娜斯胸贴防走光夏季薄款防水防汗轻薄学生无痕游泳上托自粘运动 ID: 655801575336 商品编码: 1688-647592645256 袋装一对（圆形）,（均码）", "已收货", "3", "15.72", "14.94", "**** 查看 **** **** **** ****", "**** 发起聊天", "查看详情 修改备注 物流信息"];
const o2Logi = "物流信息：中通快递 7901738059807 复制 ✅ 您的快件已送达，如有问题请联系快递员【芳哥：15062222167】，无需找我/家/平台，签收人：家人，网点电话：0510-66123255";
// 订单 3（已取消，无物流块）
const o3Head = ["", "订单编号：\n260706-493124329023938\n复制\n下单时间：2026-07-06 23:37"];
const o3Row = ["时尚卷内衣防走光贴双面隐形贴衣领固定贴双面胶 clothing tape ID: 659606645941 商品编码: 1688-670977647116 16mm*5M胶带壳带卡+3个卷,均码", "已取消", "1", "12.50", "10.63", "**** 查看 **** **** **** ****", "9*** 发起聊天", "查看详情 添加备注"];
// 订单 4（已收货，集运仓分段物流：两个物流块对应同一订单，快递公司后带 HK 路由标识）
const o4Head = ["", "订单编号：\n260706-628998869351942\n复制\n成交时间：2026-07-06 00:43"];
const o4Row = ["透明防皱皱纹贴硅胶贴自粘软胶去皱医用硅胶贴硅胶贴面部美容 ID: 663969680444 商品编码: 1688-829901726375 脸部5件套,均码", "已收货", "1", "9.68", "9.68", "**** 查看 **** **** **** ****", "E*** 发起聊天", "查看详情 添加备注 物流信息"];
const o4LogiA = "物流信息：邮政快递包裹 9901234567890 复制 🟢 包裹已到达集运仓 2026-07-08 10:00:00";
const o4LogiB = "物流信息：集运仓🟢 消夷香（二段物流） 极兔速递HK JT0024585595081 复制 🟢 包裹已从【采取自愿提取】出 2026-07-10 19:06:30";
// 真实 DOM：每订单 = table（2 行）+ 兄弟物流 div（无物流的单没有 div）
const t6 = table([row(o1Head, true), row(o1Row, false)], 1);
const t7 = table([row(o2Head, true), row(o2Row, false)], 3);
const t8 = table([row(o3Head, true), row(o3Row, false)], 5);
const t9 = table([row(o4Head, true), row(o4Row, false)], 7);
const divs = [
  logiDiv(o1Logi, 2),                                        // → 归属订单 1
  logiDiv(o2Logi, 4),                                        // → 归属订单 2
  logiDiv(o4LogiA, 8), logiDiv(o4LogiB, 9),                  // → 都归属订单 4（分段物流）
];
global.document = makeDoc([t0o, t6, t7, t8, t9], divs);
res = extractTables(PDD_KW, FIELDS_META);
check("订单查询页合并为 1 张表（orderMode）", res.tables.length === 1 && res.tables[0].orderMode === true);
if (res.tables[0]) {
  const T6 = res.tables[0];
  check("还原出 4 个订单", T6.rowCount === 4);
  check("输出 5 列（订单号/订单状态/物品/快递公司/快递单号）", T6.headers.length === 5 &&
    T6.headers.join("|") === "订单号|订单状态|物品|快递公司|快递单号");
  check("不含收货信息/买家/金额/物流信息合并列", T6.headers.indexOf("收货信息") === -1 &&
    T6.headers.indexOf("买家") === -1 && T6.headers.indexOf("金额") === -1 && T6.headers.indexOf("物流信息") === -1);
  const col = (label) => T6.headers.indexOf(label);
  const get = (r, label) => r[col(label)];
  // 订单 1（表外物流块归属正确）
  const r0 = T6.rows.find((r) => get(r, "订单号") === "260708-334286067311450");
  check("订单1 存在且订单号正确", !!r0);
  check("订单1 订单状态=已收货", r0 && get(r0, "订单状态") === "已收货");
  check("订单1 物品取自商品信息", r0 && get(r0, "物品").indexOf("透明提拉乳贴") !== -1);
  check("订单1 快递公司=极兔速递（表外物流块）", r0 && get(r0, "快递公司") === "极兔速递");
  check("订单1 快递单号=JT3169616537749（不误抓电话 17770199665）", r0 && get(r0, "快递单号") === "JT3169616537749");
  // 订单 2
  const r1 = T6.rows.find((r) => get(r, "订单号") === "260708-431185017272152");
  check("订单2 存在", !!r1);
  check("订单2 订单状态=已收货", r1 && get(r1, "订单状态") === "已收货");
  check("订单2 快递公司=中通快递", r1 && get(r1, "快递公司") === "中通快递");
  check("订单2 快递单号=7901738059807（不误抓电话 15062222167）", r1 && get(r1, "快递单号") === "7901738059807");
  check("订单2 物品取自商品信息", r1 && get(r1, "物品").indexOf("宝娜斯胸贴") !== -1);
  // 订单 3（已取消、无物流块）
  const r2 = T6.rows.find((r) => get(r, "订单号") === "260706-493124329023938");
  check("订单3 存在", !!r2);
  check("订单3 订单状态=已取消", r2 && get(r2, "订单状态") === "已取消");
  check("订单3 无物流块 → 快递公司/单号为空", r2 && get(r2, "快递公司") === "" && get(r2, "快递单号") === "");
  // 订单 4（集运仓分段物流：两个物流块都归属该订单）
  const r3 = T6.rows.find((r) => get(r, "订单号") === "260706-628998869351942");
  check("订单4（集运仓）存在", !!r3);
  check("订单4 订单状态=已收货", r3 && get(r3, "订单状态") === "已收货");
  check("订单4 快递公司含两段（邮政快递包裹、极兔速递）", r3 && get(r3, "快递公司").indexOf("邮政快递包裹") !== -1 && get(r3, "快递公司").indexOf("极兔速递") !== -1);
  check("订单4 快递单号含两段（9901234567890、JT0024585595081）", r3 && get(r3, "快递单号").indexOf("9901234567890") !== -1 && get(r3, "快递单号").indexOf("JT0024585595081") !== -1);
  check("订单4 HK 路由标识已剥离", r3 && get(r3, "快递公司").indexOf("HK") === -1);
  check("订单4 物品取自商品信息", r3 && get(r3, "物品").indexOf("透明防皱皱纹贴") !== -1);
}

console.log("\n" + (fail === 0 ? "ALL TESTS PASSED ✅" : fail + " TEST(S) FAILED ❌"));
process.exit(fail === 0 ? 0 : 1);
