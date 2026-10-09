// draft.js —— 代发解析内核（单一权威来源）
//
// 历史包袱：本文件曾是 pdd-invoice-grabber/dropship_draft.js 的副本，
// 导致「桌面/手机版修了解析、机器人漏改」的双份维护陷阱。
// 现改为一行 re-export，直接复用父目录的权威内核，消除漂移风险。
//
// 权威来源：../dropship_draft.js（UMD，浏览器全局 IH_DROPSHIP 与 Node module.exports 通用）
//   相对路径：dropship-bot/src/draft.js → ../../dropship_draft.js
module.exports = require("../../dropship_draft.js");
