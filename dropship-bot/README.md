# dropship-bot · 常驻代发机器人（方案 A）

白天上班、订单走手机 1688 App 下单再回填 PDD 的自动化解法。
把"大脑"（解析虚拟号、建采购单、回填物流）放到一台 24h 运行的机器上，
**手机只做"打开采购单→付款"这一下**，彻底告别坐在电脑前。

---

## 核心原则（死规矩）
- **绝不自动付款 / 自动提交。** 付款由你本人在手机点。
- **物流回填默认不自动发货**：抓到 1688 物流号后只通知你"已揽收，待确认"；仅当显式 `--auto-ship` + 已配 PDD 凭证，才真正回传 PDD 发货。安全第一。
- 所有解析逻辑与桌面插件 `dropship_draft.js` 同源，已在 `test/sign.test.js` / `test/reconcile.test.js` 单测覆盖。

---

## 工作原理（关键技巧）
1688 的**采购单是跨端同步的**：同一个账号，机器人（无头浏览器）在 web 端建的采购单，
你手机 1688 App 里直接能看到。所以机器人不需要替你付款——它只负责"建单+填虚拟号收货"，
你手机打开就是待付款状态，点一下即可。付款后物流单号再回填 PDD。

```
PDD 新订单 ──(PDD开放平台API)──▶ 机器人
                                      │ 解析虚拟号(主号+分机)
                                      │ 1688 建采购单(填收货,不付款) ← Playwright 同账号
                                      ▼
                              通知(微信/钉钉,带采购单链接)
                                      │
                              你手机打开采购单 → 付款
                                      │
                              (回填阶段)机器人抓物流单号
                                      │
                                      ▼
                              PDD 发货 API 回传物流
```

---

## 目录
```
dropship-bot/
├── src/
│   ├── draft.js        # 解析内核（虚拟号/收货/规格/搜索URL/利润，UMD 复用）
│   ├── pdd.js          # PDD 开放平台客户端（拉订单 + 回传物流，含 MD5 签名 + 物流公司编码映射）
│   ├── agent1688.js    # Playwright 建 1688 采购单并填虚拟号收货 + 抓物流单号（懒加载）
│   ├── notifier.js     # 微信/钉钉/Server酱 通知
│   ├── store.js        # 轻量 JSON 状态库（PDD 订单↔1688 采购单↔物流号 映射）
│   ├── reconcile.js    # 物流回填阶段（抓 1688 物流 → 回传 PDD 发货）
│   └── run.js          # 主循环（支持 --dry-run / --reconcile / --auto-ship）
├── test/sign.test.js       # 签名 + 解析内核单测
├── test/reconcile.test.js  # 物流回填阶段单测（注入假依赖，零网络）
├── .env.example
└── package.json
```

---

## 快速验证（无需任何凭证）
```bash
node test/sign.test.js        # 签名 + 解析内核单测（9 项）
node test/reconcile.test.js   # 物流回填阶段单测（12 项，含安全默认/auto-ship/未发货跳过）
node src/run.js --dry-run     # 用内置样本跑通 解析→建单(跳过)→落库 链路
node src/run.js --reconcile --dry-run   # 模拟抓物流→通知(不自动发货) 链路
```

---

## 正式运行前提
1. **PDD 开放平台应用**：https://open.pinduoduo.com → 创建应用，拿到 `PDD_CLIENT_ID` / `PDD_CLIENT_SECRET`。
2. **1688 登录态**：首次用 `P1688_PROFILE_DIR` 指定目录手动登录一次 1688（与手机同账号），之后复用。
3. **通知 webhook**：Server酱 / 企业微信 / 钉钉 机器人 URL。

复制 `.env.example` 为 `.env` 填好，然后：
```bash
npm install            # 安装 playwright
npx playwright install chromium
node src/run.js        # 常驻运行（可加 nohup / pm2 / 系统服务）
```

---

## 运行模式
- `--dry-run`：用样本数据验证解析与通知链路，不碰网络/凭证。
- `--reconcile`：物流回填阶段。扫描状态库中"已建采购单"的订单，抓 1688 物流单号。
  - 默认**只通知、不自动发货**（安全）。
  - 加 `--auto-ship` 且在 `.env` 配好 PDD 凭证，则**抓到物流号后自动回传 PDD 发货**。
- 常驻：建议用 `pm2 start src/run.js` 跑主流程常驻；另起一个定时任务（cron / pm2 定时）周期性跑 `node src/run.js --reconcile`，按 `POLL_INTERVAL` 频率回填。

### 典型一天
1. 早晨/空闲：`node src/run.js`（拉新订单 → 建 1688 采购单 → 微信通知你"待付款"）。
2. 白天手机：打开 1688 App → 点采购单 → 付款 → 卖家发货。
3. 后台定时：`node src/run.js --reconcile`（或 `--auto-ship`）→ 自动抓物流 → 通知/回填 PDD。

---

## 状态机（store.json）
```
po_created ──(reconcile 抓到物流)──▶ tracked ──(auto-ship 或人工确认)──▶ delivered
```
- `tracked` 状态不再重复处理，避免重复通知/重复发货。
- 未发货（1688 还没揽收）→ `skipped`，下次 reconcile 再试。

---

## 边界与待办（需你本机实测精修）
- `agent1688.js` 的选择器为基于典型结构的启发式，与桌面扩展同策略；首次实跑可能需按真实页面微调（用桌面插件面板的"诊断"快照对照）。特别是 `getTracking` 的承运商名/运单号提取，建议实跑后用真实页面 HTML 校准。
- `pdd.js` 的 `EXP_MAP`（物流公司→PDD logistics_id）仅含常见承运商，缺失时该订单会回传失败，需按需扩充。
- 1688 登录态有过期风险，需加健康检测与重登提醒。
- `state.json` 含订单映射，建议加入 `.gitignore`，勿提交凭证/订单数据。
