// test_dropship_draft.js —— 代发采购草稿核心逻辑单测（node 运行）
const D = require("./dropship_draft.js");

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log("✓ " + name); }
  else { fail++; console.log("✗ " + name + "\n    got : " + g + "\n    want: " + w); }
}

// 1. 虚拟号解析（已实测格式）
eq("parseVirtualPhone-虚拟号主号", D.parseVirtualPhone("139****1234 19959783357").phone, "19959783357");
eq("parseVirtualPhone-分机", D.parseVirtualPhone("吴**[0255]").ext, "0255");
eq("parseVirtualPhone-含分机判虚拟", D.parseVirtualPhone("吴**[0255] 19959783357").isVirtual, true);
eq("parseVirtualPhone-纯脱敏非虚拟", D.parseVirtualPhone("138****1234").isVirtual, false);

// 2. 收货信息块解析（模拟截图文本）
const rec = D.parseRecipientBlock(
  "收货人：吴**[0255] 复制完整信息 手机号 19959783357 当前手机号为隐私号 联系地址 广东省 深圳市 龙华区 xxx 下一层楼梯(送货上门) y1008[0255] 复制"
);
eq("parseRecipientBlock-姓名", rec.name, "吴**[0255]");
eq("parseRecipientBlock-电话", rec.phone, "19959783357");
eq("parseRecipientBlock-地址含分机", /y1008\[0255\]/.test(rec.address || ""), true);
eq("parseRecipientBlock-置信高", rec.confidence, "high");

// 3. 规格归一化
eq("normalizeSpec-藏青→深蓝", D.normalizeSpec("藏青").norm, "深蓝");
eq("normalizeSpec-XXL", D.normalizeSpec("xxl").norm, "2XL");

// 4. 1688 搜索 URL
eq("build1688SearchUrl-编码", D.build1688SearchUrl("纯棉 T 恤", { raw: "白色 M" }).url.indexOf("keywords=") > -1, true);

// 5. 利润差（fail-open）
eq("computeProfit-有成本", D.computeProfit(39.9, 18.5, 3).profit, 18.4);
eq("computeProfit-缺成本标待填", D.computeProfit(39.9, undefined, 3).profit, null);

// 6. 草稿卡片（缺号标红）
const card = D.toDraftCard({
  orderId: "2601PDD123456",
  item: "纯棉短袖 T 恤",
  spec: "白色 M",
  qty: 2,
  pddPaid: 39.9,
  recipientText: "收货人：吴**[0255] 手机号 19959783357 联系地址 广东省 深圳市 y1008[0255]",
});
eq("toDraftCard-订单号", card.orderId, "2601PDD123456");
eq("toDraftCard-虚拟号已得", card.flags.needPhone, false);
eq("toDraftCard-有搜索链接", /s\.1688\.com/.test(card.searchUrl), true);

// 6b. 缺分机场景标红
const card2 = D.toDraftCard({
  item: "测试", recipientText: "收货人：李** 手机号 18466629303 联系地址 北京市朝阳区",
});
eq("toDraftCard-缺分机判需取号", card2.flags.needPhone, true);

console.log("\n=== dropship_draft: " + pass + " passed, " + fail + " failed ===");
process.exit(fail ? 1 : 0);
