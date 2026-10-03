// 标准输出字段由 lib.js 统一提供（浏览器全局 IH_LIB），保持插件与汇总逻辑单一数据源
const FIELDS = IH_LIB.FIELDS;

// ===== 各平台列角色关键词预设 =====
// 结构：role -> [关键词...]，匹配时取「最长命中关键词」决定角色，避免「编号」误伤「订单编号」。
const PLATFORM_PRESETS = {
  pdd: {
    name: "拼多多",
    keywords: {
      buyer_title: ["发票抬头", "抬头", "公司名称", "购买方名称", "购方名称", "名称"],
      tax_no: ["企业税号", "税号", "纳税人识别号", "统一社会信用代码", "识别号", "信用代码", "tax", "tin", "纳税人"],
      invoice_kind: ["发票种类", "发票类别", "种类"],
      invoice_type: ["发票类型", "蓝票", "红票"],
      extra_info: ["其他信息", "开户银行", "开户行"],
      order_id: ["订单号", "订单编号", "订单", "单号", "order", "no.", "编号"],
      order_status: ["订单/售后状态", "订单状态", "成交状态"],
      after_sale: ["售后状态", "售后"],
      trans_time: ["成交时间", "下单时间", "交易时间"],
      qty: ["数量", "件数"],
      goods_total: ["商品总价", "商品总额"],
      courier: ["快递公司", "承运公司", "承运商", "物流公司", "快递"],
      tracking_no: ["快递单号", "物流单号", "运单号", "货运单号", "tracking", "waybill"],
      logistics: ["物流信息", "物流"],
      amount: ["发票金额", "实收金额", "金额", "价税合计", "开票金额", "实付金额", "合计", "金额(元)", "商品总价(元)", "amount", "price", "价税"],
      items: ["商品信息", "商品名称", "物品", "商品", "发票内容", "货物", "货品", "宝贝标题", "item", "product", "内容", "品名"],
      invoice_date: ["开票时间", "开票日期", "开票日期时间"],
      apply_date: ["申请时间", "申请日期", "apply"],
      buyer: ["买家", "收货人", "购买方", "customer", "consignee", "收件人"],
      ship_to: ["收货信息", "收货人", "收货地址"],
      remark: ["备注", "用户备注", "买家留言", "操作/备注", "操作"],
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

// ===== 注入函数（extractTables / clickNextPage / pageSignature）已移至 pagefuncs.js =====

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

// ===== 抓取全部页（自动翻页）=====
const MAX_PAGES = 200;
let grabbingAll = false;

function injectOnce(tabId, func, args) {
  return new Promise((resolve) => {
    chrome.scripting.executeScript({ target: { tabId }, func, args: args || [] }, (res) => {
      if (chrome.runtime.lastError) { resolve(null); return; }
      resolve(res && res[0] && res[0].result !== undefined ? res[0].result : null);
    });
  });
}

function activeTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      resolve(tab && tab.url && tab.url.indexOf("http") === 0 ? tab : null);
    });
  });
}

function getKeywordsPromise() {
  return new Promise((resolve) => getActiveKeywords(resolve));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// 把 pagefuncs.js 注入目标页面（files 方式），让页面拥有 extractTables/clickNextPage/pageSignature
function ensurePageFuncs(tabId) {
  return new Promise((resolve) => {
    chrome.scripting.executeScript({ target: { tabId }, files: ["pagefuncs.js"] }, () => {
      resolve(!chrome.runtime.lastError);
    });
  });
}

// 读取页面内任务的状态，并按需取回 sincePage 之后尚未入库的页数据
function readGrabState(tabId, sincePage, wantChunk) {
  return injectOnce(tabId, (from, wc) => {
    const g = window.__IH_GRAB;
    if (!g) return null;
    const pages = g.pages || [];
    return {
      running: !!g.running,
      done: !!g.done,
      page: g.page || 0,
      note: g.note || "",
      lastClick: g.lastClick || "",
      mergedPage: g.mergedPage || 0,
      total: pages.length,
      chunk: wc ? pages.filter((p) => p.page > from) : [],
    };
  }, [sincePage, !!wantChunk]);
}

// 把「已入库到第几页」写回页面，避免弹窗重开后重复入库
function markMerged(tabId, n) {
  return injectOnce(tabId, (v) => { if (window.__IH_GRAB) window.__IH_GRAB.mergedPage = v; }, [n]);
}

async function grabAll() {
  if (grabbingAll) { log("已有一次「抓取全部页」在进行中", "warn"); return; }
  const tab = await activeTab();
  if (!tab) {
    $("status").textContent = "请先在电商商家后台打开页面";
    log("当前页面不是网页（http/https），请切换后重试", "err");
    return;
  }
  grabbingAll = true;
  $("btn-grab-all").disabled = true;
  try {
    const kw = await getKeywordsPromise();
    activeKeywords = kw;
    // 注入页面函数库 → 在**页面内**启动抓取循环（弹窗关闭也不中断）
    const injected = await ensurePageFuncs(tab.id);
    if (!injected) {
      log("注入页面函数库失败，请刷新商家后台页面后重试", "err");
      $("status").textContent = "注入失败，请刷新页面重试";
      return;
    }
    // 若页面内已有任务在跑（比如弹窗被关过再重开），直接接管，绝不重复启动
    const st0 = await readGrabState(tab.id, 0, false);
    let lastPage = (st0 && st0.mergedPage) || 0;
    if (st0 && st0.running) {
      log("检测到页面内已有抓取任务在运行，接管并继续入库（未重新启动循环）", "warn");
    } else {
      log("开始抓取全部页：循环在页面内运行，**弹窗可以关闭**；每页抓完即入库去重");
      $("status").textContent = "抓取全部页：启动中…";
      injectOnce(tab.id, grabAllInPage, [kw, FIELDS, MAX_PAGES]); // 长任务，不等待返回
      await sleep(600);
    }

    let totalAdded = 0, totalMerged = 0, totalRows = 0;
    let idleRounds = 0;
    for (let round = 0; round < 2400; round++) { // 最多轮询 ~60 分钟
      await sleep(1500);
      const st = await readGrabState(tab.id, lastPage, true);
      if (!st) {
        log("页面已刷新或跳转，抓取结束（已抓到的页已入库）", "warn");
        break;
      }
      if (st.chunk && st.chunk.length) {
        for (const pg of st.chunk) {
          const r = await mergeTablesIntoLib(pg.tables);
          totalAdded += r.added;
          totalMerged += r.merged;
          totalRows += r.rows;
          lastPage = Math.max(lastPage, pg.page);
          lastTables = pg.tables;
          renderTables(pg.tables);
          log(`第 ${pg.page} 页：新增 ${r.added}，合并 ${r.merged}（累计 ${totalRows} 行）`, "ok");
        }
        refreshLibCount();
        markMerged(tab.id, lastPage);
        idleRounds = 0;
      } else {
        idleRounds++;
      }
      $("status").textContent = `抓取中：已入库 ${lastPage} 页（页面正在处理第 ${st.page} 页）…弹窗可关闭`;
      if (st.done) {
        const tail = st.note ? `（${st.note}）` : "";
        log(`全部页抓取完成：共 ${lastPage} 页，新增 ${totalAdded} 条，合并 ${totalMerged} 条${tail}`, "ok");
        $("status").textContent = `抓取完成：${lastPage} 页，新增 ${totalAdded} / 合并 ${totalMerged} 条`;
        break;
      }
      if (idleRounds > 40) { // 连续 60 秒没有任何新页 → 认为任务已卡死/结束
        log("长时间无新页，停止等待（已抓到的页已入库）", "warn");
        break;
      }
    }
  } finally {
    grabbingAll = false;
    $("btn-grab-all").disabled = false;
  }
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
    const titleText = t.title ? t.title : `表 #${t.idx + 1}`;
    head.innerHTML = `<span class="tc-title">${titleText}</span><span class="tc-info">${t.rowCount} 行 × ${t.headers.length} 列 · 自动识别 ${t.autoRoles.length} 列</span>`;
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

// ===== 追加到汇总库（Promise 版，供手动追加与自动翻页共用）=====
// 返回 { added, merged, skipped, rows }
function mergeTablesIntoLib(tables) {
  return new Promise((resolve) => {
    const plat = $("platform").value;
    const sourceLabel = plat === "custom" ? "ecom-order-helper/custom" : "ecom-order-helper/" + plat;
    chrome.storage.local.get("invoice_records", (d) => {
      const lib = Array.isArray(d.invoice_records) ? d.invoice_records.slice() : [];
      let added = 0;
      let merged = 0;
      let skipped = 0;
      let rows = 0;
      const now = new Date().toISOString();

      tables.forEach((t) => {
        const colOf = {};
        Object.keys(t.roleMap).forEach((ci) => {
          const role = t.roleMap[ci];
          if (role) colOf[role] = parseInt(ci, 10);
        });
        t.rows.forEach((r) => {
          rows++;
          const rec = {};
          FIELDS.forEach((f) => {
            const ci = colOf[f.key];
            rec[f.key] = ci != null && r[ci] != null ? r[ci] : "";
          });
          rec.captured_at = now;
          rec.platform = plat;
          rec.source = sourceLabel;
          rec.order_id = IH_LIB.cleanOrderId(rec.order_id); // 剥离「订单号 逾期未开票」类混合文本
          const oid = (rec.order_id || "").trim();
          if (!oid) { skipped++; return; } // 无订单号的行（跨列行等）不入库
          const exist = lib.find((x) => (x.order_id || "").trim() === oid);
          if (exist) {
            // 按订单号合并：只补空字段（发票页 + 订单页信息自动拼合）
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
        resolve({ added, merged, skipped, rows });
      });
    });
  });
}

function append() {
  if (!lastTables) {
    log("请先点「抓取本页」", "warn");
    return;
  }
  mergeTablesIntoLib(lastTables).then((r) => {
    refreshLibCount();
    let msg = `追加完成：新增 ${r.added} 条，合并补充 ${r.merged} 条`;
    if (r.skipped) msg += `，跳过无订单号行 ${r.skipped} 条`;
    log(msg, "ok");
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
    a.download = `电商订单信息汇总_${dt}.csv`;
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
      XLSX.writeFile(wb, `电商订单信息汇总_${dt}.xlsx`); // 浏览器环境自动触发下载
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

// ===== 诊断：复制本页所有表格的原始表头与首行（适配新平台用）=====
function copyDiag() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || !tab.url || !(tab.url.indexOf("http") === 0)) {
      log("请先打开商家后台页面再诊断", "warn");
      return;
    }
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const tables = Array.from(document.querySelectorAll("table")).map((tbl, idx) => {
          const allRows = Array.from(tbl.querySelectorAll("tr"));
          const headerRow = allRows.find((r) => r.querySelector("th")) || allRows[0];
          const headers = headerRow
            ? Array.from(headerRow.querySelectorAll("th, td")).map((c) => c.innerText.trim())
            : [];
          const dataRows = allRows.filter((r) => r !== headerRow);
          const rowsText = dataRows.slice(0, 4).map((r) =>
            Array.from(r.querySelectorAll("th, td")).map((c) => c.innerText.replace(/\s+/g, " ").trim()).join(" ¦ ")
          );
          const firstRow = dataRows[0]
            ? Array.from(dataRows[0].querySelectorAll("th, td")).map((c) => c.innerText.replace(/\s+/g, " ").trim())
            : [];
          return { idx, totalRows: dataRows.length, headers, firstRow, rowsText };
        });
        // 物流配对（与本扩展抓取逻辑一致的「订单窗口」法：直接验证「订单号→物流段」配对）
        const logiMap = {};
        try {
          const txt = String((document.body && document.body.innerText) || "").replace(/\s+/g, " ");
          const ids = [];
          const idRe = /订单编号[:：]\s*([A-Za-z]*\d[\d\-]{5,})/g;
          let mm;
          while ((mm = idRe.exec(txt)) !== null) ids.push({ oid: mm[1], start: mm.index, end: mm.index + mm[0].length });
          const labelRe = /物流信息\s*[:：]?/g;
          for (let i = 0; i < ids.length; i++) {
            const from = ids[i].end;
            const to = i + 1 < ids.length ? ids[i + 1].start : txt.length;
            const win = txt.slice(from, to);
            const hits = [];
            let m2;
            labelRe.lastIndex = 0;
            while ((m2 = labelRe.exec(win)) !== null) hits.push(m2.index);
            for (let k = 0; k < hits.length; k++) {
              const s = hits[k];
              const e = k + 1 < hits.length ? hits[k + 1] : win.length;
              const seg = win.slice(s, e).trim();
              if (seg) (logiMap[ids[i].oid] = logiMap[ids[i].oid] || []).push(seg);
            }
          }
        } catch (e) { /* 忽略 */ }
        const outerLogi = Object.keys(logiMap).slice(0, 80).map((oid) => ({
          oid,
          segs: logiMap[oid].map((s) => s.slice(0, 400)),
        }));
        // DOM 锚定探针（与抓取逻辑同源）：逐张订单表输出就近抓到的容器文本，
        // domText 为空 = 该订单周围压根没有物流文本（可据此判断是结构问题还是未渲染）
        const normEl = (el) => String((el && (el.innerText != null ? el.innerText : el.textContent)) || "").replace(/\s+/g, " ").trim();
        const logiProbe = [];
        Array.from(document.querySelectorAll("table")).forEach((tbl, idx) => {
          const h = normEl(tbl);
          const om = h.match(/订单编号[:：]\s*([A-Za-z]*\d[\d\-]{5,})/);
          if (!om) return;
          let node = tbl, found = "";
          for (let d = 0; node && d < 14 && !found; d++) {
            const t = normEl(node);
            if (t && t.length >= 20 && t.length < 8000) {
              const idCount = (t.match(/订单编号/g) || []).length;
              if (idCount <= 1) {
                if (/物流信息|快递|速递|速运|运单|包裹/.test(t)) found = t;
              } else { break; }
            }
            if (!found && node.parentElement && node.parentElement.children) {
              const kids = Array.from(node.parentElement.children);
              const i = kids.indexOf(node);
              if (i >= 0) {
                const parts = [];
                for (let k = i + 1; k < kids.length; k++) {
                  const tt = normEl(kids[k]);
                  if (!tt) continue;
                  if (/订单编号/.test(tt)) break;
                  parts.push(tt);
                }
                const s = parts.join(" ").trim();
                if (s && /物流信息|快递|速递|速运|运单|包裹/.test(s)) found = s;
              }
            }
            node = node.parentElement;
          }
          logiProbe.push({ idx, oid: om[1], domLen: found.length, domText: found.slice(0, 400) });
        });
        return { url: location.href, title: document.title, outerLogi, logiProbe, tables };
      },
    }, (res) => {
      const data = res && res[0] && res[0].result;
      if (!data) {
        log("诊断失败：页面注入异常", "err");
        return;
      }
      const text = JSON.stringify(data, null, 2);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          () => {
            $("status").textContent = "诊断信息已复制到剪贴板";
            log("诊断信息已复制（含本页所有表格的原始表头+首行），粘贴发给开发者即可精确适配", "ok");
          },
          () => prompt("剪贴板不可用，请手动复制：", text)
        );
      } else {
        prompt("请手动复制诊断信息：", text);
      }
    });
  });
}

// ===== 初始化 =====
document.addEventListener("DOMContentLoaded", () => {
  loadPlatformSelector();
  $("btn-grab").addEventListener("click", grab);
  $("btn-grab-all").addEventListener("click", grabAll);
  $("btn-append").addEventListener("click", append);
  $("btn-export-csv").addEventListener("click", exportCsv);
  $("btn-export-xlsx").addEventListener("click", exportXlsx);
  $("btn-diag").addEventListener("click", copyDiag);
  $("btn-clear").addEventListener("click", clearLib);
  refreshLibCount();
  log("就绪。选择平台 → 打开对应商家后台发票/订单页 → 点「抓取本页」");
  // 弹窗重开时探测页面内是否还有任务在跑（弹窗可以关掉，任务在网页里继续）
  (async () => {
    const tab = await activeTab();
    if (!tab) return;
    const st = await readGrabState(tab.id, 0, false);
    if (!st) return;
    if (st.running) {
      $("status").textContent = `页面内抓取任务运行中：正在处理第 ${st.page} 页…`;
      log(`检测到页面内抓取任务仍在运行（第 ${st.page} 页）——点「抓取全部页」可接管并继续入库`, "warn");
    } else if (st.done && st.total > st.mergedPage) {
      log(`页面内有 ${st.total - st.mergedPage} 页抓取结果尚未入库——点「抓取全部页」补入库`, "warn");
    }
  })();
});
