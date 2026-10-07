// background.js PDD/1688 解析入库冒烟测试（vm 注入 + 真实 SheetJS）
const fs = require("fs");
global.XLSX = undefined; // background.js 会 importScripts，node 下捕获失败后 XLSX 由全局提供
const listeners = { downloads: { onCreated: [], onChanged: [] }, runtime: { onInstalled: [], onMessage: [] } };
const store = {};
global.chrome = {
  runtime: {
    onInstalled: { addListener: (f) => listeners.runtime.onInstalled.push(f) },
    onMessage: { addListener: (f) => listeners.runtime.onMessage.push(f) },
    getURL: (p) => p,
  },
  downloads: {
    onCreated: { addListener: (f) => listeners.downloads.onCreated.push(f) },
    onChanged: { addListener: (f) => listeners.downloads.onChanged.push(f) },
    search: async () => [],
  },
  storage: {
    local: {
      get: (keys, cb) => cb(typeof keys === "object" && !Array.isArray(keys) ? { ...keys, ...store } : store),
      set: (obj, cb) => { Object.assign(store, obj); if (cb) cb(); },
    },
  },
};
global.importScripts = (p) => { delete global.XLSX; global.XLSX = require("./xlsx.full.min.js"); };

require("vm").runInThisContext(fs.readFileSync("./background.js", "utf8"), { filename: "background.js" });

(async () => {
  let fails = 0;
  const assert = (c, m) => { console.log((c ? "PASS" : "FAIL") + ": " + m); if (!c) fails++; };

  // 构造拼多多导出表（含开票信息列）
  const pddRows = [
    { "订单编号": "P202410001", "快递公司": "中通快递", "快递单号": "78123456789012", "收货人": "张三", "实付金额": "29.90", "商品名称": "手机壳", "发票抬头": "买家A公司", "税号": "91330100TEST" },
    { "订单编号": "P202410002", "快递公司": "韵达", "快递单号": "43123456789012", "收货人": "李四", "实付金额": "19.90", "商品名称": "数据线" },
  ];
  const wbP = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wbP, XLSX.utils.json_to_sheet(pddRows), "订单导出");
  const pddBuf = Buffer.from(XLSX.write(wbP, { type: "array", bookType: "xlsx" }));

  // 构造 1688 导出表
  const aRows = [
    { "订单编号": "A100", "卖家公司名": "义乌市XX文具厂", "物流公司": "中通快递(ZTO)", "运单号": "78123456789012", "实付款(元)": "25.8", "货品标题": "笔记本x10" },
  ];
  const wbA = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wbA, XLSX.utils.json_to_sheet(aRows), "导出结果");
  const aBuf = Buffer.from(XLSX.write(wbA, { type: "array", bookType: "xlsx" }));

  // 1. PDD 解析
  const prP = parseXlsxBytes(pddBuf, PDD_KW);
  assert(prP.ok && prP.matched === 2, "PDD 解析 2 条（实际 " + (prP.matched || 0) + "）");
  assert(prP.colRole.invoice_title === "发票抬头" && prP.colRole.tax_no === "税号", "PDD 归列抬头/税号");
  assert(prP.colRole.courier === "快递公司" && prP.colRole.tracking_no === "快递单号", "PDD 归列快递公司/单号");
  assert(prP.records[0].invoice_title === "买家A公司", "PDD 首条带抬头");
  assert(prP.records[1].invoice_title === "", "PDD 无抬头行为空");

  // 2. PDD 入库（去重合并）
  const m1 = await mergePdd(prP.records);
  const m2 = await mergePdd(prP.records);
  assert(m1.added === 2 && m2.added === 0 && m2.merged === 2, "PDD 入库去重（added " + m1.added + "/" + m2.added + "，merged " + m2.merged + "）");
  assert(store.pdd_orders.length === 2, "pdd_orders 库 2 条");

  // 3. 1688 解析回归（默认 kw）
  const prA = parseXlsxBytes(aBuf);
  assert(prA.ok && prA.matched === 1 && prA.records[0].seller === "义乌市XX文具厂", "1688 解析回归（卖家列正确）");
  const mA = await mergeA1688(prA.records);
  assert(mA.added === 1 && store.a1688_orders.length === 1, "1688 入库 1 条");

  // 4. 平台路由判定（模拟捕获逻辑里的 host 判断）
  const RE1688 = /1688\.com|alicdn\.com|aliyun|taobao/i;
  const REPDD = /pinduoduo\.com|yangkeduo\.com|pddpic\.com/i;
  const u1688 = "https://air.1688.com/x.xlsx", uPdd = "https://mms.pinduoduo.com/other/x.xlsx";
  assert(RE1688.test(u1688) && !REPDD.test(u1688), "1688 URL：命中 1688 正则、不命中 PDD 正则");
  assert(REPDD.test(uPdd) && !RE1688.test(uPdd), "PDD URL：命中 PDD 正则、不命中 1688 正则");
  const side = (REPDD.test(uPdd) && !RE1688.test(uPdd)) ? "pdd" : "a1688";
  assert(side === "pdd", "PDD URL → pdd 侧");
  console.log(fails === 0 ? "\n=== background 全部通过 ===" : `\n=== ${fails} 项失败 ===`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
