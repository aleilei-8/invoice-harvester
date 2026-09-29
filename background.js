// 轻量后台：初始化本地汇总库
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get("invoice_records", (data) => {
    if (!Array.isArray(data.invoice_records)) {
      chrome.storage.local.set({ invoice_records: [] });
    }
  });
});

// 接收 content 注入时回传的抓取结果（备用通道）
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "PING") {
    sendResponse({ ok: true });
  }
});
