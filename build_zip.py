#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把浏览器扩展打包成可分发的 zip（供其他卖家下载后「加载已解压的扩展程序」）。

用法：
    python build_zip.py                 # 默认输出 ecom-order-helper-chrome.zip
    python build_zip.py -o 我的插件.zip  # 指定输出名

只打包扩展运行必需文件，排除 .git / 缓存 / 临时文件 / Python 与文档等非前端资源。
"""
import os
import zipfile
import argparse

# 扩展运行必需的前端文件
INCLUDE = [
    "manifest.json",
    "popup.html",
    "popup.css",
    "lib.js",
    "pagefuncs.js",
    "xlsx.full.min.js",
    "popup.js",
    "matcher.html",
    "matcher.js",
    "background.js",
    "dropship_draft.js",
    "dropship_panel.html",
    "dropship_panel.js",
]

# 需要排除的目录 / 后缀（即便在扩展目录内也不打包）
EXCLUDE_DIRS = {".git", "__pycache__", "node_modules", ".workbuddy"}
EXCLUDE_SUFFIX = (".pyc", ".pyo", ".tmp", ".log", "~")


def build(ext_dir: str, out_name: str):
    ext_dir = os.path.abspath(ext_dir)
    if not os.path.isfile(os.path.join(ext_dir, "manifest.json")):
        raise SystemExit(f"未找到 manifest.json：{ext_dir} 不是扩展目录")

    missing = [f for f in INCLUDE if not os.path.isfile(os.path.join(ext_dir, f))]
    if missing:
        print(f"警告：以下必需文件缺失，将跳过：{missing}")

    out_path = os.path.join(ext_dir, out_name)
    written = []
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in INCLUDE:
            fp = os.path.join(ext_dir, name)
            if os.path.isfile(fp):
                zf.write(fp, arcname=name)
                written.append(name)
        # 顺带打包 README（让下载者知道怎么用），不强制
        readme = os.path.join(ext_dir, "README.md")
        if os.path.isfile(readme):
            zf.write(readme, arcname="README.md")
            written.append("README.md")
        # 使用说明（v3.3.0：说明文字已从弹窗移出，独立成文件）
        guide = os.path.join(ext_dir, "使用说明.txt")
        if os.path.isfile(guide):
            zf.write(guide, arcname="使用说明.txt")
            written.append("使用说明.txt")

    print(f"已生成：{out_path}")
    print(f"包含文件（{len(written)}）：" + "、".join(written))
    print(f"体积：{os.path.getsize(out_path) / 1024:.1f} KB")
    print("\n分发方式：把 zip 发给卖家 → 解压 → 浏览器「管理扩展程序」→ 开启开发者模式 → "
          "「加载已解压的扩展程序」→ 选择解压目录即可。")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="打包电商订单信息助手扩展")
    ap.add_argument("-d", "--dir", default=os.path.dirname(os.path.abspath(__file__)),
                    help="扩展目录（默认当前脚本所在目录）")
    ap.add_argument("-o", "--output", default="ecom-order-helper-chrome.zip",
                    help="输出 zip 文件名")
    args = ap.parse_args()
    build(args.dir, args.output)
