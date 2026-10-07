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
  "1688": {
    name: "1688 采购",
    mode: "1688",
    keywords: {
      order_id: ["订单编号", "订单号", "订单", "单号", "order", "no.", "编号"],
      seller: ["卖家公司名", "卖家", "供应商", "供货商", "company", "supplier"],
      tracking_no: ["运单号", "物流单号", "快递单号", "waybill", "物流"],
      courier: ["物流公司", "快递公司", "承运商", "快递"],
      amount: ["实付款", "实付金额", "金额", "价税合计", "应付金额", "amount", "price"],
      items: ["货品标题", "商品", "货品", "item", "product"],
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

function refreshA1688Count() {
  const el = $("a1688-count");
  if (!el) return;
  chrome.storage.local.get({ a1688_orders: [] }, (d) => {
    const n = Array.isArray(d.a1688_orders) ? d.a1688_orders.length : 0;
    el.textContent = `1688已解析：${n} 条`;
  });
}

function refreshPddCount() {
  const el = $("pdd-count");
  if (!el) return;
  chrome.storage.local.get({ pdd_orders: [] }, (d) => {
    const n = Array.isArray(d.pdd_orders) ? d.pdd_orders.length : 0;
    el.textContent = `拼多多已入库：${n} 条`;
  });
}

// ===== 1688 专区：两种导出（v3.3.1）=====
// 对应 1688 页面上的两个按钮，各点一次、绝不循环重试（v3.2.0 疯狂下载事故教训）。
// mode: "selected"（导出所选订单）/ "condition"（导出当前条件）
// 流程：注入 → 逐帧问询 __IH_PAGE_SEL(mode) 找到**真的有目标按钮**的帧 → args 传参定点点击。
async function export1688(mode) {
  const btn = mode === "condition" ? $("btn-exp-cond") : $("btn-exp-sel");
  const label = mode === "condition" ? "导出当前条件" : "导出所选订单";
  const tab = await activeTab();
  if (!tab || !tab.url || !/1688\.com/i.test(tab.url || "")) {
    $("status").textContent = "请先打开 1688 订单页面";
    log("「" + label + "」需要在 1688 订单列表页使用（当前标签页不是 1688）", "err");
    return;
  }
  if (btn) btn.disabled = true;
  $("status").textContent = "1688 " + label + "…";
  try {
    await injectAllFrames(tab.id);
    const cands = ((await probe1688Frames(tab.id)) || []).filter((c) => (c.score || 0) > 0).slice(0, 6);
    if (!cands.length) {
      log("未找到 1688 订单帧。请确认：① 当前在 1688「已买到的货品」订单列表页；② 对页面按 F5 后重试。", "err");
      $("status").textContent = "未找到 1688 订单帧";
      return;
    }
    // 逐帧问询：优先选「亮按钮」所在帧，其次记录第一个含按钮的帧（分值最高的帧不一定含按钮）
    let target = null;
    for (const c of cands) {
      const res = await runFrame(tab.id, c.frameId, (m) => (window.__IH_PAGE_SEL) ? window.__IH_PAGE_SEL(m) : null, [mode]);
      const arr = Array.isArray(res) ? res : [res];
      const s = (arr[0] && arr[0].result) || null;
      if (!s || !s.btnFound) continue;
      if (!target) target = { frame: c, sel: s };
      if (s.anyEnabled) { target = { frame: c, sel: s }; break; }
    }
    if (!target) {
      log(`⚠ ${cands.length} 个候选帧里都没有「${label}」按钮。最可能原因：页面脚本还是旧版（对 1688 页按 F5 刷新，弹窗徽标「页面 v」应显示 ${PAGE_VER}）`, "err");
      $("status").textContent = "未找到导出按钮";
      return;
    }
    log(`已定位「${label}」按钮：${target.frame.url || target.frame.rawUrl}（按钮${target.sel.btnDisabled ? "当前置灰" : "可用"}）`, "ok");
    // v3.3.5：skipCheck=1 —— 弹窗侧已用 __IH_PAGE_SEL 探测放行（fail-open），
    // 页面侧不再做第二套校验（两套逻辑分叉是 v3.3.1~3.3.4 四连误拦的根因）。
    // 点错灰按钮=无害 no-op，代价远小于误拦锁死。
    const res = await runFrame(tab.id, target.frame.frameId, (m, skip) =>
      (window.__IH_PAGE_EXPORT) ? window.__IH_PAGE_EXPORT(m, !!skip) : { err: "页面函数未注入，请 F5 后重试" }, [mode, 1]);
    const arr = Array.isArray(res) ? res : [res];
    const out = ((arr[0] && arr[0].result) || arr[0] || {});
    (out.log || []).forEach((l) => log(l, out.ok ? "ok" : "warn"));
    if (out.err === "no-selection") {
      $("status").textContent = "请先在1688选择要导出的订单";
      log("「导出所选订单」只能导出当前页勾选的订单（不支持跨页选择）：请先在 1688 买家工作台全选或点选要导出的订单，再点此按钮", "warn");
    } else if (out.ok) {
      $("status").textContent = out.dialog ? "已生成导出任务，报表生成后到导出记录点「下载」（自动入库）" : "导出已触发，下载完成后自动入库";
      log("✅ 导出已触发。浏览器下载完成后，后台会自动捕获并解析入库（「1688已解析」计数跳增）", "ok");
    } else if (out.err) {
      $("status").textContent = "导出失败（见日志）";
    }
  } catch (e) {
    log("导出异常：" + (e && e.message || e), "err");
    $("status").textContent = "导出异常";
  } finally {
    if (btn) btn.disabled = false;
    refreshA1688Count();
    setTimeout(refresh1688SelState, 3000);
  }
}

// 探测 1688 页面勾选状态 → 未勾选时禁用「导出所选订单」按钮并提示（v3.3.1）
// 判定优先级：1688 页面「导出所选订单」按钮是否置灰（最权威，与页面按钮同步亮灰）；
// 按钮没找到时才用勾选数兜底。v3.3.0 的 bug：只数"可见 input[type=checkbox]"，
// 而 1688 用 Fusion 自定义勾选框（input 视觉隐藏、勾选态在外壳类名上），永远数到 0 → 按钮一直灰。
async function refresh1688SelState() {
  const btn = $("btn-exp-sel");
  if (!btn || $("platform").value !== "1688") return;
  const tab = await activeTab();
  if (!tab || !tab.url || !/1688\.com/i.test(tab.url || "")) { btn.disabled = false; btn.title = "对应 1688 页面「导出所选订单」。请先打开 1688 订单列表页"; return; }
  try {
    await injectAllFrames(tab.id);
    const cands = ((await probe1688Frames(tab.id)) || []).filter((c) => (c.score || 0) > 0).slice(0, 6);
    let s = null;
    for (const c of cands) {
      const res = await runFrame(tab.id, c.frameId, (m) => (window.__IH_PAGE_SEL) ? window.__IH_PAGE_SEL(m) : null, ["selected"]);
      const arr = Array.isArray(res) ? res : [res];
      const r = (arr[0] && arr[0].result) || null;
      if (!r || !r.btnFound) continue;
      if (!s) s = r;
      if (r.anyEnabled) { s = r; break; } // 优先采纳「亮按钮」所在帧的结果
    }
    if (!s) { btn.disabled = false; btn.title = "对应 1688 页面「导出所选订单」（未探测到页面按钮，可直接点击尝试；若无效请 F5 刷新页面）"; return; }
    // v3.3.3 判定规则（反转）：勾选数>0 **或** 页面按钮亮 → 任一成立即启用；
    // 两者都否定才置灰。误灰会把用户锁死（v3.3.1/3.3.2 两次事故），误亮则有
    // __IH_PAGE_EXPORT 的点击前二次校验兜底，代价小得多。
    const hasSelection = (s.checked || 0) > 0;
    const pageBtnEnabled = s.anyEnabled === true || (s.btnFound && s.btnDisabled === false);
    const noSel = !hasSelection && !pageBtnEnabled;
    btn.disabled = noSel;
    const stateText = "勾选 " + (s.checked || 0) + " 项 / 页面按钮" + (s.anyEnabled ? "亮" : (s.btnFound ? (s.btnDisabled === true ? "灰" : "态未知") : "未找到"));
    btn.title = noSel
      ? "不可用：请先在 1688 买家工作台全选或点选要导出的订单（「导出所选订单」只支持当前页勾选，不支持跨页选择）"
      : "对应 1688 页面「导出所选订单」：只导出当前页勾选的订单（不支持跨页选择）——" + stateText;
    // 仅在状态变化时打一条日志（轮询 2.5s 一次，不刷屏），便于用户回报时给出精确定位
    const sig = noSel + "|" + stateText;
    if (sig !== refresh1688SelState._last) {
      refresh1688SelState._last = sig;
      log("1688 状态探测：" + stateText + (noSel ? " → 导出所选订单置灰（请先在页面勾选订单）" : " → 可点击导出"));
    }
  } catch (e) { btn.disabled = false; }
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
  const kwBar = $("kw-bar");
  if (kwBar) kwBar.hidden = !isCustom;
  // ★ v3.2.0 功能分区：1688 不支持自动翻页 → 只显示「导出捕获」专区；其他平台显示通用抓取区
  const is1688 = plat === "1688";
  if ($("sec-generic")) $("sec-generic").hidden = is1688;
  if ($("sec-1688")) $("sec-1688").hidden = !is1688;
  if (isCustom) {
    chrome.storage.local.get("custom_keywords", (d) => {
      const kw = d.custom_keywords && typeof d.custom_keywords === "object"
        ? d.custom_keywords
        : deepClone(PLATFORM_PRESETS.pdd.keywords);
      $("kw-edit").value = JSON.stringify(kw, null, 2);
    });
  }
  log(`已切换平台：${plat === "custom" ? "自定义" : PLATFORM_PRESETS[plat].name}`);
  if (is1688) refresh1688SelState();
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
  // ★ v3.2.0：1688 已取消一切自动导出（曾导致反复触发导出/疯狂下载）。
  //   1688 订单在 Shadow DOM + 跨域子应用里，页面抓表与自动翻页均不可靠 → 只用官方导出 + 被动捕获。
  if ($("platform") && $("platform").value === "1688") {
    log("1688 不支持页面抓取/自动翻页。请在 1688 订单页手动操作：筛选条件选「全部」→ 点「导出当前条件」→ 下载完成后自动入库（弹窗「1688已解析」计数跳增）。", "warn");
    $("status").textContent = "1688：请用页面上的「导出当前条件」";
    return;
  }
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
// 与 pagefuncs.js 里 window.__IH_PAGE.ver 保持一致：用于识别「页面里跑的是不是当前版本」
const PAGE_VER = "3.3.5";
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
      ver: g.ver || "",
      page: g.page || 0,
      curPage: g.curPage || 0,
      totalPages: g.total || 0,
      note: g.note || "",
      lastClick: g.lastClick || "",
      mergedPage: g.mergedPage || 0,
      total: pages.length,
      chunk: wc ? pages.filter((p) => p.page > from) : [],
    };
  }, [sincePage, !!wantChunk]);
}

// 请求页面内的抓取任务停止（抓完当前页后结束，已入库的页不丢）
function requestStop(tabId) {
  return injectOnce(tabId, () => { if (window.__IH_GRAB) window.__IH_GRAB.stop = true; }, []);
}

// 把「已入库到第几页」写回页面，避免弹窗重开后重复入库
function markMerged(tabId, n) {
  return injectOnce(tabId, (v) => { if (window.__IH_GRAB) window.__IH_GRAB.mergedPage = v; }, [n]);
}

async function grabAll() {
  const plat = $("platform").value;
  // ★ v3.2.0：1688 禁用自动导出（v3.0.16 的自动点「生成新报表/下载」会在判定"未入库"时
  //   反复触发 harvestPastReports + 逐页导出，几分钟内产生几十个重复下载文件）。
  if (plat === "1688") {
    log("⚠ 1688 已禁用「抓取全部页」自动导出：实测会反复触发「生成新报表/下载」造成大量重复下载。" +
      "正确做法：筛选条件选「全部」→ 手动点「导出当前条件」→ 下载的报表自动入库（一次即全量）。", "warn");
    $("status").textContent = "1688：请手动「导出当前条件」（自动翻页已禁用）";
    return;
  }
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
    if (st0 && st0.running && st0.ver !== PAGE_VER) {
      // 页面里的循环是**旧版本**注入的（比如刚更新完插件，但那个页面没刷新过）。
      // 旧循环不会用上新逻辑，直接接管只会「看着没变化」，所以先请它安全停下，再起新版。
      log(`页面里还在跑旧版本的抓取任务（v${st0.ver || "未知"}）→ 先让它安全停止，再启动 v${PAGE_VER} 的新逻辑；若仍异常请按 F5 刷新页面`, "warn");
      $("status").textContent = "正在停止旧版本抓取任务…";
      await requestStop(tab.id);
      await sleep(3000);
    }
    const st0b = await readGrabState(tab.id, 0, false);
    if (st0b && st0b.running) {
      log("检测到页面内已有抓取任务在运行，接管并继续入库（未重新启动循环）", "warn");
    } else {
      log("开始抓取全部页：循环在页面内运行，**弹窗可以关闭**；进度显示在网页右上角浮层");
      if (st0b && st0b.curPage > 1) {
        log(`注意：当前页面停在第 ${st0b.curPage} 页，脚本会先自动回到第 1 页再开始抓`, "warn");
      }
      $("status").textContent = "抓取全部页：启动中…";
      injectOnce(tab.id, grabAllInPage, [kw, FIELDS, MAX_PAGES]); // 长任务，不等待返回
      await sleep(600);
    }
    $("btn-stop").hidden = false;

    let totalAdded = 0, totalMerged = 0, totalRows = 0, lastCount = 0;
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
          lastCount = pg.tables.reduce((s, t) => s + t.rowCount, 0);
          renderTables(pg.tables);
          log(`第 ${pg.page} 页：新增 ${r.added}，合并 ${r.merged}（累计 ${totalRows} 行）`, "ok");
        }
        refreshLibCount();
        markMerged(tab.id, lastPage);
        idleRounds = 0;
      } else {
        idleRounds++;
      }
      const pgTxt = st.curPage ? `第 ${st.curPage}${st.totalPages ? "/" + st.totalPages : ""} 页` : `第 ${st.page} 页`;
      $("status").textContent = `抓取中：已入库 ${lastPage} 页 · ${pgTxt} · 进度浮层在网页右上角（弹窗可关闭）`;
      $("grab-count").textContent = `本次抓取：${lastPage} 页 / ${lastCount} 行`;
      if (st.done) {
        const tail = st.note ? `（${st.note}）` : "";
        log(`全部页抓取完成：共 ${lastPage} 页，新增 ${totalAdded} 条，合并 ${totalMerged} 条${tail}`, "ok");
        $("status").textContent = `抓取完成：${lastPage} 页，新增 ${totalAdded} / 合并 ${totalMerged} 条`;
        // 非正常收尾（翻页未生效 / 跳页 / 翻不动）时提醒核对，必要时清库重抓
        if (st.note && /完全相同|跳页|翻页失败|未识别到表格/.test(st.note)) {
          log("⚠️ 本次没有抓到最后一页。建议：按 F5 刷新商家后台页面 → 再点「抓取全部页」；" +
            "若汇总里有重复行，可点「清空汇总库」后重抓（导出前请先确认）", "warn");
        }
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
    $("btn-stop").hidden = true;
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

// ===== 清空 1688 已解析库（旧版本可能留下脏数据，清空后重新抓取）=====
function clearA1688() {
  if (!confirm("确定清空插件内已解析的 1688 订单库？\n（旧版本可能把「物流公司」误当归列，建议清空后重新抓取一次）")) return;
  chrome.storage.local.set({ a1688_orders: [], __ih_parse_log: [] }, () => {
    refreshA1688Count();
    log("1688 已解析库已清空。请刷新 1688 订单页 → 重新「抓取全部页」或手动导出下载一次", "warn");
  });
}

// ===== 导出 1688 已解析汇总表（自动翻页抓取后「汇总成一个表」的成果）=====
function exportA1688() {
  chrome.storage.local.get({ a1688_orders: [] }, (d) => {
    const lib = Array.isArray(d.a1688_orders) ? d.a1688_orders : [];
    if (!lib.length) {
      log("1688 汇总库为空：请先打开 1688 订单页 → 选平台 1688 → 点「抓取全部页」自动翻页", "warn");
      return;
    }
    if (typeof XLSX === "undefined") { log("XLSX 库未加载，无法导出", "err"); return; }
    const rows = lib.map((r) => ({
      "1688订单号": r.order_id || "",
      "卖家/供应商": r.seller || "",
      "快递公司": r.courier || "",
      "快递单号": r.tracking_no || "",
      "金额": r.amount || "",
      "货品": r.items || "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "1688订单汇总");
    const dt = new Date().toISOString().slice(0, 10);
    try {
      XLSX.writeFile(wb, `1688订单汇总_${dt}.xlsx`);
      log(`✅ 已导出 1688 汇总表（${lib.length} 条）到 XLSX`, "ok");
    } catch (e) { log("导出失败：" + e.message, "err"); }
  });
}

// ===== 诊断：复制本页所有表格的原始表头与首行（适配新平台用）=====
function copyDiag() {
  const selPlatform = $("platform").value;
  // URL 自动识别：只要在 1688 页面，无论下拉选什么都走 1688 专用诊断，
  // 避免用户忘记切平台导致跑错诊断（之前在 1688 页跑出 PDD 空结构）。
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || !tab.url || !(tab.url.indexOf("http") === 0)) {
      if (selPlatform === "1688") return copyDiag1688();
      log("请先打开商家后台页面再诊断", "warn");
      return;
    }
    if (selPlatform === "1688" || /1688\.com/i.test(tab.url)) return copyDiag1688();

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
        // 分页器探针：确认「抓取全部页」能否识别分页条 / 自动回到第 1 页
        // （与 pagefuncs.js 的 pagerInfo 同源逻辑，用于判断分页器没被识别时的真实结构）
        let pager = null;
        try {
          const vis = (el) => !!(el && el.offsetParent !== null);
          const numOf = (el) => { const t = String((el && el.innerText) || "").trim(); return /^\d{1,4}$/.test(t) ? parseInt(t, 10) : 0; };
          const cands = Array.from(document.querySelectorAll("div, ul, ol, nav, section, span"));
          let best = null;
          for (const el of cands) {
            if (el.closest && el.closest("table")) continue;
            const kids = Array.from(el.children || []);
            if (kids.length < 2 || kids.length > 40) continue;
            const nums = kids.filter((k) => numOf(k) > 0 && vis(k));
            if (nums.length < 2) continue;
            const uniq = [];
            nums.forEach((k) => { const n = numOf(k); if (uniq.indexOf(n) === -1) uniq.push(n); });
            if (uniq.length < 2) continue;
            const cc = String(el.className || "") + " " + String((el.parentElement && el.parentElement.className) || "");
            const bonus = /pag|pager|page|PGT/i.test(cc) ? 20 : 0;
            const score = bonus + uniq.length * 4 + nums.length - kids.length;
            if (!best || score > best.score) best = { el, nums, uniq, score };
          }
          const body = String((document.body && document.body.innerText) || "").replace(/\s+/g, " ");
          const cnt = body.match(/共\s*(?:有)?\s*[\d,]+\s*条[\s\S]{0,24}/);
          if (best) {
            const act = best.nums.filter((k) => {
              const c = String(k.className || "");
              return /(^|[^a-z])(active|current|selected|checked)([^a-z]|$)/i.test(c) ||
                (k.getAttribute && k.getAttribute("aria-current") === "page");
            })[0];
            pager = {
              containerTag: (best.el.tagName || ""),
              containerClass: String(best.el.className || "").slice(0, 120),
              pages: best.uniq.slice(0, 60),
              current: act ? numOf(act) : 0,
              currentClass: act ? String(act.className || "").slice(0, 80) : "",
              countText: cnt ? cnt[0].trim() : "",
            };
          } else {
            pager = { found: false, countText: cnt ? cnt[0].trim() : "" };
          }
        } catch (e) { pager = { err: String(e && e.message || e) }; }
        // 翻页候选探针（v2.8）：把「抓取全部页」实际会尝试点哪些元素、点不点得动全打出来。
        // 万一翻页仍失败，回传这一段就能精确定位：是「认错了元素」还是「元素被遮挡/不可点」。
        let pagerClick = null;
        try {
          const P = window.__IH_PAGE;
          if (!P || typeof P.pagerCandidates !== "function") {
            pagerClick = { injected: false, hasPage: !!P };
          } else {
            const info = P.pagerInfo ? P.pagerInfo() : null;
            const target = info && info.cur ? info.cur + 1 : 2;
            const cs = P.pagerCandidates(target);
            pagerClick = {
              injected: true,
              target: target,
              count: cs.length,
              cands: cs.slice(0, 12).map((c) => {
                const el = c.el;
                let rect = null, hitTag = "", hitClass = "";
                try {
                  const r = el.getBoundingClientRect();
                  rect = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
                  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                  if (top) { hitTag = top.tagName || ""; hitClass = String(top.className || "").slice(0, 60); }
                } catch (e) { /* 忽略 */ }
                return {
                  sel: c.sel,
                  tag: el.tagName || "",
                  cls: String(el.className || "").slice(0, 80),
                  text: String(el.innerText || "").replace(/\s+/g, " ").slice(0, 24),
                  rect: rect,
                  clickable: (typeof P.elClickable === "function") ? P.elClickable(el) : null,
                  topAtCenter: hitTag ? (hitTag + "." + hitClass) : "",
                };
              }),
            };
          }
        } catch (e) { pagerClick = { err: String(e && e.message || e) }; }
        // v2.9 分页器结构 dump：把「三级定位到底认到了哪一层、那一层的 HTML、页码、箭头候选」
        // 全部打出来。翻页再失败时回传这一段，就能直接改选择器，不用再猜。
        let pagerDump = null;
        try {
          const P2 = window.__IH_PAGE;
          pagerDump = (P2 && typeof P2.pagerDump === "function") ? P2.pagerDump() : { injected: false, hasPage: !!P2 };
        } catch (e) { pagerDump = { err: String(e && e.message || e) }; }
        return { url: location.href, title: document.title, pager, pagerClick, pagerDump, outerLogi, logiProbe, tables };
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

// 1688 诊断：复用页面内 diagnose1688()（含分页器 / 订单容器 / 运单号是否在行内 / 导出接口网络探针）
function injectAllFrames(tabId) {
  return new Promise((resolve) => {
    chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["pagefuncs.js"] }, () => resolve());
  });
}
function runAllFrames(tabId, func) {
  return new Promise((resolve) => {
    chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func }, (res) => resolve(res || []));
  });
}
// 定点在某一个 frame 里执行（拿到真正含导出控件的帧后再执行，避免在跨域桥接帧里空转）。
// v3.3.1 关键修复：executeScript 的 func 是序列化后注入页面的，**闭包变量不会带过去**——
// 之前 export1688 在 func 里引用外层 mode 变量，页面里 mode=undefined 直接抛错（点了没反应）。
// 参数必须走 executeScript 的 args 通道。
function runFrame(tabId, frameId, func, args) {
  return new Promise((resolve) => {
    const opts = { target: { tabId, frameIds: [frameId] }, func };
    if (args && args.length) opts.args = args;
    chrome.scripting.executeScript(opts, (res) => resolve(res || []));
  });
}
// 读页面内脚本版本（判断"页面里跑的是不是当前版本"，需 F5 才会更新）
async function readPageVers(tabId) {
  try {
    const res = await runAllFrames(tabId, () => (window.__IH_PAGE && window.__IH_PAGE.ver) || window.__IH_PAGE_VER || null);
    const vers = (Array.isArray(res) ? res : [res]).map((r) => r && r.result).filter(Boolean);
    return Array.from(new Set(vers));
  } catch (e) { return []; }
}
// 版本徽标：把「扩展内存里的版本」与「页面内注入脚本的版本」都摊开，
// 避免再次出现"改了代码但浏览器跑的是旧构建、双方各说各话"的排查黑洞。
async function renderVersionBadge() {
  const el = $("hd-ver");
  if (!el) return;
  let extVer = "?";
  try { extVer = chrome.runtime.getManifest().version; } catch (e) { /* 忽略 */ }
  const tab = await activeTab();
  let pageVers = [];
  if (tab) pageVers = await readPageVers(tab.id);
  const pageOk = pageVers.length > 0;
  const same = pageOk && pageVers.every((v) => v === extVer);
  el.innerHTML = `扩展 v${extVer}<br><span class="${same ? "ok" : "bad"}">页面 v${pageOk ? pageVers.join("/") : "未加载"}</span>`;
  el.title = same
    ? `扩展与页面脚本都是 v${extVer}，环境正常`
    : `扩展 v${extVer} / 页面 v${pageOk ? pageVers.join("/") : "未注入"}。不一致请：① edge://extensions 点插件卡片的「重新加载」；② 回到 1688 页按 F5。扩展位若显示旧版本，说明插件从未重新加载过，我改的代码不会生效。`;
  return { extVer, pageVers, same };
}
// 把帧候选逐条打进日志（「未找到订单帧」失败路径共用）
function logFrameTable(cands) {
  (cands || []).forEach((c, i) => {
    log(`#${i + 1} 帧号${c.frameId} 分值=${c.score} 正文=${c.bodyLen || 0}字 ShadowRoot=${c.shadowCount || 0} ${c.isTop ? "[顶层]" : "[子帧]"}`, (c.score || 0) > 0 ? "ok" : "warn");
    log(`    URL：${c.url || c.rawUrl || "(空)"}`, "info");
    log(`    标题：${c.title || "(无标题)"}`, "info");
    log(`    证据：${(c.ev || []).join(" / ") || "(无)"}`, "info");
    log(`    可见控件：${(c.btns && c.btns.length) ? c.btns.join(" │ ") : "(无任何可点控件文案)"}`, "info");
  });
}
// 1688 订单帧识别（v3.0.12）：**不能靠 URL 正则**——g.alicdn.com/platform/xdomain-storage/frame.html
// 这类跨域桥接帧的 hash 里 URL 编码携带了 buyer-order-list.html，会被误判成订单帧（其内没有任何控件）。
// 改为按「DOM 里是否真的有订单导出控件」打分，桥接帧直接判负分。
function probe1688Frames(tabId) {
  return runAllFrames(tabId, () => {
    const T = (e) => ((e.innerText || e.textContent || e.getAttribute("title") || e.getAttribute("aria-label") || e.value || "").toString().replace(/\s+/g, " ").trim());
    // ★ 穿透 Shadow DOM（v3.0.14）：1688 订单列表把 UI 渲染在 shadow root 里，
    //   innerText/querySelectorAll 默认读不到 → body 只剩 1 个字符、按钮全空、被误判为「空壳帧」。
    const roots = (function collect(root, acc) {
      acc.push(root);
      try { root.querySelectorAll("*").forEach((el) => { if (el.shadowRoot) collect(el.shadowRoot, acc); }); }
      catch (e) { /* 忽略 */ }
      return acc;
    })(document, []);
    const shadowCount = roots.length - 1;
    const deepAll = (sel) => { const out = []; roots.forEach((r) => { try { r.querySelectorAll(sel).forEach((e) => out.push(e)); } catch (e) { /* 忽略 */ } }); return out; };
    let body = String((document.body && document.body.innerText) || "");
    roots.forEach((r) => { if (r !== document) { try { body += " " + String(r.textContent || ""); } catch (e) { /* 忽略 */ } } });
    body = body.replace(/\s+/g, " ");
    const url = location.href;
    const isBridge = /xdomain-storage/i.test(url) || /^https?:\/\/g\.alicdn\.com\//i.test(url);
    let score = 0;
    const ev = [];
    // ① 最硬证据：DOM（含 shadow）里真的有导出/订单控件
    if (/导出所选订单|导出当前条件|导出全部|导出当前页|批量导出/.test(body)) { score += 120; ev.push("导出按钮"); }
    else if (/导出/.test(body)) { score += 15; ev.push("导出字样"); }
    if (/全选/.test(body)) { score += 25; ev.push("全选"); }
    if (/批量付款|待发货|待收货/.test(body)) { score += 15; ev.push("订单工具栏"); }
    // ② 标题精确命中「已买到的货品」——这是订单列表帧的强特征（桥接帧无标题）
    if (/已买到的货品/.test(document.title)) { score += 60; ev.push("标题=已买到的货品"); }
    if (/air\.1688\.com/.test(url) && /(buyer-order-list|trade-order-list)/.test(url)) { score += 50; ev.push("URL=air订单列表"); }
    if (/待发货|待收货|售后|订单编号|卖家公司名/.test(body)) { score += 15; ev.push("订单字样"); }
    if (deepAll("input[type=checkbox]").length > 2) { score += 10; ev.push("多选框"); }
    const t = deepAll("table").length;
    if (t) { score += 5; ev.push("table*" + t); }
    if (isBridge) { score -= 1000; ev.push("跨域桥接帧·排除"); }
    if (shadowCount) { ev.push("ShadowRoot*" + shadowCount); }
    // 正文过短：只有「穿透 shadow 后依然很短」才扣分（原来是误伤了 shadow 帧）
    if (body.length < 50 && !shadowCount) { score -= 60; ev.push("正文过短"); }
    else if (body.length < 50) { score -= 5; ev.push("正文偏短"); }
    let frameUrl = url;
    try {
      const m = url.match(/#%7B|#\{/);
      if (m) { frameUrl = decodeURIComponent(url.slice(url.indexOf("#") + 1)).slice(0, 160); }
    } catch (e) { /* 忽略 */ }
    // 可见按钮/可点元素文案清点（含 shadow）
    let btns = [];
    try {
      btns = deepAll("button,a,[role=button],span,li,label,div")
        .filter((e) => { try { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; } catch (x) { return false; } })
        .map(T).filter((t) => t && t.length <= 16)
        .filter((t, i, a) => a.indexOf(t) === i).slice(0, 40);
    } catch (e) { /* 忽略 */ }
    return { score, url: frameUrl.slice(0, 160), rawUrl: url.slice(0, 120), title: document.title, ev, btns, shadowCount, bodyLen: body.length, isTop: window === window.top };
  }).then((res) => {
    const list = (Array.isArray(res) ? res : [res]).map((r) => Object.assign({ frameId: r && r.frameId }, (r && r.result) || {}));
    list.sort((a, b) => (b.score || 0) - (a.score || 0));
    return list;
  });
}
// 1688 诊断：订单列表极可能在 iframe 子应用里，故向「所有 frame」注入并逐帧上报，
// 再聚合出「命中的订单帧」与顶层帧（含所有 iframe 的 src），据此定稿自动抓取逻辑。
function copyDiag1688() {
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || !tab.url || tab.url.indexOf("http") !== 0) {
      log("请先打开 1688 订单页面再诊断", "warn");
      return;
    }
    log("正在向所有 iframe 注入诊断（订单列表可能所在的子框架一并覆盖）…", "ok");
    await injectAllFrames(tab.id);
    const results = await runAllFrames(tab.id, () =>
      (window.__IH_PAGE && window.__IH_PAGE.diagnose1688) ? window.__IH_PAGE.diagnose1688() : { err: "diagnose1688 未注入" });
    const frames = (Array.isArray(results) ? results : [results])
      .map((r) => (r && r.result) ? r.result : (r || {}))
      .filter((x) => x && Object.keys(x).length);
    const topFrame = frames.find((f) => f.isTop) || frames[0] || {};
    const orderFrame = frames.find((f) => f.hasOrderContent) || null;
    const of = orderFrame || topFrame;
    // downloads 优先取诊断时 chrome.downloads 直查结果（最可靠），否则回退后台 storage
    let downloads = (orderFrame && orderFrame.downloads && orderFrame.downloads.length)
      ? orderFrame.downloads
      : (topFrame.downloads && topFrame.downloads.length ? topFrame.downloads : []);
    if (!downloads.length) {
      try { const d = await new Promise((res) => chrome.storage.local.get({ __ih_downloads: [] }, (x) => res(x))); downloads = d.__ih_downloads || []; } catch (e) { downloads = []; }
    }
    const a1688Count = (orderFrame && orderFrame.a1688Count != null) ? orderFrame.a1688Count
      : ((topFrame && topFrame.a1688Count != null) ? topFrame.a1688Count : 0);
    const report = {
      ts: Date.now(),
      tabUrl: tab.url,
      frameCount: frames.length,
      summary: {
        orderFrameFound: !!orderFrame,
        orderFrameUrl: orderFrame ? orderFrame.frameUrl : null,
        inlineFields: orderFrame ? orderFrame.inlineFields : (topFrame.inlineFields || null),
        netCapturedCount: of.netCaptured ? of.netCaptured.length : 0,
        exportApiCaptured: !!(of.exportApi && of.exportApi.url),
        xlsxCaptured: !!(of.xlsxCaptured && of.xlsxCaptured.url),
        a1688Parsed: a1688Count,
      },
      exportApi: of.exportApi || null,
      xlsxCaptured: of.xlsxCaptured || null,
      downloads: downloads,
      topFrame: topFrame,
      orderFrame: orderFrame,
      allFrames: frames,
    };
    const text = JSON.stringify(report, null, 2);
    const done = () => log(orderFrame
      ? "1688 诊断已复制：已在订单帧 " + orderFrame.frameUrl + " 找到订单内容（含分页器/字段/导出探针）"
      : "1688 诊断已复制：所有帧均未直接发现订单内容，请看 topFrame.iframes / allFrames 定位列表所在 iframe", "ok");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => prompt("剪贴板不可用，请手动复制：", text));
    } else {
      prompt("请手动复制诊断信息：", text);
    }
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
  $("btn-export-a1688").addEventListener("click", exportA1688);
  $("btn-exp-sel").addEventListener("click", () => export1688("selected"));
  $("btn-exp-cond").addEventListener("click", () => export1688("condition"));
  $("btn-clear-a1688").addEventListener("click", clearA1688);
  // 在独立标签页打开匹配工具（popup 里弹文件选择框会关闭 popup 导致 change 事件丢失，标签页则完全稳定）
  $("btn-match-pdd").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("matcher.html") });
  });
  // 1688 / 拼多多 已解析计数（后台捕获下载后自动解析入库）
  refreshA1688Count();
  refreshPddCount();
  $("btn-stop").addEventListener("click", async () => {
    const tab = await activeTab();
    if (!tab) return;
    await requestStop(tab.id);
    log("已请求停止（抓完当前页后结束，已抓到的页已入库）", "warn");
    $("status").textContent = "正在停止…";
  });
  refreshLibCount();
  log("就绪。1688 → 切到 1688 专区手动「导出当前条件」自动入库；拼多多/其他平台 → 「抓取本页/抓取全部页」或导出文件自动入库；最后点「开票工作台」匹配开票。");
  // 版本徽标 + 一致性自检（最常见的"改了没生效"根因：扩展没重新加载 / 页面没刷新）
  (async () => {
    const v = await renderVersionBadge();
    if (!v) return;
    if (!v.pageVers.length) {
      log(`⚠️ 页面里没有检测到本扩展的脚本（页面侧 v未加载）。请对目标页面按 F5 刷新一次`, "warn");
    } else if (!v.same) {
      log(`⚠️ 版本不一致：扩展 v${v.extVer} / 页面 v${v.pageVers.join("/")}——页面里跑的是旧脚本，请按 F5 刷新页面`, "warn");
    }
    if (v.extVer !== PAGE_VER) {
      log(`⚠️ 严重：扩展内存里是 v${v.extVer}，但代码已是 v${PAGE_VER}——说明扩展长时间未「重新加载」，我改的代码一行都没生效。请到 edge://extensions（或 chrome://extensions）点本插件卡片上的「重新加载 ↻」，然后回页面按 F5`, "err");
    }
  })();
  // 弹窗重开时探测页面内是否还有任务在跑（弹窗可以关掉，任务在网页里继续）
  (async () => {
    const tab = await activeTab();
    if (!tab) return;
    const st = await readGrabState(tab.id, 0, false);
    if (!st) return;
    if (st.running) {
      $("status").textContent = `页面内抓取任务运行中：第 ${st.curPage || st.page}${st.totalPages ? "/" + st.totalPages : ""} 页…`;
      $("btn-stop").hidden = false;
      log(`检测到页面内抓取任务仍在运行（第 ${st.curPage || st.page} 页）——点「抓取全部页」可接管并继续入库，「停止抓取」可中止`, "warn");
      if (st.ver !== PAGE_VER) {
        log(`⚠️ 但它是旧版本 v${st.ver || "未知"} 注入的循环（当前 v${PAGE_VER}）：点「抓取全部页」会先停掉它再起新版；想彻底干净就按 F5 刷新页面`, "warn");
      }
    } else if (st.done && st.total > st.mergedPage) {
      log(`页面内有 ${st.total - st.mergedPage} 页抓取结果尚未入库——点「抓取全部页」补入库`, "warn");
    }
  })();
  // v3.3.2：1688 平台实时轮询勾选状态——用户在页面勾选/取消勾选后，「导出所选订单」按钮在 ≤2.5s 内自动同步亮灰，
  // 避免「打开弹窗时探测一次、之后一直是陈旧状态」导致按钮卡在灰色（即使页面按钮已变亮）。
  const poll1688Sel = () => { if ($("platform") && $("platform").value === "1688") refresh1688SelState(); };
  window.__ih1688Timer = setInterval(poll1688Sel, 2500);
  window.addEventListener("focus", poll1688Sel);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) poll1688Sel(); });
});
