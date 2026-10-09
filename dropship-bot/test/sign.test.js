// sign.test.js —— 验证 PDD 签名与解析内核（node 运行：npm test）
const pdd = require("../src/pdd");
const D = require("../src/draft");

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log("✓ " + name); }
  else { fail++; console.log("✗ " + name); }
}

// 1. 签名：32 位大写十六进制，且确定性
const s1 = pdd.sign({ a: "1", b: "2", type: "x" }, "secret");
const s2 = pdd.sign({ a: "1", b: "2", type: "x" }, "secret");
ok("sign 长度 32", /^[0-9A-F]{32}$/.test(s1));
ok("sign 确定性", s1 === s2);
ok("sign 受 secret 影响", s1 !== pdd.sign({ a: "1", b: "2", type: "x" }, "other"));

// 2. 解析内核（与桌面插件同源）
const card = D.toDraftCard({
  orderId: "T1", item: "纯棉 T 恤", spec: "白色 M", qty: 2, pddPaid: 39.9,
  recipientText: "收货人：吴**[0255] 手机号 19959783357 联系地址 广东省 深圳市 y1008[0255]",
});
ok("解析主号", card.recipient.phone === "19959783357");
ok("解析分机", card.recipient.ext === "0255");
ok("虚拟号已得→不需补号", card.flags.needPhone === false);
ok("生成 1688 搜索链接", /s\.1688\.com/.test(card.searchUrl));
ok("缺成本→利润待填(null)", card.profit.profit === null);

// 3. 有成本时的利润
const card2 = D.toDraftCard({
  item: "x", pddPaid: 39.9, cost: 18.5, shipping: 3,
  recipientText: "收货人：吴**[0255] 手机号 19959783357 联系地址 广东省 深圳市 y1008[0255]",
});
ok("有成本→利润 18.4", card2.profit.profit === 18.4);

console.log(`\n=== dropship-bot: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
