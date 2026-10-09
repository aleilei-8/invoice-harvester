// store.js —— 轻量 JSON 文件状态库
// 记录 PDD 订单 ↔ 1688 采购单 ↔ 物流回执 的映射，跨「建单」与「回填」两个阶段共享。
// 状态机：po_created(已建采购单) → tracked(已抓到物流,待人工确认回填)
//                      → delivered(已回传 PDD 发货)。
// 默认只把 po_created 视为待处理；tracked/delivered 不再重复跑。
"use strict";
const fs = require("fs");
const path = require("path");

const DEFAULT_FILE = path.join(__dirname, "..", "state.json");

function load(file = DEFAULT_FILE) {
  if (!fs.existsSync(file)) return { orders: [] };
  try {
    const s = JSON.parse(fs.readFileSync(file, "utf8"));
    return s.orders ? s : { orders: [] };
  } catch {
    return { orders: [] };
  }
}

function save(state, file = DEFAULT_FILE) {
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
}

function find(state, pddOrderSn) {
  return state.orders.find(o => o.pddOrderSn === pddOrderSn) || null;
}

// 合并写入：按 pddOrderSn 幂等 upsert
function upsert(state, rec) {
  if (!rec || !rec.pddOrderSn) throw new Error("upsert 需要 pddOrderSn");
  const i = state.orders.findIndex(o => o.pddOrderSn === rec.pddOrderSn);
  if (i >= 0) state.orders[i] = { ...state.orders[i], ...rec };
  else state.orders.push(rec);
}

// 待处理订单：仅 po_created（已建采购单、尚未抓到物流）
function pending(state) {
  return state.orders.filter(o => o.status === "po_created");
}

module.exports = { load, save, find, upsert, pending, DEFAULT_FILE };
