// 标准输出字段由 lib.js 统一提供（浏览器全局 IH_LIB），保持插件与汇总逻辑单一数据源
const FIELDS = IH_LIB.FIELDS;

// ===== 各平台列角色关键词预设 =====
// 结构：role -> [关键词...]，匹配时取「最长命中关键词」决定角色，避免「编号」误伤「订单编号」。
const PLATFORM_PRESETS = {
  pdd: {
    name: "拼多多",
    keywords: {
      buyer_title: ["发票抬头", "抬头", "公司名称", "购买方名称", "购方名称", "名称"],
      tax_no: ["税号", "纳税人识别号", "统一社会信用代码", "识别号", "信用代码", "tax", "tin", "纳税人"],
      order_id: ["订单号", "订单编号", "订单", "单号", "order", "no.", "编号"],
      tracking_no: ["快递单号", "物流单号", "运单号", "货运单号", "tracking", "waybill", "物流"],
      amount: ["金额", "价税合计", "开票金额", "实付金额", "合计", "金额(元)", "amount", "price", "价税"],
      items: ["物品", "商品", "发票内容", "货物", "货品", "商品名称", "item", "product", "内容", "品名"],
      invoice_date: ["开票时间", "开票日期", "开票"],
      apply_date: ["申请时间", "申请日期", "apply"],
      buyer: ["买家", "收货人", "购买方", "customer", "consignee", "收件人"],
    },
  },
  taobao: {
    name: "淘宝 / 天猫",
    keywords: {
      buyer_title: ["发票抬头", "抬头", "公司", "购买方名称", "购方名称", "名称"],
      tax_no: ["税号", "纳税人识别号", "统一社会信用代码", "识别号", "信用代码", "tin"],
      order_id: ["订单编号", "订单号", "订单", "单号", "trade", "no.", "编号"],
      tracking_no: ["运单号", "物流单号", "快递单号", "waybill", "物流"],
      amount: ["实付金额", "订单金额", "应付金额", "价税合计", "金额", "合计", "amount", "price"],
      items: ["宝贝标题", "商品标题", "商品", "发票内容", "货物", "品名", "item", "product"],
      invoice_date: ["开票时间", "开票日期"],
      apply_date: ["申请时间", "申请日期", "apply"],
      buyer: ["收货人", "买家", "收件人", "consignee"],
    },
  },
  jd: {
    name: "京东",
    keywords: {
      buyer_title: ["发票抬头", "抬头", "购方名称", "公司名称", "名称"],
      tax_no: ["税号", "纳税人识别号", "统一社会信用代码", "识别号", "信用代码", "tin"],
      order_id: ["订单号", "订单编号", "订单", "单号", "order", "no.", "编号"],
      tracking_no: ["运单号", "物流单号", "快递单号", "waybill", "物流"],
      amount: ["应付金额", "实付金额", "订单金额", "价税合计", "金额", "合计", "amount", "price"],
      items: ["商品名称", "商品", "发票内容", "货物", "品名", "item", "product"],
      invoice_date: ["开票时间", "开票日期"],
      apply_date: ["申请时间", "申请日期", "apply"],
      buyer: ["收货人", "买家", "收件人", "consignee"],
    },
  },
  douyin: {
    name: "抖音小店",
    keywords: {
      buyer_title: ["发票抬头", "抬头", "购买方名称", "公司名称", "名称"],
      tax_no: ["税号", "纳税人识别号", "统一社会信用代码", "识别号", "信用代码", "tin"],
      order_id: ["订单号", "订单编号", "订单", "单号", "order", "no.", "编号"],
      tracking_no: ["物流单号", "快递单号", "运单号", "waybill", "物流"],
      amount: ["订单金额", "实付金额", "价税合计", "金额", "合计", "amount", "price"],
      items: ["商品名称", "商品", "发票内容", "货物", "品名", "item", "product"],
      invoice_date: ["开票时间", "开票日期"],
      apply_date: ["申请时间", "申请日期", "apply"],
      buyer: ["收货人", "买家", "收件人", "consignee"],
    },
  },
};

const ROLE_LABEL = Object.fromEntries(FIELDS.map((f) => [f.key, f.label]));
ROLE_LABEL[""] = "忽略";

let lastTables = null;        // 最近一次抓取的结构
let activeKeywords = null;     // 当前生效的 ROLE_KEYWORDS

// ===== 注入到商家后台页面执行的提取函数（必须自包含）=====
function extractTables(roleKeywords, fields) {
  function matchRole(text, kw) {
    if (!text) return null;
    const t = text.toLowerCase();
    let best = null;
    let bestScore = 0;
    for (const role in kw) {
      for (const k of kw[role]) {
        if (t.indexOf(k.toLowerCase()) !== -1) {
          if (k.length > bestScore) {
            bestScore = k.length;
            best = role;
          }
        }
      }
    }
    return best;
  }

  const tables = Array.from(document.querySelectorAll("table"));
  const out = [];
  tables.forEach((tbl, idx) => {
    const allRows = Array.from(tbl.querySelectorAll("tr"));
    if (!allRows.length) return;

    let headerRow = allRows.find((r) => r.querySelector("th"));
    let headerCells, dataRows;
    if (headerRow) {
      headerCells = Array.from(headerRow.querySelectorAll("th, td")).map((c) => c.innerText.trim());
      dataRows = allRows.filter((r) => r !== headerRow);
    } else {
      headerCells = Array.from(allRows[0].querySelectorAll("th, td")).map((c) => c.innerText.trim());
      dataRows = allRows.slice(1);
    }
    if (headerCells.length < 2) return;

    const roleMap = {};
    const autoRoles = [];
    headerCells.forEach((hc, ci) => {
      const role = matchRole(hc, roleKeywords);
      roleMap[ci] = role;
      if (role) autoRoles.push(ci);
    });

    const rows = dataRows
      .map((r) => Array.from(r.querySelectorAll("th, td")).map((c) => c.innerText.replace(/\s+/g, " ").trim()))
      .filter((r) => r.length >= headerCells.length);

    if (!rows.length) return;
    out.push({ idx, headers: headerCells, roleMap, autoRoles, rows, rowCount: rows.length });
  });
  return { tables: out };
}

// ===== UI 辅助 =====
function $(id) { return document.getElementById(id); }

function log(msg, type) {
  const el = $("log");
  const line = document.createElement("div");
  line.className = "line" + (type ? " " + type : "");
  const ts = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  line.textContent = `[${ts}] ${msg}`;
  if (el) el.prepend(line);
}

function refreshLibCount() {
  chrome.storage.local.get("invoice_records", (d) => {
    const n = Array.isArray(d.invoice_records) ? d.invoice_records.length : 0;
    $("lib-count").textContent = `汇总库：${n} 条`;
  });
}

// ===== 关键词管理 =====
function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

// 取当前平台关键词：自定义模式从 storage 读，否则读预设
function getActiveKeywords(cb) {
  const plat = $("platform").value;
  if (plat === "custom") {
    chrome.storage.local.get("custom_keywords", (d) => {
      cb(d.custom_keywords && typeof d.custom_keywords === "object"
        ? d.custom_keywords
        : deepClone(PLATFORM_PRESETS.pdd.keywords));
    });
  } else {
    cb(deepClone(PLATFORM_PRESETS[plat].keywords));
  }
}

function loadPlatformSelector() {
  const sel = $("platform");
  // 填充平台选项
  Object.keys(PLATFORM_PRESETS).forEach((k) => {
    const o = document.createElement("option");
    o.value = k;
    o.textContent = PLATFORM_PRESETS[k].name;
    sel.appendChild(o);
  });
  const oc = document.createElement("option");
  oc.value = "custom";
  oc.textContent = "自定义";
  sel.appendChild(oc);

  chrome.storage.local.get("last_platform", (d) => {
    sel.value = d.last_platform || "pdd";
    onPlatformChange();
  });

  sel.addEventListener("change", onPlatformChange);
  $("btn-kw").addEventListener("click", toggleKwEditor);
  $("btn-kw-save").addEventListener("click", saveCustomKeywords);
  $("btn-kw-reset").addEventListener("click", resetCustomKeywords);
}

function onPlatformChange() {
  const plat = $("platform").value;
  chrome.storage.local.set({ last_platform: plat });
  const isCustom = plat === "custom";
  $("kw-bar").hidden = !isCustom;
  if (isCustom) {
    chrome.storage.local.get("custom_keywords", (d) => {
      const kw = d.custom_keywords && typeof d.custom_keywords === "object"
        ? d.custom_keywords
        : deepClone(PLATFORM_PRESETS.pdd.keywords);
      $("kw-edit").value = JSON.stringify(kw, null, 2);
    });
  }
  log(`已切换平台：${plat === "custom" ? "自定义" : PLATFORM_PRESETS[plat].name}`);
}

function toggleKwEditor() {
  const ed = $("kw-editor");
  ed.hidden = !ed.hidden;
}

function saveCustomKeywords() {
  let parsed;
  try {
    parsed = JSON.parse($("kw-edit").value);
  } catch (e) {
    $("kw-msg").textContent = "❌ JSON 格式错误，未保存";
    $("kw-msg").className = "kw-msg err";
    return;
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    $("kw-msg").textContent = "❌ 需为 { 角色: [关键词...] } 对象";
    $("kw-msg").className = "kw-msg err";
    return;
  }
  chrome.storage.local.set({ custom_keywords: parsed }, () => {
    $("kw-msg").textContent = "✅ 已保存，抓取时生效";
    $("kw-msg").className = "kw-msg ok";
    log("自定义关键词已保存", "ok");
  });
}

function resetCustomKeywords() {
  chrome.storage.local.set({ custom_keywords: deepClone(PLATFORM_PRESETS.pdd.keywords) }, () => {
    $("kw-edit").value = JSON.stringify(PLATFORM_PRESETS.pdd.keywords, null, 2);
    $("kw-msg").textContent = "已恢复默认（拼多多）关键词";
    $("kw-msg").className = "kw-msg";
    log("自定义关键词已恢复默认", "ok");
  });
}

// ===== 抓取 =====
function grab() {
  $("status").textContent = "正在抓取本页表格…";
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || !tab.url || !(tab.url.indexOf("http") === 0)) {
      $("status").textContent = "请先在电商商家后台打开页面";
      log("当前页面不是网页（http/https），请切换后重试", "err");
      return;
    }
    getActiveKeywords((kw) => {
      activeKeywords = kw;
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractTables,
        args: [kw, FIELDS],
      }, (res) => {
        if (chrome.runtime.lastError) {
          $("status").textContent = "抓取失败";
          log("抓取异常：" + chrome.runtime.lastError.message, "err");
          return;
        }
        const data = res && res[0] && res[0].result;
        if (!data || !data.tables.length) {
          $("status").textContent = "本页未识别到表格";
          log("未发现可抓取的表格（确认页面已加载、且是表格形式展示）", "warn");
          renderTables([]);
          return;
        }
        lastTables = data.tables;
        $("grab-count").textContent = `本次抓取：${data.tables.length} 张表 / ${data.tables.reduce((s, t) => s + t.rowCount, 0)} 行`;
        $("status").textContent = "抓取完成，可校正列角色后「追加」";
        log(`识别到 ${data.tables.length} 张表，共 ${data.tables.reduce((s, t) => s + t.rowCount, 0)} 行`, "ok");
        renderTables(data.tables);
      });
    });
  });
}

// ===== 渲染表格卡片 =====
function renderTables(tables) {
  const box = $("tables");
  box.innerHTML = "";
  if (!tables.length) {
    box.innerHTML = '<div class="empty">暂无可抓取的表格</div>';
    return;
  }
  tables.forEach((t, ti) => {
    const card = document.createElement("div");
    card.className = "table-card";

    const head = document.createElement("div");
    head.className = "tc-head";
    head.innerHTML = `<span class="tc-title">表 #${t.idx + 1}</span><span class="tc-info">${t.rowCount} 行 × ${t.headers.length} 列 · 自动识别 ${t.autoRoles.length} 列</span>`;
    card.appendChild(head);

    const cols = document.createElement("div");
    cols.className = "cols";
    t.headers.forEach((h, ci) => {
      const isAuto = t.autoRoles.indexOf(ci) !== -1;
      const wrap = document.createElement("div");
      wrap.className = "col" + (isAuto ? " auto" : "");
      const sel = document.createElement("select");
      const cur = t.roleMap[ci] || "";
      const optNone = document.createElement("option");
      optNone.value = "";
      optNone.textContent = "忽略";
      sel.appendChild(optNone);
      FIELDS.forEach((f) => {
        const o = document.createElement("option");
        o.value = f.key;
        o.textContent = f.label;
        if (f.key === cur) o.selected = true;
        sel.appendChild(o);
      });
      sel.className = cur ? "assigned" : "";
      sel.addEventListener("change", () => {
        lastTables[ti].roleMap[ci] = sel.value;
        sel.className = sel.value ? "assigned" : "";
      });
      const name = document.createElement("span");
      name.className = "col-name";
      name.textContent = h || "(空列名)";
      name.title = h;
      wrap.appendChild(name);
      wrap.appendChild(sel);
      cols.appendChild(wrap);
    });
    card.appendChild(cols);

    const prev = document.createElement("div");
    prev.className = "preview";
    const tbl = document.createElement("table");
    const thead = document.createElement("tr");
    t.headers.forEach((h, ci) => {
      const th = document.createElement("th");
      const role = t.roleMap[ci];
      th.textContent = role ? ROLE_LABEL[role] + "｜" + h : h;
      thead.appendChild(th);
    });
    tbl.appendChild(thead);
    t.rows.slice(0, 5).forEach((r) => {
      const tr = document.createElement("tr");
      r.forEach((c) => {
        const td = document.createElement("td");
        td.textContent = c;
        tr.appendChild(td);
      });
      tbl.appendChild(tr);
    });
    prev.appendChild(tbl);
    card.appendChild(prev);

    box.appendChild(card);
  });
}

// ===== 追加到汇总库 =====
function append() {
  if (!lastTables) {
    log("请先点「抓取本页」", "warn");
    return;
  }
  const plat = $("platform").value;
  const sourceLabel = plat === "custom" ? "invoice-harvester/custom" : "invoice-harvester/" + plat;
  chrome.storage.local.get("invoice_records", (d) => {
    const lib = Array.isArray(d.invoice_records) ? d.invoice_records.slice() : [];
    let added = 0;
    let merged = 0;
    const now = new Date().toISOString();

    lastTables.forEach((t) => {
      const colOf = {};
      Object.keys(t.roleMap).forEach((ci) => {
        const role = t.roleMap[ci];
        if (role) colOf[role] = parseInt(ci, 10);
      });
      t.rows.forEach((r) => {
        const rec = {};
        FIELDS.forEach((f) => {
          const ci = colOf[f.key];
          rec[f.key] = ci != null && r[ci] != null ? r[ci] : "";
        });
        rec.captured_at = now;
        rec.platform = plat;
        rec.source = sourceLabel;
        const oid = (rec.order_id || "").trim();
        if (oid && lib.some((x) => (x.order_id || "").trim() === oid)) {
          const exist = lib.find((x) => (x.order_id || "").trim() === oid);
          FIELDS.forEach((f) => {
            if (!exist[f.key] && rec[f.key]) exist[f.key] = rec[f.key];
          });
          merged++;
        } else {
          lib.push(rec);
          added++;
        }
      });
    });

    chrome.storage.local.set({ invoice_records: lib }, () => {
      refreshLibCount();
      log(`追加完成：新增 ${added} 条，合并补充 ${merged} 条`, "ok");
    });
  });
}

// ===== 导出 CSV =====
function exportCsv() {
  chrome.storage.local.get("invoice_records", (d) => {
    const lib = Array.isArray(d.invoice_records) ? d.invoice_records : [];
    if (!lib.length) {
      log("汇总库为空，无可导出数据", "warn");
      return;
    }
    const header = FIELDS.map((f) => f.label);
    const lines = [header.join(",")];
    lib.forEach((rec) => {
      const row = FIELDS.map((f) => csvCell(rec[f.key] != null ? rec[f.key] : ""));
      lines.push(row.join(","));
    });
    const csv = "﻿" + lines.join("\r\n"); // BOM 保证 Excel 中文不乱码
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const dt = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `电商开票汇总_${dt}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    log(`已导出 ${lib.length} 条到 CSV`, "ok");
  });
}

function csvCell(v) {
  const s = String(v == null ? "" : v);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// ===== 导出 XLSX（内联 SheetJS，免 Python）=====
function exportXlsx() {
  chrome.storage.local.get("invoice_records", (d) => {
    const lib = Array.isArray(d.invoice_records) ? d.invoice_records : [];
    if (!lib.length) {
      log("汇总库为空，无可导出数据", "warn");
      return;
    }
    if (typeof XLSX === "undefined") {
      log("XLSX 库未加载，请改用 CSV 导出或重启插件", "err");
      return;
    }
    const includeGrouped = $("opt-group") ? $("opt-group").checked : true;
    const sheets = IH_LIB.buildSheets(lib, { includeGrouped });
    let wb;
    try {
      wb = IH_LIB.sheetsToWorkbook(sheets, XLSX);
    } catch (e) {
      log("生成工作簿失败：" + e.message, "err");
      return;
    }
    const dt = new Date().toISOString().slice(0, 10);
    try {
      XLSX.writeFile(wb, `电商开票汇总_${dt}.xlsx`); // 浏览器环境自动触发下载
      const extra = includeGrouped ? "（含「按抬头汇总」sheet）" : "";
      log(`已导出 ${lib.length} 条到 XLSX${extra}`, "ok");
    } catch (e) {
      log("导出 XLSX 失败：" + e.message, "err");
    }
  });
}

// ===== 清空库 =====
function clearLib() {
  if (!confirm("确定清空本地汇总库？此操作不可撤销。")) return;
  chrome.storage.local.set({ invoice_records: [] }, () => {
    refreshLibCount();
    log("汇总库已清空", "warn");
  });
}

// ===== 初始化 =====
document.addEventListener("DOMContentLoaded", () => {
  loadPlatformSelector();
  $("btn-grab").addEventListener("click", grab);
  $("btn-append").addEventListener("click", append);
  $("btn-export-csv").addEventListener("click", exportCsv);
  $("btn-export-xlsx").addEventListener("click", exportXlsx);
  $("btn-clear").addEventListener("click", clearLib);
  refreshLibCount();
  log("就绪。选择平台 → 打开对应商家后台发票/订单页 → 点「抓取本页」");
});
