// 离线汇总：1688 全量报表(1279行) × 拼多多导出表 → 匹配结果 + 按卖家分组可开票
const fs = require('fs');
const XLSX = require('./xlsx.full.min.js');

const A_SRC = '_a1688.xlsx';
const P_SRC = '_pdd.xlsx';

function loadFirst(p) {
  const wb = XLSX.read(fs.readFileSync(p), { type: 'buffer' });
  const sn = wb.SheetNames[0];
  return XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: '' });
}

// ---- 列角色（与扩展 buildColRole 同源：长词优先 + 一列一角色）----
const A1688_KW = {
  order_id: ['订单编号', '订单号', '订单', '单号'],
  seller: ['卖家公司名', '卖家', '供应商', '供货商'],
  tracking_no: ['运单号', '物流单号', '快递单号'],
  courier: ['物流公司', '快递公司', '承运商'],
  amount: ['实付款(元)', '实付款', '实付金额', '价税合计', '应付金额'],
  items: ['货品标题', '商品', '货品'],
};
const PDD_KW = {
  order_id: ['订单编号', '订单号', '订单', '单号'],
  tracking_no: ['运单号', '快递单号', '物流单号'],
  buyer: ['收货人', '买家', '收件人'],
  amount: ['实付金额', '订单金额', '应付金额', '金额'],
  items: ['商品名称', '商品', '货物'],
};
function buildColRole(rows, kw) {
  const allKeys = new Set();
  rows.forEach((r) => Object.keys(r).forEach((k) => allKeys.add(k)));
  const used = new Set();
  const colRole = {};
  ['order_id', 'tracking_no', 'courier', 'seller', 'buyer', 'amount', 'items'].forEach((role) => {
    if (!kw[role]) return;
    const kws = kw[role].slice().sort((a, b) => String(b).length - String(a).length);
    for (const w of kws) {
      const cands = [...allKeys]
        .filter((k) => !used.has(k) && String(k).toLowerCase().indexOf(String(w).toLowerCase()) !== -1)
        .sort((a, b) => b.length - a.length);
      if (cands.length) { colRole[role] = cands[0]; used.add(cands[0]); return; }
    }
  });
  return colRole;
}
const S = (v) => String(v == null ? '' : v).trim();
const normTrack = (v) => S(v).replace(/[\s\u3000]+/g, '').toUpperCase();

// ================= 1688 =================
const aRows = loadFirst(A_SRC);
const aCol = buildColRole(aRows, A1688_KW);
console.log('1688 文件行数 =', aRows.length);
console.log('1688 归列 =', JSON.stringify(aCol));

// 关键：1688 报表是「按货品逐行」，同一个订单只有第一行有「订单编号」→ 必须向前填充(FORWARD FILL)
const aRecs = [];
const byId = new Map();
let ffOid = '';
for (const r of aRows) {
  let oid = S(r[aCol.order_id]);
  if (!oid) oid = ffOid; else ffOid = oid;           // 向前填充订单号
  if (!oid) continue;
  const rec = {
    order_id: oid,
    seller: S(r[aCol.seller]),
    courier: aCol.courier ? S(r[aCol.courier]) : '',
    tracking_no: S(r[aCol.tracking_no]),
    amount: parseFloat(String(r[aCol.amount]).replace(/[^\d.\-]/g, '')) || 0,
    items: aCol.items ? S(r[aCol.items]).slice(0, 120) : '',
    status: S(r['订单状态']),
  };
  if (byId.has(oid)) {
    const ex = byId.get(oid);                          // 合并同订单多行，只补空字段
    for (const k of ['seller', 'courier', 'tracking_no', 'items', 'status']) if (!ex[k] && rec[k]) ex[k] = rec[k];
    if (!ex.amount && rec.amount) ex.amount = rec.amount;
  } else {
    byId.set(oid, rec);
    aRecs.push(rec);
  }
}
const withTrack = aRecs.filter((r) => r.tracking_no).length;
console.log(`1688 去重后订单 = ${aRecs.length}（其中有运单号 ${withTrack}，无运单号 ${aRecs.length - withTrack}）`);

// ================= 拼多多 =================
const pRows = loadFirst(P_SRC);
const pCol = buildColRole(pRows, PDD_KW);
console.log('PDD 文件行数 =', pRows.length);
console.log('PDD 归列 =', JSON.stringify(pCol));
const pRecs = pRows
  .map((r) => ({
    order_id: S(r[pCol.order_id]),
    tracking_no: S(r[pCol.tracking_no]),
    buyer: pCol.buyer ? S(r[pCol.buyer]) : '',
    amount: pCol.amount ? (parseFloat(String(r[pCol.amount]).replace(/[^\d.\-]/g, '')) || 0) : 0,
    items: pCol.items ? S(r[pCol.items]).slice(0, 80) : '',
  }))
  .filter((r) => r.tracking_no || r.order_id);
const pWithTrack = pRecs.filter((r) => r.tracking_no).length;
console.log(`PDD 订单 = ${pRecs.length}（其中有快递单号 ${pWithTrack}）`);

// ================= 匹配（主键：归一化快递单号）=================
const aIdx = new Map();
aRecs.forEach((a) => { const k = normTrack(a.tracking_no); if (k && !aIdx.has(k)) aIdx.set(k, a); });
const hitA = new Set();
const matched = [];
for (const p of pRecs) {
  const k = normTrack(p.tracking_no);
  if (!k) continue;
  const a = aIdx.get(k);
  if (!a) continue;
  hitA.add(a.order_id);
  matched.push({
    '拼多多订单号': p.order_id,
    '快递单号': p.tracking_no,
    '1688订单号': a.order_id,
    '卖家（供应商）': a.seller,
    '快递公司': a.courier,
    '1688实付款(元)': a.amount,
    '1688订单状态': a.status,
    '收货人': p.buyer,
  });
}
const pUnmatched = pRecs.filter((p) => !normTrack(p.tracking_no) || !aIdx.has(normTrack(p.tracking_no)));
const aLeft = aRecs.filter((a) => !hitA.has(a.order_id));
console.log(`✅ 匹配命中 = ${matched.length}`);
console.log(`PDD 未匹配 = ${pUnmatched.length}（其中 ${pUnmatched.filter((p) => !p.tracking_no).length} 条是没有快递单号的待发货单）`);
console.log(`1688 未匹配 = ${aLeft.length}`);

// ================= 按卖家分组（只列已匹配可开票）=================
const groups = new Map();
matched.forEach((m) => {
  const k = m['卖家（供应商）'] || '(卖家未知)';
  if (!groups.has(k)) groups.set(k, { seller: k, orders: [], tracks: [], couriers: new Set(), amount: 0 });
  const g = groups.get(k);
  g.orders.push(m['1688订单号']);
  if (m['快递单号']) g.tracks.push(m['快递单号']);
  if (m['快递公司']) g.couriers.add(m['快递公司']);
  g.amount += Number(m['1688实付款(元)']) || 0;
});
const grpRows = [...groups.values()]
  .sort((a, b) => b.amount - a.amount || b.orders.length - a.orders.length)
  .map((g) => ({
    '卖家（供应商）': g.seller,
    '可开票订单数': g.orders.length,
    '合计金额(元)': Number(g.amount.toFixed(2)),
    '1688订单号': g.orders.join('、'),
    '对应快递单号': g.tracks.join('、'),
    '快递公司': [...g.couriers].join('、'),
    '开票联系指引': '联系该卖家客服，提供下列 1688 订单号核对付款记录后索取发票（可要求电子普票/专票）',
  }));
const totalAmt = grpRows.reduce((s, r) => s + r['合计金额(元)'], 0);
grpRows.push({
  '卖家（供应商）': '【合计】',
  '可开票订单数': matched.length,
  '合计金额(元)': Number(totalAmt.toFixed(2)),
  '1688订单号': '', '对应快递单号': '', '快递公司': '', '开票联系指引': '',
});

// ================= 补充视图：1688 全量已发货（不依赖 PDD 匹配）=================
// 开票本质是给「所有已采购的 1688 订单」开票，PDD 匹配只是溯源；这里给全量分组。
const groups2 = new Map();
aRecs.filter((a) => a.tracking_no || a.status).forEach((a) => {
  const k = a.seller || '(卖家未知)';
  if (!groups2.has(k)) groups2.set(k, { seller: k, n: 0, amount: 0, shipped: 0 });
  const g = groups2.get(k);
  g.n++; g.amount += a.amount; if (a.tracking_no) g.shipped++;
});
const grpRows2 = [...groups2.values()]
  .sort((a, b) => b.amount - a.amount || b.n - a.n)
  .map((g) => ({ '卖家（供应商）': g.seller, '1688订单数': g.n, '其中已发货(有运单号)': g.shipped, '合计金额(元)': Number(g.amount.toFixed(2)) }));
grpRows2.push({ '卖家（供应商）': '【合计】', '1688订单数': aRecs.length, '其中已发货(有运单号)': withTrack, '合计金额(元)': Number(aRecs.reduce((s, a) => s + a.amount, 0).toFixed(2)) });

// ================= 导出 =================
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(grpRows), '按卖家分组可开票');
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(matched.length ? matched : [{ 提示: '无匹配' }]), '匹配结果');
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pUnmatched.length ? pUnmatched.map((p) => ({ '拼多多订单号': p.order_id, '快递单号': p.tracking_no, '收货人': p.buyer, '备注': p.tracking_no ? '有单号但1688侧无此运单' : '无快递单号（多为待发货）' })) : [{ 提示: '无' }]), '未匹配_拼多多');
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(aLeft.length ? aLeft.map((a) => ({ '1688订单号': a.order_id, '卖家': a.seller, '快递公司': a.courier, '快递单号': a.tracking_no, '订单状态': a.status })) : [{ 提示: '无' }]), '未匹配_1688');
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(aRecs.map((a) => ({ '1688订单号': a.order_id, '卖家': a.seller, '快递公司': a.courier, '快递单号': a.tracking_no, '实付款(元)': a.amount, '订单状态': a.status }))), '1688全量汇总');
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(grpRows2), '按卖家分组(1688全部)');

const out = 'C:/Users/JoShua/Desktop/1688_拼多多_匹配结果_2026-10-07.xlsx';
fs.writeFileSync(out.replace(/^C:\/Users\/JoShua\/Desktop\//, ''), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
// 中文路径兜底：先写到 ASCII 名，再复制
fs.copyFileSync('1688_拼多多_匹配结果_2026-10-07.xlsx', out);
console.log('\n已写出：' + out);
console.log('\n=== 按卖家分组可开票（Top） ===');
grpRows.slice(0, 8).forEach((r) => console.log(`  ${r['卖家（供应商）']}  单数=${r['可开票订单数']}  金额=¥${r['合计金额(元)']}`));
