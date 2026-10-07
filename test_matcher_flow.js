// matcher.js 纯逻辑冒烟测试（node 环境，stub document/XLSX/chrome）
const fs = require("fs");
const path = require("path");

const captured = {};
global.XLSX = {
  utils: {
    book_new: () => ({}),
    json_to_sheet: (rows) => ({ rows }),
    book_append_sheet: (wb, ws, name) => { wb[name] = ws.rows; },
    sheet_to_json: (sheet) => (Array.isArray(sheet) ? sheet : []),
  },
  writeFile: (wb, fname) => { captured.wb = wb; captured.fname = fname; },
};
global.document = {
  addEventListener: (ev, fn) => { global.__domReady = fn; },
  getElementById: () => ({ value: "测试抬头公司", addEventListener: () => {}, disabled: false, innerHTML: "", appendChild: () => {}, scrollTop: 0, scrollHeight: 0, classList: { add() {}, remove() {} } }),
  createElement: () => ({ set className(v) {}, style: {}, get textContent() { return ""; }, set textContent(v) {} }),
};
global.chrome = { storage: { local: { get: (d, cb) => cb({ a1688_orders: [] }), set: () => {} } } };

require("vm").runInThisContext(fs.readFileSync(path.join(__dirname, "matcher.js"), "utf8"), { filename: "matcher.js" });

// ---- 断言工具 ----
let fails = 0;
function assert(cond, msg) { console.log((cond ? "PASS" : "FAIL") + ": " + msg); if (!cond) fails++; }

// ---- 1. courierCheck ----
assert(courierCheck("中通快递", "中通快递(ZTO)") === "✅一致", "快递公司 包含关系→一致");
assert(courierCheck("圆通速递", "中通快递") === "⚠不一致", "快递公司 不同→不一致");
assert(courierCheck("", "中通") === "—", "缺一边→—");

// ---- 2. buildColRole：PDD 表含快递公司/抬头/税号列 ----
const pddRows = [
  { "订单编号": "P001", "快递公司": "中通快递", "快递单号": "78123456789012", "发票抬头": "买家A公司", "税号": "91330...", "收货人": "张三", "实付金额": "29.9", "商品名称": "手机壳" },
  { "订单编号": "P002", "快递公司": "韵达", "快递单号": "43123456789012", "发票抬头": "", "税号": "", "收货人": "李四", "实付金额": "19.9", "商品名称": "数据线" },
];
const pr = mapRowsByKw(pddRows, PDD_KW);
assert(pr.colRole.courier === "快递公司", "PDD 归列 courier=快递公司（实际=" + pr.colRole.courier + "）");
assert(pr.colRole.tracking_no === "快递单号", "PDD 归列 tracking_no=快递单号");
assert(pr.colRole.invoice_title === "发票抬头", "PDD 归列 invoice_title=发票抬头");
assert(pr.colRole.tax_no === "税号", "PDD 归列 tax_no=税号");
assert(pr.colRole.order_id === "订单编号", "PDD 归列 order_id=订单编号");

// ---- 3. 1688 表归列 ----
const aRows = [
  { "订单编号": "A100", "卖家公司名": "义乌市XX文具厂", "物流公司": "中通快递(ZTO)", "运单号": "78123456789012", "实付款(元)": "25.8", "货品标题": "笔记本x10" },
  { "订单编号": "A101", "卖家公司名": "深圳市YY电子", "物流公司": "韵达", "运单号": "43123456789012", "实付款(元)": "15.0", "货品标题": "数据线" },
];
const ar = mapRowsByKw(aRows, A1688_KW);
assert(ar.colRole.tracking_no === "运单号", "1688 归列 tracking_no=运单号");
assert(ar.colRole.courier === "物流公司", "1688 归列 courier=物流公司（实际=" + ar.colRole.courier + "）");
state.a1688 = ar.rows.filter((r) => r.order_id);
state.pdd = pr.rows.filter((r) => r.tracking_no || r.order_id);

// ---- 4. 状态回填 ----
state.statusMap.set("A101", "已开票");
assert(state.statusMap.get("A101") === "已开票", "statusMap 回填");

// ---- 5. doMatch 输出结构 ----
doMatch();
const wb = captured.wb;
assert(captured.fname.indexOf("开票匹配") !== -1, "输出文件名含「开票匹配」（" + captured.fname + "）");
assert(wb["匹配结果"] && wb["匹配结果"].length === 2, "匹配结果 2 条");
const m0 = wb["匹配结果"][0];
assert(m0["快递公司校验"] === "✅一致", "P001 中通快递 vs 中通快递(ZTO) → 一致");
assert(m0["发票抬头"] === "买家A公司", "表内抬头优先（买家A公司）");
assert(m0["1688订单号"] === "A100", "匹配到 A100");
const m1 = wb["匹配结果"][1];
assert(m1["发票抬头"] === "测试抬头公司", "表内无抬头→用手动输入（测试抬头公司）");
assert(m1["开票状态"] === "已开票", "A101 状态回填为已开票");
const inv = wb["开票清单_按卖家"];
assert(Array.isArray(inv) && inv.length >= 4, "开票清单含明细+小计+合计（行数=" + (inv && inv.length) + "）");
assert(inv.some((r) => String(r["卖家/供应商"]).indexOf("【小计】") === 0), "存在卖家小计行");
assert(inv.some((r) => r["卖家/供应商"] === "【合计】"), "存在合计行");
const trk = wb["开票跟踪表"];
assert(trk && trk.length === 2 && trk[0]["开票状态"] === "待开票" && trk[1]["开票状态"] === "已开票", "跟踪表状态：待开票/已开票");
assert(wb["未匹配_拼多多"] && wb["未匹配_拼多多"][0]["提示"] === "无", "拼多多未匹配=无");
assert(wb["未匹配_1688"] && wb["未匹配_1688"][0]["提示"] === "无", "1688 未匹配=无");

// ---- 6. harvestStatus（模拟历史结果文件）----
const fakeRows = [
  { "拼多多订单号": "P009", "快递单号": "x", "快递公司": "y", "1688订单号": "A100", "卖家/供应商": "s", "1688金额": "25.8", "开票状态": "已收票" },
  { "拼多多订单号": "", "快递单号": "", "快递公司": "", "1688订单号": "【小计】s", "卖家/供应商": "", "1688金额": "", "开票状态": "共 1 单" },
];
const fakeWb = { SheetNames: ["开票跟踪表"], "开票跟踪表": fakeRows, Sheets: { "开票跟踪表": fakeRows } };
const n = harvestStatus(fakeWb, Object.keys(fakeWb));
assert(n === 1, "harvestStatus 回填 1 条（小计行被排除）");
assert(state.statusMap.get("A100") === "已收票", "A100 状态=已收票");

console.log(fails === 0 ? "\n=== 全部通过 ===" : `\n=== ${fails} 项失败 ===`);
process.exit(fails === 0 ? 0 : 1);
