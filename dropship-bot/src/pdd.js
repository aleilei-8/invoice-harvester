// pdd.js —— PDD 开放平台 API 客户端（拉新订单 + 回传物流）
// 签名算法遵循 PDD 开放平台规范：按 key 升序拼接 key+value，首尾拼 client_secret，md5 大写。
"use strict";
const crypto = require("crypto");

const API = "https://gw-api.pinduoduo.com/api/router";

// 计算签名（纯函数，可单测）
function sign(params, secret) {
  const keys = Object.keys(params).filter(k => k !== "sign").sort();
  let raw = secret;
  for (const k of keys) raw += k + params[k];
  raw += secret;
  return crypto.createHash("md5").update(raw, "utf8").digest("hex").toUpperCase();
}

// 通用调用：返回解析后的 JSON
async function call(type, bizParams, { clientId, clientSecret }) {
  const params = {
    type,
    client_id: clientId,
    timestamp: Math.floor(Date.now() / 1000),
    data_type: "JSON",
    ...bizParams,
  };
  params.sign = sign(params, clientSecret);
  const body = new URLSearchParams(params).toString();
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json();
  if (json.error_response) {
    throw new Error(`PDD ${type} 失败: ${json.error_response.error_msg} (${json.error_response.sub_msg || ""})`);
  }
  return json;
}

// 拉取待发货新订单（status=1 待发货）。返回标准化订单数组。
async function fetchNewOrders(cfg) {
  const r = await call("pdd.order.list.get", {
    order_status: 1,
    page: 1,
    page_size: 50,
  }, cfg);
  const list = (r.order_list_get_response && r.order_list_get_response.order_list) || [];
  return list.map(o => ({
    orderId: o.order_sn,
    item: (o.item_list && o.item_list[0] && o.item_list[0].goods_name) || "",
    spec: (o.item_list && o.item_list[0] && o.item_list[0].goods_spec) || "",
    qty: (o.item_list && o.item_list[0] && o.item_list[0].goods_count) || 1,
    pddPaid: Number(o.pay_amount) / 100 || 0,
    recipientText: [
      `收货人：${o.receiver_name || ""}`,
      `手机号 ${o.receiver_phone || ""}`,
      `联系地址 ${o.address || ""}`,
    ].join(" "),
    raw: o,
  }));
}

// 常见快递公司 → PDD logistics_id（发货必填）。不完整，可按需扩充。
// 参考 PDD 开放平台「物流公司编码」文档。
const EXP_MAP = {
  "顺丰": 1, "顺丰速运": 1,
  "圆通": 8001, "圆通速递": 8001,
  "中通": 8002, "中通快递": 8002,
  "申通": 8003, "申通快递": 8003,
  "韵达": 8004, "韵达速递": 8004,
  "邮政": 8005, "邮政EMS": 8005, "EMS": 8005,
  "京东": 8006, "京东物流": 8006,
  "极兔": 8007, "极兔速递": 8007, "J&T": 8007,
  "德邦": 8008, "德邦快递": 8008,
  "百世": 8009, "百世快递": 8009,
};

// 承运商名 → PDD logistics_id（精确 + 模糊兜底）
function resolveLogisticsId(name) {
  if (name == null) return null;
  const key = String(name).trim();
  if (EXP_MAP[key]) return EXP_MAP[key];
  for (const k of Object.keys(EXP_MAP)) {
    if (key.includes(k) || k.includes(key)) return EXP_MAP[k];
  }
  return null;
}

// 回传物流单号到 PDD（发货）
// 用正式接口 pdd.logistics.trackingnumber.upload：必填 logistics_id（由承运商名解析）。
async function ship(orderSn, expName, expNo, cfg) {
  const logistics_id = resolveLogisticsId(expName);
  const biz = { order_sn: orderSn, tracking_number: expNo };
  if (logistics_id) biz.logistics_id = logistics_id;
  if (expName) biz.shipping_name = expName;
  return call("pdd.logistics.trackingnumber.upload", biz, cfg);
}

module.exports = { API, sign, call, fetchNewOrders, ship, EXP_MAP, resolveLogisticsId };
