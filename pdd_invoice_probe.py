#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
拼多多发票 API 探测脚本
======================
目的：用最低成本验证「官方接口到底能不能返回你要的开票字段（发票抬头 / 税号 / 订单号 / 金额）」，
      以及你的店铺（企业店 / 个人店）是否有权限调用 `pdd.invoice.application.query`。

依赖：pip install requests

配置：复制 pdd_config.example.json 为 pdd_config.json，填入：
  - client_id / client_secret：开放平台「应用管理」创建应用后获取
  - access_token：店铺主账号 OAuth 授权获取（应用 → 授权管理 → 生成授权链接 → 主账号授权 → 回调 code 换 token）
  - 可在 shops 列表里放多个店铺（企业店 / 个人店各一个），一次跑完对比权限差异

运行：python pdd_invoice_probe.py
"""
import hashlib
import json
import os
import sys
import time

try:
    import requests
except ImportError:
    sys.exit("请先安装 requests：pip install requests")

API_GW = "https://gw-api.pinduoduo.com/api/router"


def sign(params, secret):
    """拼多多 API 签名：secret + 按 key 升序拼接 k+v + secret，md5 小写。"""
    s = secret + "".join(f"{k}{params[k]}" for k in sorted(params)) + secret
    return hashlib.md5(s.encode("utf-8")).hexdigest()


def call(client_id, secret, token, api_type, biz=None):
    p = {
        "type": api_type,
        "client_id": client_id,
        "access_token": token,
        "timestamp": str(int(time.time())),
        "data_type": "JSON",
    }
    if biz:
        p.update({k: str(v) for k, v in biz.items()})
    p["sign"] = sign(p, secret)
    r = requests.post(API_GW, data=p, timeout=20)
    return r.json()


def find_keys(obj, needle, path=""):
    """递归找出所有叶子 key 路径包含 needle 的 (path, value)。"""
    res = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            res += find_keys(v, needle, f"{path}.{k}" if path else k)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            res += find_keys(v, needle, f"{path}[{i}]")
    else:
        if needle.lower() in path.lower():
            res.append((path, obj))
    return res


def probe(shop):
    print("=" * 64)
    print("店铺：%s" % shop.get("name", "?"))
    print("=" * 64)
    now = int(time.time() * 1000)
    start = now - 7 * 24 * 3600 * 1000
    biz = {"page": 1, "page_size": 10, "update_start_time": str(start), "update_end_time": str(now)}
    if shop.get("order_sn"):
        biz = {"order_sn": shop["order_sn"], "page": 1, "page_size": 10}
    try:
        resp = call(shop["client_id"], shop["client_secret"], shop["access_token"],
                    "pdd.invoice.application.query", biz)
    except Exception as e:
        print("请求异常：", e)
        return

    print("原始响应：")
    print(json.dumps(resp, ensure_ascii=False, indent=2))

    if "error_response" in resp:
        err = resp["error_response"]
        print("\n[权限/错误] code=%s sub_msg=%s msg=%s"
              % (err.get("code"), err.get("sub_msg"), err.get("msg")))
        print("→ 若提示无权限/未授权，说明该店铺（或应用）未开通发票类接口。\n")
        return

    for label, kw in [("发票抬头(name)", "name"), ("税号(tax)", "tax"),
                      ("订单号(order_sn)", "order_sn"), ("金额(amount)", "amount"),
                      ("抬头(title)", "title")]:
        hits = find_keys(resp, kw)
        vals = [v for _, v in hits if v not in (None, "", [], {})]
        if vals:
            print("[%s] 命中 %d 处，非空值示例：%s" % (label, len(hits), vals[:5]))
        else:
            print("[%s] 命中 %d 处，但均为空/脱敏（拿不到完整数据）" % (label, len(hits)))
    print()


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    cfg_path = os.path.join(here, "pdd_config.json")
    if not os.path.exists(cfg_path):
        sys.exit("找不到 %s，请复制 pdd_config.example.json 为 pdd_config.json 并填入凭证。" % cfg_path)
    cfg = json.load(open(cfg_path, encoding="utf-8"))
    shops = cfg.get("shops") or [cfg]
    for s in shops:
        if not (s.get("client_id") and s.get("client_secret") and s.get("access_token")):
            print("[跳过] 店铺 %s 凭证不完整" % s.get("name", "?"))
            continue
        probe(s)


if __name__ == "__main__":
    main()
