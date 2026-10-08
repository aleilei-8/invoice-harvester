// dropship_panel.js —— 代发采购草稿工作台逻辑（独立扩展页，类比 matcher.js）
// 流程：扫描 PDD 活动标签 → 按需注入 pagefuncs.js → 调用 window.__IH_PDD_ORDERS → IH_DROPSHIP.buildDrafts → 渲染卡片
(function () {
  "use strict";
  const D = window.IH_DROPSHIP;
  const list = document.getElementById("list");
  const paste = document.getElementById("paste");

  function render(drafts) {
    if (!drafts || !drafts.length) {
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
        '<a class="act" href="' + d.searchUrl + '" target="_blank" rel="noopener">去 1688 搜同款 →</a>';
      list.appendChild(div);
    });
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
    // 粘贴模式：把整段文本当一条订单的 recipientText，其余留空待补
    render(D.buildDrafts([{ recipientText: text }]));
  }

  document.getElementById("scan").addEventListener("click", scanTab);
  document.getElementById("scanManual").addEventListener("click", scanPaste);
  document.getElementById("clear").addEventListener("click", () => {
    list.innerHTML = '<div class="empty">已清空。</div>';
    paste.value = "";
  });
})();
