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

// ---- 从 pagefuncs.js 抽出自包含的 extractTables 源码并求值 ----
// （注入函数已从 popup.js 抽到 pagefuncs.js，供弹窗与目标页面共用）
const src = fs.readFileSync(path.join(D, "pagefuncs.js"), "utf8");
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
    __text: cells.map((c) => String(c).replace(/\s+/g, " ").trim()).join(" "),
    querySelector(sel) { return sel === "th" && isTh ? {} : null; },
    querySelectorAll(sel) { return sel === "th, td" ? cs : []; },
  };
}
// 订单表：同时具备 tr 查询（表格解析）与 innerText/children（v2.5.4 DOM 锚定）
function table(rows) {
  return {
    innerText: rows.map((r) => r.__text || "").join(" "),
    textContent: rows.map((r) => r.__text || "").join(" "),
    children: [],
    parentElement: null,
    querySelectorAll(sel) { return sel === "tr" ? rows : []; },
  };
}
// 表格外的普通节点（拼多多把物流块渲染在订单 table 之外的兄弟节点）
function block(text) {
  return { innerText: text, textContent: text, children: [], parentElement: null };
}
// 容器：把子节点挂上 parentElement，并聚合 innerText（模拟真实 DOM 层级）
function container(children) {
  const el = {
    children,
    parentElement: null,
    innerText: children.map((c) => String(c.innerText || "")).join(" "),
    textContent: children.map((c) => String(c.textContent || "")).join(" "),
  };
  children.forEach((c) => { c.parentElement = el; });
  return el;
}
// body.innerText 平面文本（v2.5.1：物流配对不再依赖 DOM 结构，只看文本顺序）
function makeDoc(tables, bodyText) {
  return {
    querySelectorAll(sel) { return sel === "table" ? tables : []; },
    body: { innerText: bodyText || "" },
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
console.log("[E] 拼多多订单查询页（v2.5.1 平面文本配对）：每订单独立 table，物流行在 body 文本中紧跟自己订单的订单编号之后");
// 诊断确认：订单表 totalRows=2（不含物流行），且 DOM 元素扫描采不到物流块 → 用 body.innerText 配对
const orderTpl = ["", "商品信息", "订单/售后状态", "数量", "商品总价(元)", "实收金额(元)", "收货信息", "买家", "操作/备注"];
const t0o = table([row(orderTpl, true)]);
// 订单 1（已收货，物流 = 极兔速递 JT3169616537749；注意单号与「复制」无空格，行文含电话 17770199665）
// ⚠️ 真实原文含「联系兔兔快递员（江千红，17770199665）」陷阱：
//    「兔兔快递」以「快递」结尾，若不要求运单号紧跟公司词，电话 17770199665 会被误抓成单号。
const o1Head = ["", "订单编号：\n260708-334286067311450\n复制\n成交时间：2026-07-08 15:26"];
const o1Row = ["透明提拉乳贴防下垂聚拢上托硅胶胸贴防走光贴婚纱隐形乳头贴 ID: 655442592834 商品编码: 1688-818421643724 1对裸装,透明提拉圆8cm", "已收货", "1", "9.90", "9.90", "**** 查看 **** **** **** ****", "香*** 发起聊天", "查看详情 添加备注 物流信息"];
const o1Logi = "物流信息：极兔速递 JT3169616537749复制 您的快件已签收，签收人：【小江南杂店前台代收】。如遇物流问题无需找商家/平台，请联系兔兔快递员（江千红，17770199665），投诉电话：（0701-6443743/13317256927）（有事呼叫我，少一次投诉，多一份感恩）。 2026-07-09 11:43:28";
// 订单 2（已收货，物流 = 中通快递 79017338059807；单号与「复制」无空格，行文含多个电话）
const o2Head = ["", "订单编号：\n260708-431185017272152\n复制\n成交时间：2026-07-08 05:50"];
const o2Row = ["宝娜斯胸贴防走光夏季薄款防水防汗轻薄学生无痕游泳上托自粘运动 ID: 655801575336 商品编码: 1688-647592645256 袋装一对（圆形）,（均码）", "已收货", "3", "15.72", "14.94", "**** 查看 **** **** **** ****", "**** 发起聊天", "查看详情 修改备注 物流信息"];
const o2Logi = "物流信息：中通快递 79017338059807复制 您的快件已送达，如遇问题请联系快递员【孙雨：15862222167】，无需找商家/平台。签收人：家人 ，网点电话：0510-66123255，投诉电话：0510-85306302、17715401560。关注“中通快递”官方微信公众号反馈问题，处理更快捷！感谢使用中通快递，期待再次为您服务！ 2026-07-09 10:22:15";
// 订单 3（已取消，无物流行）
const o3Head = ["", "订单编号：\n260706-493124329023938\n复制\n下单时间：2026-07-06 23:37"];
const o3Row = ["时尚卷内衣防走光贴双面隐形贴衣领固定贴双面胶 clothing tape ID: 659606645941 商品编码: 1688-670977647116 16mm*5M胶带壳带卡+3个卷,均码", "已取消", "1", "12.50", "10.63", "**** 查看 **** **** **** ****", "9*** 发起聊天", "查看详情 添加备注"];
// 订单 4（已收货，集运仓分段物流：两个物流段对应同一订单，快递公司后带 HK 路由标识）
const o4Head = ["", "订单编号：\n260706-628998869351942\n复制\n成交时间：2026-07-06 00:43"];
const o4Row = ["透明防皱皱纹贴硅胶贴自粘软胶去皱医用硅胶贴硅胶贴面部美容 ID: 663969680444 商品编码: 1688-829901726375 脸部5件套,均码", "已收货", "1", "9.68", "9.68", "**** 查看 **** **** **** ****", "E*** 发起聊天", "查看详情 添加备注 物流信息"];
const o4LogiA = "物流信息：邮政快递包裹 9901234567890复制 🟢 包裹已到达集运仓 2026-07-08 10:00:00";
const o4LogiB = "物流信息：集运仓🟢 消费者（二段物流） 极兔速递HK JT0024585595081复制 🟢 包裹已从【采取自愿提取】出 2026-07-10 19:06:30";
// 订单 5/6/7：直接取用户回传诊断中的真实订单 + 真实物流原文（同页面另外三单）
const o5Head = ["", "订单编号：\n260708-315894023722381\n复制\n成交时间：2026-07-08 08:53"];
const o5Row = ["透明防皱皱纹贴硅胶贴自粘软胶去皱医用硅胶贴硅胶贴面部美容 ID: 663969680444 商品编码: 1688-829901726375 脸部5件套,均码", "已收货", "1", "9.68", "9.68", "**** 查看 **** **** **** ****", "达*** 发起聊天", "查看详情 添加备注 物流信息"];
const o5Logi = "物流信息：申通快递 773430693399235复制 已签收，签收人凭取货码签收。，可关注“申通快递”官方微信公众号获取实时";
const o6Head = ["", "订单编号：\n260708-256964114872152\n复制\n有备注\n成交时间：2026-07-08 05:49"];
const o6Row = ["宝娜斯胸贴防走光夏季薄款防水防汗轻薄学生无痕游泳上托自粘运动 ID: 655801575336 商品编码: 1688-647592645256 袋装一对（花形）,（均码）", "已收货", "3", "15.72", "14.94", "**** 查看 **** **** **** ****", "**** 发起聊天", "查看详情 修改备注 买家留言：1502926 买家留言：1502926 物流信息"];
const o6Logi = "物流信息：中通快递 79017338059797复制 您的快件已送达，如遇问题请联系快递员【孙雨：15862222167】，无需找商家/平台。签收人：家人 ，网点电话：0510-66123255，投诉电话：0510-85306302、17715401560。关注“中通快递”官方微信公众号反馈问题，处理更快捷！感谢使用中通快递，期待再次为您服务！ 2026-07-09 10:21:51";
const o7Head = ["", "订单编号：\n260707-312706352723581\n复制\n成交时间：2026-07-07 12:39"];
const o7Row = ["日本遮疤痕隐形贴纹身遮盖贴凹凸疤胎记遮疤神器假皮肤遮纹身肉色 ID: 660293020240 商品编码: 1688-784463093767 自然肤色（一套10张）,15*9CM", "已收货", "1", "14.85", "14.85", "**** 查看 **** **** **** ****", "淡*** 发起聊天", "查看详情 添加备注 物流信息"];
const o7Logi = "物流信息：极兔速递 JT3169487522969复制 包裹已签收！（凭取件码）如有问题请电联：赵彦民 13142390000，投诉电话：0451-51750694 2026-07-10 16:17:21";
// 真实 DOM：每订单 = table（2 行）；body 文本 = 订单卡片按视觉顺序拼接
//（操作列含「物流信息」按钮——无冒号，验证不会被当成物流行）
const t6 = table([row(o1Head, true), row(o1Row, false)]);
const t7 = table([row(o2Head, true), row(o2Row, false)]);
const t8 = table([row(o3Head, true), row(o3Row, false)]);
const t9 = table([row(o4Head, true), row(o4Row, false)]);
const t10 = table([row(o5Head, true), row(o5Row, false)]);
const t11 = table([row(o6Head, true), row(o6Row, false)]);
const t12 = table([row(o7Head, true), row(o7Row, false)]);
const bodyText = [
  o1Head[1], o1Row.join(" "), o1Logi,
  o2Head[1], o2Row.join(" "), o2Logi,
  o3Head[1], o3Row.join(" "),
  o4Head[1], o4Row.join(" "), o4LogiA, o4LogiB,
  o5Head[1], o5Row.join(" "), o5Logi,
  o6Head[1], o6Row.join(" "), o6Logi,
  o7Head[1], o7Row.join(" "), o7Logi,
].join(" ");
global.document = makeDoc([t0o, t6, t7, t8, t9, t10, t11, t12], bodyText);
res = extractTables(PDD_KW, FIELDS_META);
check("订单查询页合并为 1 张表（orderMode）", res.tables.length === 1 && res.tables[0].orderMode === true);
if (res.tables[0]) {
  const T6 = res.tables[0];
  check("还原出 7 个订单（含 5 条真实诊断订单 + 集运仓构造单）", T6.rowCount === 7);
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
  check("订单1 快递单号=JT3169616537749（单号紧贴「复制」无空格也能切出）", r0 && get(r0, "快递单号") === "JT3169616537749");
  // 陷阱防护：「兔兔快递员（江千红，17770199665）」不得以电话冒充单号 / 公司
  check("订单1 未误抓行文电话 17770199665 作单号", r0 && get(r0, "快递单号").indexOf("17770199665") === -1);
  check("订单1 未把「兔兔快递」误判为公司", r0 && get(r0, "快递公司").indexOf("兔兔") === -1);
  // 订单 2
  const r1 = T6.rows.find((r) => get(r, "订单号") === "260708-431185017272152");
  check("订单2 存在", !!r1);
  check("订单2 订单状态=已收货", r1 && get(r1, "订单状态") === "已收货");
  check("订单2 快递公司=中通快递", r1 && get(r1, "快递公司") === "中通快递");
  check("订单2 快递单号=79017338059807（不误抓电话 15862222167/17715401560）", r1 && get(r1, "快递单号") === "79017338059807");
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
  // 订单 5/6/7：诊断原文中的真实订单，逐一核对
  const r5 = T6.rows.find((r) => get(r, "订单号") === "260708-315894023722381");
  check("订单5（真实）申通快递 773430693399235", r5 && get(r5, "快递公司") === "申通快递" && get(r5, "快递单号") === "773430693399235");
  const r6 = T6.rows.find((r) => get(r, "订单号") === "260708-256964114872152");
  check("订单6（真实）中通快递 79017338059797", r6 && get(r6, "快递公司") === "中通快递" && get(r6, "快递单号") === "79017338059797");
  const r7 = T6.rows.find((r) => get(r, "订单号") === "260707-312706352723581");
  check("订单7（真实）极兔速递 JT3169487522969（不误抓电话 13142390000）", r7 && get(r7, "快递公司") === "极兔速递" && get(r7, "快递单号") === "JT3169487522969");
}

// ================================================================
console.log("[F] 集运仓/二段物流 变体：公司名带 HK、HK 前有空格、标签无冒号 都必须能提取");
function makeOrder(oid, logiText) {
  const head = ["", "订单编号：\n" + oid + "\n复制\n成交时间：2026-07-06 00:43"];
  const rowGoods = ["透明防皱皱纹贴 ID: 663969680444 商品编码: 1688-829901726375 脸部5件套,均码", "已收货", "1", "9.68", "9.68", "**** 查看 **** **** **** ****", "E*** 发起聊天", "查看详情 添加备注 物流信息"];
  const tb = table([row(head, true), row(rowGoods, false)]);
  return { tb, oid, logiText };
}
const variants = [
  // ① 截图真实原文：集运仓 + 消费者（二段物流） + 极兔速递HK
  makeOrder("260706-628998869351942", "物流信息：集运仓🟢 消费者（二段物流） 极兔速递HK JT0024585595081复制 🟢 包裹已从【采取自愿提取】出 2026-07-10 19:06:30"),
  // ② 公司名与 HK 之间有空格（旧实现会因「HK」不足 8 位而整条丢弃）
  makeOrder("260101-111111111111111", "物流信息：集运仓🔴 消费者（二段物流） 极兔速递 HK JT0024585595099复制 包裹已出仓 2026-07-11 09:00:00"),
  // ③ 标签无冒号（部分组件渲染差异）
  makeOrder("260101-222222222222222", "物流信息 中通快递 7900000000001复制 您的快件已送达"),
];
const tlist = [table([row(orderTpl, true)])];
const bodyParts = [];
variants.forEach((v) => {
  tlist.push(v.tb);
  bodyParts.push(v.tb.querySelectorAll("tr")[0].querySelectorAll("th, td")[1].innerText, v.tb.querySelectorAll("tr")[1].querySelectorAll("th, td").map((c) => c.innerText).join(" "), v.logiText);
});
global.document = makeDoc(tlist, bodyParts.join(" "));
res = extractTables(PDD_KW, FIELDS_META);
const TV = res.tables[0];
if (TV) {
  const colV = (label) => TV.headers.indexOf(label);
  const getV = (r, label) => r[colV(label)];
  const v1 = TV.rows.find((r) => getV(r, "订单号") === "260706-628998869351942");
  check("变体1 集运仓真实原文 → 极兔速递 / JT0024585595081", v1 && getV(v1, "快递公司") === "极兔速递" && getV(v1, "快递单号") === "JT0024585595081");
  const v2 = TV.rows.find((r) => getV(r, "订单号") === "260101-111111111111111");
  check("变体2 公司名与 HK 之间有空格 → 极兔速递 / JT0024585595099", v2 && getV(v2, "快递公司") === "极兔速递" && getV(v2, "快递单号") === "JT0024585595099");
  check("变体2 未把 HK 当单号", v2 && getV(v2, "快递单号") !== "HK");
  const v3 = TV.rows.find((r) => getV(r, "订单号") === "260101-222222222222222");
  check("变体3 标签无冒号 → 中通快递 / 7900000000001", v3 && getV(v3, "快递公司") === "中通快递" && getV(v3, "快递单号") === "7900000000001");
} else {
  check("变体组应解析出 1 张订单表", false);
}

// ================================================================
console.log("[G] DOM 锚定：body 平面文本法失效时（集运仓组件文本不进 innerText），仍能以订单表为锚就近抓到");
// 构造真实层级：每个订单 = 一个卡片容器（table + 表外物流块），body.innerText 置空
const gTpl = table([row(orderTpl, true)]);
const g1Head = ["", "订单编号：\n260708-334286067311450\n复制\n成交时间：2026-07-08 15:26"];
const g1Row = ["透明提拉乳贴防下垂聚拢上托硅胶胸贴 ID: 655442592834 商品编码: 1688-818421643724", "已收货", "1", "9.90", "9.90", "**** 查看", "香*** 发起聊天", "查看详情 添加备注 物流信息"];
const g1Logi = "物流信息：极兔速递 JT3169616537749复制 您的快件已签收，签收人：【小江南杂店前台代收】";
const g2Head = ["", "订单编号：\n260706-628998869351942\n复制\n成交时间：2026-07-06 00:43"];
const g2Row = ["透明防皱皱纹贴硅胶贴自粘软胶去皱医用硅胶贴 ID: 663969680444 商品编码: 1688-829901726375", "已收货", "1", "9.68", "9.68", "**** 查看", "E*** 发起聊天", "查看详情 添加备注 物流信息"];
const g2LogiA = "物流信息：邮政快递包裹 9901234567890复制 包裹已到达集运仓";
const g2LogiB = "物流信息：集运仓🟢 消费者（二段物流） 极兔速递HK JT0024585595081复制 包裹已从【XX】发出";
const tG1 = table([row(g1Head, true), row(g1Row, false)]);
const tG2 = table([row(g2Head, true), row(g2Row, false)]);
const cardG1 = container([tG1, block(g1Logi)]);
const cardG2 = container([tG2, block(g2LogiA), block(g2LogiB)]);
container([cardG1, cardG2]); // 页面根（含多单编号，模拟列表容器）
global.document = makeDoc([gTpl, tG1, tG2], ""); // body 文本为空 → 只有 DOM 锚定能生效
res = extractTables(PDD_KW, FIELDS_META);
check("G 合并为 1 张订单表", res.tables.length === 1 && res.tables[0].orderMode === true);
if (res.tables[0]) {
  const TG = res.tables[0];
  const gc = (label) => TG.headers.indexOf(label);
  const gg = (r, label) => r[gc(label)];
  const q1 = TG.rows.find((r) => gg(r, "订单号") === "260708-334286067311450");
  check("G 普通单（body 文本为空）仍抓到快递公司", q1 && gg(q1, "快递公司") === "极兔速递");
  check("G 普通单仍抓到快递单号 JT3169616537749", q1 && gg(q1, "快递单号") === "JT3169616537749");
  const q2 = TG.rows.find((r) => gg(r, "订单号") === "260706-628998869351942");
  check("G 集运仓单（body 文本为空）仍抓到快递公司", q2 && gg(q2, "快递公司").indexOf("极兔速递") !== -1);
  check("G 集运仓单仍抓到快递单号 JT0024585595081", q2 && gg(q2, "快递单号").indexOf("JT0024585595081") !== -1);
}

// ================================================================
console.log("[H] 宽松兜底：英文快递公司名能抓单号；无单号时不得误抓商品 ID/商品编码");
const hTpl = table([row(orderTpl, true)]);
const h1Head = ["", "订单编号：\n260706-628998869351942\n复制\n成交时间：2026-07-06 00:43"];
const h1Row = ["透明防皱皱纹贴硅胶贴自粘软胶 ID: 663969680444 商品编码: 1688-829901726375", "已收货", "1", "9.68", "9.68", "****", "E*** 发起聊天", "查看详情 添加备注 物流信息"];
const tH1 = table([row(h1Head, true), row(h1Row, false)]);
// 英文公司名 → 中文 courierRe 匹配不到，须靠宽松兜底
const cardH1 = container([tH1, block("物流信息：J&T Express JT0024585595081复制 已签收")]);
const h2Head = ["", "订单编号：\n260706-541987970573742\n复制\n下单时间：2026-07-06 01:17"];
const tH2 = table([row(h2Head, true), row(h1Row, false)]);
// 有物流标签但无运单号 → 绝不能把商品 ID 663969680444 / 商品编码 1688-829901726375 当成单号
const cardH2 = container([tH2, block("物流信息：暂无物流轨迹")]);
container([cardH1, cardH2]);
global.document = makeDoc([hTpl, tH1, tH2], "");
res = extractTables(PDD_KW, FIELDS_META);
if (res.tables[0]) {
  const TH = res.tables[0];
  const hc = (label) => TH.headers.indexOf(label);
  const hg = (r, label) => r[hc(label)];
  const p1 = TH.rows.find((r) => hg(r, "订单号") === "260706-628998869351942");
  check("H 英文公司名仍能抓到单号 JT0024585595081", p1 && hg(p1, "快递单号") === "JT0024585595081");
  const p2 = TH.rows.find((r) => hg(r, "订单号") === "260706-541987970573742");
  check("H 无运单号时快递单号为空", p2 && hg(p2, "快递单号") === "");
  check("H 未误抓商品 ID 663969680444", p2 && hg(p2, "快递单号").indexOf("663969680444") === -1);
  check("H 未误抓商品编码 1688-829901726375", p2 && hg(p2, "快递单号").indexOf("829901726375") === -1);
}

// ================================================================
console.log("[I] 繁体快递公司（跨境/集运仓真实原文）+ 物流行在 table 内");
const iTpl = table([row(orderTpl, true)]);
const iRow = ["透明防皱皱纹贴硅胶贴自粘软胶去皱医用硅胶贴硅胶贴面部美容 ID: 663969680444 商品编码: 1688-829901726375 脸部5件套,均码", "已收货", "1", "9.68", "9.68", "**** 查看 **** **** **** ****", "E*** 发起聊天", "查看详情 添加备注 物流信息"];
const i1Head = ["", "订单编号：\n260706-628998869351942\n复制\n成交时间：2026-07-06 00:43"];
const i1Logi = ["物流信息： 集运仓 消费者 （二段物流） 極兔速遞HK JT0024585595081复制 包裹已從【來取易自提點】取出 2026-07-10 19:06:30"];
const i2Head = ["", "订单编号：\n260707-472781954623938\n复制\n成交时间：2026-07-07 00:14"];
const i2Logi = ["物流信息：圓通速遞 YT7631536107699复制 您的快件已投递，收件人: 齐沙一路2号仓库。如遇找不到包裹等问题，请联系快递员:18588154207"];
const tI1 = table([row(i1Head, true), row(iRow, false), row(i1Logi, false)]);
const tI2 = table([row(i2Head, true), row(iRow, false), row(i2Logi, false)]);
global.document = makeDoc([iTpl, tI1, tI2], "");
res = extractTables(PDD_KW, FIELDS_META);
if (res.tables[0]) {
  const TI = res.tables[0];
  const ic = (label) => TI.headers.indexOf(label);
  const ig = (r, label) => r[ic(label)];
  const k1 = TI.rows.find((r) => ig(r, "订单号") === "260706-628998869351942");
  check("I 繁体「極兔速遞」→ 输出简体「极兔速递」", k1 && ig(k1, "快递公司") === "极兔速递");
  check("I 集运仓单号 JT0024585595081（HK 路由标识已剥离）", k1 && ig(k1, "快递单号") === "JT0024585595081");
  check("I「（二段物流）」未被误判为公司", k1 && ig(k1, "快递公司").indexOf("二段") === -1);
  const k2 = TI.rows.find((r) => ig(r, "订单号") === "260707-472781954623938");
  check("I 繁体「圓通速遞」→ 输出简体「圆通速递」", k2 && ig(k2, "快递公司") === "圆通速递");
  check("I 圆通单号 YT7631536107699（不误抓快递员电话）", k2 && ig(k2, "快递单号") === "YT7631536107699");
}

// ================================================================
// ================================================================
// v2.7：clickNextPage 会调用同文件的 pagerInfo / clickPageNumber（脚本作用域）。
// 用 new Function 抽出来的函数只能看到「全局作用域」，因此先把它们挂到 global 上，
// 等价于浏览器里 pagefuncs.js 作为整份脚本加载后的作用域关系。
const piSrc = src.match(/function pagerInfo\(\) \{[\s\S]*?\n\}/);
const cpnSrc = src.match(/function clickPageNumber\(n\) \{[\s\S]*?\n\}/);
check("找到 pagerInfo / clickPageNumber 源码", !!piSrc && !!cpnSrc);
const pagerInfoFn = piSrc ? new Function("return (" + piSrc[0] + ");")() : null;
const clickPageNumberFn = cpnSrc ? new Function("return (" + cpnSrc[0] + ");")() : null;
global.pagerInfo = pagerInfoFn;
global.clickPageNumber = clickPageNumberFn;

console.log("[J] 翻页控件识别：next 类名 / 激活页码+1 / 禁用跳过 / 滚动兜底");
const cnpSrc = src.match(/function clickNextPage\(targetPage\) \{[\s\S]*?\n\}/);
if (!cnpSrc) { check("J 找到 clickNextPage 源码", false); }
else {
  const clickNextPage = new Function("return (" + cnpSrc[0] + ");")();
  global.window = { scrollTo() {} };
  function pgEl(text, cls) {
    return {
      innerText: text, className: cls || "", offsetParent: {}, disabled: false, clicked: false,
      click() { this.clicked = true; },
      getAttribute() { return null; },
      closest() { return null; },
    };
  }
  function setDoc(els) {
    global.document = {
      querySelectorAll(sel) {
        if (/next/i.test(sel)) return els.filter((e) => /next/.test(String(e.className || "")));
        if (sel === "button, a, li, span, i, div") return els;
        return [];
      },
      body: { innerText: "", scrollHeight: 100 },
      scrollingElement: { scrollTop: 0, scrollHeight: 100 },
    };
  }
  // ① 类名含 next
  const eNext = pgEl("›", "pager-next");
  setDoc([pgEl("1", "pager-item active"), pgEl("2", "pager-item"), eNext]);
  const r1 = clickNextPage(2);
  check("J ① next 类名命中并点击", r1.clicked && /next/.test(r1.sel) && eNext.clicked === true);

  // ② 无 next 类名 → 自研分页器「激活页码 + 1」
  const a3 = pgEl("3", "pager-item active");
  const a4 = pgEl("4", "pager-item");
  setDoc([a3, a4]);
  const r2 = clickNextPage(4);
  check("J ② 激活页码+1 命中（自研分页器兜底）", r2.clicked && r2.sel === "page+3" && a4.clicked === true);

  // ③ 禁用的 next 必须跳过（否则会在最后一页反复点）
  const eNextDis = pgEl("›", "pager-next disabled");
  setDoc([eNextDis]);
  const r3 = clickNextPage(2);
  check("J ③ 禁用 next 被跳过、未点击", eNextDis.clicked === false);
  check("J ③ 退化为滚动兜底", r3.clicked === true && r3.sel === "scroll");
}

// ================================================================
console.log("[L] 分页器识别（v2.7 修「抓全部页只抓到 1 页」的核心）");
function mkPager(current, pages, cls) {
  const kids = pages.map((n) => ({
    innerText: String(n),
    className: (cls || "PGT-item") + (n === current ? " PGT-active" : ""),
    tagName: "LI", offsetParent: {}, clicked: false,
    click() { this.clicked = true; },
    getAttribute() { return null; },
    closest() { return null; },
  }));
  const arrow = {
    innerText: "›", className: "PGT-next", tagName: "LI", offsetParent: {}, clicked: false,
    click() { this.clicked = true; }, getAttribute() { return null; }, closest() { return null; },
  };
  const box = {
    tagName: "UL", className: "PGT-pagination", children: kids.concat([arrow]),
    parentElement: null,
    querySelectorAll(sel) {
      if (sel === "*") return kids.concat([arrow]);
      if (/next/i.test(sel)) return [arrow];
      return [];
    },
    contains(x) { return x === arrow || kids.indexOf(x) !== -1; },
  };
  kids.concat([arrow]).forEach((k) => { k.parentElement = box; });
  return { box, kids, arrow };
}
// 干扰项：表格数量列里的「2」——旧实现（全页面找数字）会误点它
function decoy(text, cls) {
  return {
    innerText: text, className: cls || "cell", tagName: "TD", offsetParent: {}, clicked: false,
    click() { this.clicked = true; }, getAttribute() { return null; }, closest() { return null; },
  };
}
function setPagerDoc(box, extraCands, bodyText) {
  global.document = {
    querySelectorAll(sel) {
      if (sel === "div, ul, ol, nav, section, span") return box ? [box] : [];
      if (sel === "button, a, li, span, i, div") return extraCands || [];
      return [];
    },
    body: { innerText: bodyText || "", scrollHeight: 100 },
    scrollingElement: { scrollTop: 0, scrollHeight: 100 },
  };
  global.window = { scrollTo() {} };
}
const clickNextPageL = cnpSrc ? new Function("return (" + cnpSrc[0] + ");")() : null;
if (pagerInfoFn && clickPageNumberFn && clickNextPageL) {
  // ① 用户截图真实形态：停在最后一页，分页条 = ‹ 1 18 19 20 21 22 ›
  const p22 = mkPager(22, [1, 18, 19, 20, 21, 22]);
  const decoy2 = decoy("2");
  setPagerDoc(p22.box, [decoy2], "订单编号：260708-334286067311450 数量 2 已收货 共有 436 条 每页 20 条");
  const info22 = pagerInfoFn();
  check("L ① 识别到分页器容器", !!info22);
  check("L ① 当前页 = 22（按激活 class 判定）", info22 && info22.cur === 22);
  check("L ① 总页数 = 22（页码最大值 +「共有 436 条 / 每页 20 条」交叉校验）", info22 && info22.total === 22);
  check("L ① 页码列表 = 1,18,19,20,21,22", info22 && info22.pages.join(",") === "1,18,19,20,21,22");
  const back1 = clickPageNumberFn(1);
  check("L ① 「回到第 1 页」点中分页器里的 1", back1 && back1.sel === "pager-num:1" && p22.kids[0].clicked === true);

  // ② 停在第 1 页：点「下一页」必须在分页器内点 2，不能点到表格里的数字 2
  const p1 = mkPager(1, [1, 2, 3, 4, 5, 22]);
  const decoy2b = decoy("2");
  setPagerDoc(p1.box, [decoy2b], "共有 436 条 每页 20 条");
  const rNext = clickNextPageL(2);
  check("L ② 分页器内点中目标页码 2", rNext && rNext.clicked === true && rNext.sel === "pager-num:2" && p1.kids[1].clicked === true);
  check("L ② 未误点表格里的数字 2（旧实现的元凶）", decoy2b.clicked === false);

  // ③ 非分页器页面：不得凭空造出一个分页器
  setPagerDoc(null, [decoy("1"), decoy("2")], "共有 3 条 每页 20 条");
  check("L ③ 无分页条时 pagerInfo() 返回 null（不误判）", pagerInfoFn() === null);
  check("L ③ 无分页条时 clickPageNumber() 返回 null", clickPageNumberFn(1) === null);
}

// ================================================================
console.log("[K] 页面内抓取循环（grabAllInPage）：逐页抓取 / 末页停止 / 空表重试 / 未注入报错");
(async () => {
  const realST = global.setTimeout;
  global.setTimeout = (fn) => realST(fn, 1); // 把循环里的等待压到 1ms，测试秒级完成
  const gapSrc = src.match(/async function grabAllInPage\(roleKeywords, fields, maxPages\) \{[\s\S]*?\n\}/);
  if (!gapSrc) { check("K 找到 grabAllInPage 源码", false); }
  else {
    const grabAllInPage = new Function("return (" + gapSrc[0] + ");")();
    function setEnv(pages, opts) {
      let idx = 0;
      const o = opts || {};
      global.window = {
        __IH_PAGE: {
          extractTables: () => ({ tables: [{ headers: ["订单号"], rows: [[pages[idx] || ""]], rowCount: 1 }] }),
          pageSignature: () => "sig" + idx,
          clickNextPage: () => {
            if (o.noClick) return { clicked: false, reason: "未找到翻页控件" };
            idx++;
            return idx < pages.length ? { clicked: true, sel: "next" } : { clicked: false, reason: "最后一页" };
          },
        },
      };
    }
    setEnv(["A", "B", "C"]);
    const r1 = await grabAllInPage({}, [], 200);
    check("K 逐页抓到 3 页", r1.total === 3 && window.__IH_GRAB.pages.length === 3);
    check("K 页码与顺序正确", window.__IH_GRAB.pages.map((p) => p.tables[0].rows[0][0]).join("") === "ABC");
    check("K 末页后正常结束", r1.note.indexOf("没有下一页了") !== -1);
    check("K 任务结束标记正确", window.__IH_GRAB.done === true && window.__IH_GRAB.running === false);

    setEnv(["X", "Y"], { noClick: true });
    const r2 = await grabAllInPage({}, [], 200);
    check("K 找不到翻页控件 → 抓 1 页即结束", r2.total === 1);

    // 翻页成功但页面内容始终不变 → 必须停止（否则会无限循环）
    global.window = {
      __IH_PAGE: {
        extractTables: () => ({ tables: [{ headers: ["订单号"], rows: [["Z"]], rowCount: 1 }] }),
        pageSignature: () => "same",
        clickNextPage: () => ({ clicked: true, sel: "next" }),
      },
    };
    const r3 = await grabAllInPage({}, [], 200);
    check("K 页面始终未变化 → 停止并记录原因", r3.total === 1 && r3.note.indexOf("未变化") !== -1);

    // 首轮空表（翻页渲染未完成）→ 重试后应成功
    let calls = 0;
    global.window = {
      __IH_PAGE: {
        extractTables: () => { calls++; return calls < 2 ? { tables: [] } : { tables: [{ headers: ["订单号"], rows: [["F"]], rowCount: 1 }] }; },
        pageSignature: () => "s" + calls,
        clickNextPage: () => ({ clicked: false, reason: "最后一页" }),
      },
    };
    const r4 = await grabAllInPage({}, [], 200);
    check("K 首轮空表经重试后成功", r4.total === 1 && window.__IH_GRAB.pages[0].tables[0].rows[0][0] === "F");

    global.window = {};
    const r5 = await grabAllInPage({}, [], 200);
    check("K 页面函数库未注入 → 明确报错", r5.ok === false && r5.note.indexOf("未注入") !== -1);

    // ============================================================
    console.log("[M] v2.7：停在中/末页时自动回到第 1 页并抓满全部（修「只抓到 1 页」）");
    function setPagedEnv(startAt, TOTAL) {
      let cur = startAt;
      global.window = {
        __IH_PAGE: {
          extractTables: () => ({ tables: [{ headers: ["订单号"], rows: [["P" + cur]], rowCount: 1 }] }),
          pageSignature: () => "sig" + cur,
          pagerInfo: () => ({ cur: cur, total: TOTAL, pages: [], nums: [] }),
          clickPageNumber: (n) => {
            if (n < 1 || n > TOTAL) return null;
            cur = n;
            return { clicked: true, sel: "pager-num:" + n };
          },
          clickNextPage: (t) => {
            if (t > TOTAL) return { clicked: false, reason: "最后一页" };
            cur = t;
            return { clicked: true, sel: "pager-num:" + t };
          },
        },
      };
    }
    setPagedEnv(22, 22);
    const rM1 = await grabAllInPage({}, [], 200);
    check("M 停在最后一页（22/22）启动 → 自动回到第 1 页并抓满 22 页", rM1.total === 22);
    check("M 抓取顺序为 1..22", window.__IH_GRAB.pages.map((p) => p.tables[0].rows[0][0]).join(",") ===
      Array.from({ length: 22 }, (_, i) => "P" + (i + 1)).join(","));
    check("M 末页自动停止并记录原因", rM1.note.indexOf("已到最后一页") !== -1);
    check("M 总页数已记录到状态", window.__IH_GRAB.total === 22);

    setPagedEnv(11, 22);
    const rM2 = await grabAllInPage({}, [], 200);
    check("M 停在中间页（11/22）启动 → 同样抓满 22 页", rM2.total === 22);
    check("M 中间页启动也从第 1 页开始", window.__IH_GRAB.pages[0].tables[0].rows[0][0] === "P1");

    setPagedEnv(1, 22);
    const rM0 = await grabAllInPage({}, [], 200);
    check("M 本来就在第 1 页 → 正常抓满 22 页", rM0.total === 22);

    // 手动停止：浮层「停止抓取」/ 弹窗「停止抓取」按钮 → G.stop
    let curS = 1;
    global.window = {
      __IH_PAGE: {
        extractTables: () => ({ tables: [{ headers: ["订单号"], rows: [["Q"]], rowCount: 1 }] }),
        pageSignature: () => "sig" + curS,
        pagerInfo: () => ({ cur: curS, total: 99, pages: [], nums: [] }),
        clickPageNumber: () => null,
        clickNextPage: (t) => {
          curS = t;
          if (window.__IH_GRAB && window.__IH_GRAB.pages.length >= 3) window.__IH_GRAB.stop = true;
          return { clicked: true, sel: "next" };
        },
      },
    };
    const rM3 = await grabAllInPage({}, [], 200);
    check("M 支持手动停止（停止后立即结束并记录原因）", rM3.note.indexOf("手动停止") !== -1 && rM3.total === 3);
  }
  global.setTimeout = realST;
  console.log("\n" + (fail === 0 ? "ALL TESTS PASSED ✅" : fail + " TEST(S) FAILED ❌"));
  process.exit(fail === 0 ? 0 : 1); // 必须放在异步块内，否则会在异步测试跑完前退出
})();
