// notifier.js —— 轻量通知（Server 酱 / 企业微信 / 钉钉 webhook 通用）
"use strict";

async function send(url, { title, body }) {
  if (!url) return { skipped: true };
  // Server 酱：GET ?title=&desp=
  if (url.includes("sctapi.ftqq.com") || url.includes("sc.ftqq.com")) {
    const u = `${url}?title=${encodeURIComponent(title)}&desp=${encodeURIComponent(body)}`;
    const r = await fetch(u);
    return await r.json().catch(() => ({ ok: r.ok }));
  }
  // 企业微信/钉钉：POST { msgtype:"text", text:{ content } }
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ msgtype: "text", text: { content: `【${title}】\n${body}` } }),
  });
  return await r.json().catch(() => ({ ok: r.ok }));
}

module.exports = { send };
