# 部署「代发助手手机版」到 GitHub Pages

仓库已内置工作流 `.github/workflows/deploy-pages.yml`，推送 `master` 后自动把 `dropship-web/`
发布到 GitHub Pages（站点的根就是这个手机工作台）。

## 你只需两步（在本机终端，已登录 GitHub）

1. 进入本仓库目录，执行：
   ```bash
   git push -u origin master
   ```
2. 打开 https://github.com/aleilei-8/invoice-harvester/settings/pages
   - Source 选择 **GitHub Actions**
   - 等待 1~2 分钟，Actions 跑完即上线

## 手机收藏链接（上线后）

```
https://aleilei-8.github.io/invoice-harvester/
```

> 手机浏览器打开后，iOS 可「分享 → 添加到主屏幕」，像 App 一样常驻。

## Vercel 备选（不要 GitHub 也行）

在 `dropship-web` 目录执行：
```bash
npx vercel --prod
```
按提示用 GitHub/邮箱登录一次即可，会得到 `https://xxx.vercel.app` 链接。

## 说明

- 解析逻辑全部在手机本地完成，订单信息不出本机。
- 本沙箱环境无 GitHub 写凭证，故由你本机推送（你已登录 GitHub，一行命令即可）。
