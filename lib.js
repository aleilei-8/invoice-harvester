// lib.js —— 纯数据逻辑（与 DOM 无关，可在浏览器与 Node 中共用、可单元测试）
// 同时支持浏览器全局 IH_LIB 与 Node module.exports。
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.IH_LIB = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // 标准输出字段（顺序即导出列顺序）
  // v2.3 新增订单查询相关列：成交时间/数量/商品总价/收货信息/备注
  const FIELDS = [
    { key: "buyer_title", label: "发票抬头" },
    { key: "tax_no", label: "税号" },
    { key: "invoice_kind", label: "发票种类" },
    { key: "invoice_type", label: "发票类型" },
    { key: "extra_info", label: "其他信息" },
    { key: "order_id", label: "订单号" },
    { key: "order_status", label: "订单状态" },
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

  // 把任意金额文本解析成数字（去掉 ¥、逗号、空格、货币符号等）
  function parseAmount(v) {
    if (v == null) return 0;
    if (typeof v === "number") return v;
    const s = String(v).replace(/[^\d.\-]/g, "");
    if (!s) return 0;
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }

  // ===== 订单号清洗 =====
  // 从混合文本（如「2603007-49339701071913 逾期未开票」）中提取纯订单号：
  // 取第一段「数字开头、长度≥8、可含连字符」的 token。
  function cleanOrderId(v) {
    if (v == null) return "";
    const s = String(v).trim();
    if (!s) return "";
    const m = s.match(/[A-Za-z]*\d[\d\-]{7,}/);
    return m ? m[0] : s.split(/\s+/)[0];
  }

  // ===== 内容嗅探（表头匹配不上/匹配错时的二次校验）=====
  // 对一列的取值做统计，返回该列内容"最像"的角色或 null。
  function sniffRole(values) {
    const vals = (values || []).filter((v) => v != null && String(v).trim() !== "");
    if (vals.length < 2) return null;
    let order = 0, amount = 0, date = 0;
    vals.forEach((v) => {
      const s = String(v).trim();
      const isDate = /\d{4}[-/年]\d{1,2}[-/月]\d{1,2}/.test(s);
      if (isDate) { date++; return; } // 日期不算订单号
      if (/^\d[\d\-]{7,}(\s|$)/.test(s) || /^\d{8,}$/.test(s.replace(/\s.*/, ""))) order++;
      if (/[¥￥]/.test(s) || /^\d{1,3}(,\d{3})*(\.\d+)?$/.test(s)) amount++;
    });
    const n = vals.length;
    if (date / n >= 0.6) return "invoice_date";
    if (order / n >= 0.6) return "order_id";
    if (amount / n >= 0.6) return "amount";
    return null;
  }

  // 按发票抬头分组（同一公司多笔合并），返回按合计金额降序的分组数组
  function groupByTitle(records) {
    const map = new Map();
    (records || []).forEach((r) => {
      const title = (r && r.buyer_title != null ? String(r.buyer_title) : "").trim();
      const key = title || "(未填写抬头)";
      if (!map.has(key)) {
        map.set(key, { title: key, count: 0, total: 0, orders: [], taxNo: "", items: new Set() });
      }
      const g = map.get(key);
      g.count += 1;
      g.total += parseAmount(r.amount);
      const oid = r.order_id != null ? String(r.order_id).trim() : "";
      if (oid && g.orders.indexOf(oid) === -1) g.orders.push(oid);
      if (!g.taxNo && r.tax_no) g.taxNo = r.tax_no;
      if (r.items) g.items.add(r.items);
    });
    const groups = Array.from(map.values()).map((g) => ({
      title: g.title,
      count: g.count,
      total: Math.round(g.total * 100) / 100,
      orders: g.orders,
      taxNo: g.taxNo,
      items: Array.from(g.items).join("、"),
    }));
    groups.sort((a, b) => b.total - a.total);
    return groups;
  }

  // 明细 sheet：表头 + 每行
  function detailRows(records) {
    const header = FIELDS.map((f) => f.label);
    const rows = (records || []).map((r) =>
      FIELDS.map((f) => (r && r[f.key] != null ? r[f.key] : ""))
    );
    return [header].concat(rows);
  }

  // 汇总 sheet：按抬头分组 + 合计行
  function summaryRows(groups) {
    const header = ["发票抬头", "税号", "笔数", "合计金额", "订单号列表", "物品清单"];
    const totalCount = groups.reduce((s, g) => s + g.count, 0);
    const totalAmount = groups.reduce((s, g) => s + g.total, 0);
    const rows = groups.map((g) => [
      g.title, g.taxNo, g.count, g.total, g.orders.join("、"), g.items,
    ]);
    rows.push([
      "合计", "", totalCount, Math.round(totalAmount * 100) / 100, "", "",
    ]);
    return [header].concat(rows);
  }

  // 构建导出 sheet 列表（明细 + 可选汇总）
  function buildSheets(records, opts) {
    opts = opts || {};
    const sheets = [{ name: "开票明细", rows: detailRows(records) }];
    if (opts.includeGrouped !== false) {
      sheets.push({ name: "按抬头汇总", rows: summaryRows(groupByTitle(records)) });
    }
    return sheets;
  }

  // 用 SheetJS 把 sheets（[{name, rows:[[...]]}]）转成 workbook 对象（XLSX 由调用方注入，保持库无关）
  function sheetsToWorkbook(sheets, XLSX) {
    if (!XLSX || !XLSX.utils) throw new Error("XLSX 库未注入");
    const wb = XLSX.utils.book_new();
    sheets.forEach((s) => {
      const ws = XLSX.utils.aoa_to_sheet(s.rows);
      XLSX.utils.book_append_sheet(wb, ws, String(s.name).slice(0, 31));
    });
    return wb;
  }

  return { FIELDS, parseAmount, cleanOrderId, sniffRole, groupByTitle, detailRows, summaryRows, buildSheets, sheetsToWorkbook };
});
