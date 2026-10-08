// dropship_panel.js —— 代发采购草稿工作台逻辑（独立扩展页，类比 matcher.js）
// 流程：扫描 PDD 活动标签 → 按需注入 pagefuncs.js → 调用 window.__IH_PDD_ORDERS → IH_DROPSHIP.buildDrafts → 渲染卡片
// P0-2 新增：卡片「自动搜同款并填收货」→ 打开 1688 搜索页 + 写入 chrome.storage.session.dsTask，
//           由 1688 各页面 content script 的 __IH_DS_AUTO 按 URL 阶段自动续跑（点商品→选规格→填收货）。
//           另提供「在1688页诊断」按钮：调用 __IH_1688_DIAG 回显当前页面元素快照，便于实测精修选择器。
(function () {
  "use strict";
  const D = window.IH_DROPSHIP;
  const list = document.getElementById("list");
  const paste = document.getElementById("paste");
  const tasklog = document.getElementById("tasklog");
  let drafts = [];

  function render(ds) {
    drafts = ds || [];
    if (!drafts.length) {
      list.innerHTML = '<div class="empty">没有解析到订单。请确认在 PDD 后台打开了订单列表页。</div>';
      return;
    }
    list.innerHTML = "";
    drafts.forEach((d, i) => {
      const div = document.createElement("div");
      div.className = "card" + (d.flags.needPhone ? " warn" : "");
      const phoneTag = d.recipient.phone
        ? '<span class="tag ok">虚拟号✓</span>'
        : '<span class="tag bad">缺号码</span>';
      const extTag = d.recipient.ext
        ? '<span class="tag ok">分机[' + d.recipient.ext + ']</span>'
        : '<span class="tag bad">缺分机</span>';
      const profit = d.profit.profit == null
        ? '<span class="tag bad">利润待算</span>'
        : '<span class="v">¥' + d.profit.profit + '</span>';
      div.innerHTML =
        '<div class="row"><span class="k">订单号</span><span class="v">' + (d.orderId || "—") + '</span></div>' +
        '<div class="row"><span class="k">商品</span><span class="v">' + (d.item || "—") + '</span></div>' +
        '<div class="row"><span class="k">规格</span><span class="v">' + (d.spec.norm || "—") + '</span></div>' +
        '<div class="row"><span class="k">数量/实付</span><span class="v">' + d.qty + ' / ¥' + d.pddPaid + '</span></div>' +
        '<div class="row"><span class="k">收货人</span><span class="v">' + (d.recipient.name || "—") + extTag + '</span></div>' +
        '<div class="row"><span class="k">虚拟号</span><span class="v">' + (d.recipient.phone || "—") + phoneTag + '</span></div>' +
        '<div class="row"><span class="k">地址</span><span class="v">' + (d.recipient.address || "—") + '</span></div>' +
        '<div class="row"><span class="k">预估利润</span>' + profit + '</div>' +
        '<div class="acts">' +
        '<button class="act act-buy" data-idx="' + i + '">自动搜同款并填收货</button>' +
        '<a class="act link" href="' + d.searchUrl + '" target="_blank" rel="noopener">仅看搜索结果 →</a>' +
        '</div>';
      list.appendChild(div);
    });
  }

  // 卡片按钮委托：点击「自动搜同款并填收货」
  list.addEventListener("click", async (ev) => {
    const btn = ev.target.closest(".act-buy");
    if (btn) {
      const idx = parseInt(btn.getAttribute("data-idx"), 10);
      await auto1688(drafts[idx]);
    }
  });

  // 打开 1688 搜索页 + 写入自动任务；由 content script 在 1688 各页自动续跑
  async function auto1688(draft) {
    if (!draft || !draft.searchUrl) { alert("草稿缺少搜索链接"); return; }
    // 收货信息缺失（缺主号/分机）→ 仍可打开，但提示人工补；不阻塞 PDD 虚拟号已实测完整时一般齐全
    if (draft.flags.needPhone) {
      const go = confirm("该订单收货信息不完整（缺主号或分机）。仍打开 1688 自动流程？\n建议先确认 PDD 列表页虚拟号已完整渲染。");
      if (!go) return;
    }
    const tab = await chrome.tabs.create({ url: draft.searchUrl, active: true });
    await chrome.storage.session.set({ dsTask: {
      addr: draft.recipient,
      keywords: draft.keywords,
      step: "init",
      tabId: tab.id,
      log: ["[任务] 已打开 1688 搜索页：" + draft.searchUrl],
      createdAt: Date.now(),
    } });
    tasklog.style.display = "block";
    pollTask();
  }

  // 轮询显示自动任务进度（storage.session.dsTask.log）
  function pollTask() {
    clearTimeout(pollTask._t);
    chrome.storage.session.get(["dsTask"], (res) => {
      const t = res && res.dsTask;
      if (!t) { tasklog.innerHTML = "无进行中任务。"; return; }
      const done = (t.step === "done" || t.step === "error");
      tasklog.innerHTML = "<b>自动任务状态：" + t.step + "</b><br/>" + (t.log || []).map((x) => "· " + x).join("<br/>") +
        (done ? "<br/><b>" + (t.step === "done" ? "✅ 自动流程结束：请人工在 1688 确认下单/付款" : "❌ 流程中断：请按日志在 1688 人工处理") + "</b>" : "");
      if (!done) pollTask._t = setTimeout(pollTask, 1500);
    });
  }

  // 在 1688 活动标签调 __IH_1688_DIAG，回显当前页面元素探测快照（实测精修选择器用）
  async function diag1688() {
    const tabs = await chrome.tabs.query({ url: "*://*.1688.com/*" });
    const tab = tabs.find((t) => /trade\.1688\.com|offer|1688\.com/.test(t.url || "")) || tabs[0];
    if (!tab) { alert("请先在活动标签打开 1688 页面（确认订单页最佳）"); return; }
    const r = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => (window.__IH_1688_DIAG ? window.__IH_1688_DIAG() : { err: "函数未注入，请刷新 1688 页" }),
    });
    const snap = r && r[0] && r[0].result;
    tasklog.style.display = "block";
    tasklog.innerHTML = "<b>1688 页面诊断快照：</b><br/><pre>" + JSON.stringify(snap, null, 2) + "</pre>";
  }

  async function scanTab() {
    list.innerHTML = '<div class="empty">扫描中…</div>';
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) { list.innerHTML = '<div class="empty">未找到活动标签页。</div>'; return; }
      if (!/pinduoduo\.com/i.test(tab.url || "")) {
        list.innerHTML = '<div class="empty">当前页不是拼多多后台（' + (tab.url || "") + '）。请先打开 PDD 订单列表页。</div>';
        return;
      }
      // 按需注入 pagefuncs.js（PDD 页默认未注入），再调用探测函数
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["pagefuncs.js"] });
      const res = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => (window.__IH_PDD_ORDERS ? window.__IH_PDD_ORDERS() : { ok: false, orders: [], errors: ["函数未注入"] }),
      });
      const out = res && res[0] && res[0].result;
      if (!out || !out.ok) {
        list.innerHTML = '<div class="empty">扫描失败：' + ((out && out.errors && out.errors.join(";")) || "未知") + '</div>';
        return;
      }
      render(D.buildDrafts(out.orders));
    } catch (e) {
      list.innerHTML = '<div class="empty">错误：' + (e && e.message || e) + '</div>';
    }
  }

  function scanPaste() {
    const text = (paste.value || "").trim();
    if (!text) { list.innerHTML = '<div class="empty">请先粘贴订单收货信息文本。</div>'; return; }
    render(D.buildDrafts([{ recipientText: text }]));
  }

  document.getElementById("scan").addEventListener("click", scanTab);
  document.getElementById("scanManual").addEventListener("click", scanPaste);
  document.getElementById("clear").addEventListener("click", () => {
    list.innerHTML = '<div class="empty">已清空。</div>';
    paste.value = "";
    drafts = [];
  });
  document.getElementById("diag").addEventListener("click", diag1688);
})();
