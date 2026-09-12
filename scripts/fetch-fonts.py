#!/usr/bin/env python3
"""下载 Google Fonts 官方 woff2 分片到本地，并生成 src/tokens/fonts.css。

用法（在项目根目录）：
    python scripts/fetch-fonts.py

背景与取舍：
- 字体来源是 Google Fonts 官方 CSS API（不依赖任何第三方镜像），API 会按
  unicode-range 把字族切成若干语言分片，这里只落地界面真正需要的分片：
  latin / latin-ext / cyrillic / greek / vietnamese，中日韩字形交给
  Sarasa Gothic SC 兜底，避免把全量字库（数十 MB）打进安装包。
- `unicode-range` 原样保留官方切分，浏览器只下载文本真正用到的分片。
- 目标字族在 FAMILY / WEIGHTS / ITALIC 里改；换字体只需改这三处再跑一次。
"""

import os
import re
import subprocess
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ── 目标字族（M3 规范正文与标题字族：Roboto）─────────────────────────
FAMILY = "Roboto"
FAMILY_QUERY = "Roboto"  # API 查询用名（含空格的写法用 + 连接）
WEIGHTS = ["400", "500", "700"]
# 额外保留的字重斜体：正文偶有 <em>/<i>，浏览器合成斜体观感差
ITALIC_WEIGHTS = {"400"}
OUT_DIR_NAME = "roboto"

# 需要落地的语言分片（顺序即 @font-face 输出顺序，latin 必须在前）
SUBSETS = ["latin", "latin-ext", "cyrillic", "cyrillic-ext", "greek", "greek-ext", "vietnamese"]

OUT_FONT_DIR = os.path.join(ROOT, "src", "assets", "fonts", OUT_DIR_NAME)
OUT_CSS = os.path.join(ROOT, "src", "tokens", "fonts.css")

# 必须带浏览器 UA，否则 API 只返回老式 ttf 链接
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


def api_url() -> str:
    normal = ";".join(f"0,{w}" for w in WEIGHTS)
    italics = ";".join(f"1,{w}" for w in sorted(ITALIC_WEIGHTS))
    return (
        f"https://fonts.googleapis.com/css2?family={FAMILY_QUERY}"
        f":ital,wght@{normal}{';' + italics if italics else ''}&display=swap"
    )


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def parse(css: str):
    blocks = []
    for m in re.finditer(r"/\*\s*([a-z-]+)\s*\*/\s*@font-face\s*\{([^}]*)\}", css):
        subset, body = m.group(1), m.group(2)
        blocks.append(
            {
                "subset": subset,
                "style": re.search(r"font-style:\s*(\w+)", body).group(1),
                "weight": re.search(r"font-weight:\s*(\d+)", body).group(1),
                "url": re.search(r"url\((https://[^)]+)\)", body).group(1),
                "range": re.search(r"unicode-range:\s*([^;]+);", body).group(1).strip(),
            }
        )
    return blocks


def main() -> int:
    url = api_url()
    print(f"拉取官方 CSS API：{FAMILY}")
    blocks = parse(fetch(url).decode("utf-8"))
    if not blocks:
        print("解析失败：API 未返回 @font-face", file=sys.stderr)
        return 1

    os.makedirs(OUT_FONT_DIR, exist_ok=True)
    picked, total = [], 0
    for b in blocks:
        if b["subset"] not in SUBSETS:
            continue
        italic = b["style"] == "italic"
        if italic and b["weight"] not in ITALIC_WEIGHTS:
            continue
        b["file"] = f"{b['subset']}-{b['weight']}{'-italic' if italic else ''}.woff2"
        data = fetch(b["url"])
        with open(os.path.join(OUT_FONT_DIR, b["file"]), "wb") as f:
            f.write(data)
        total += len(data)
        picked.append({**b, "bytes": len(data)})

    if not picked:
        print("未匹配到任何分片，请检查 SUBSETS / WEIGHTS", file=sys.stderr)
        return 1

    picked.sort(key=lambda b: (int(b["weight"]), b["style"] == "italic", SUBSETS.index(b["subset"])))

    lines = [
        f"/* {FAMILY} —— Google Fonts 官方 woff2 分片，本地打包（OFL 授权）。",
        "   覆盖 latin / latin-ext / cyrillic / greek / vietnamese；",
        "   中日韩字形由 Sarasa Gothic SC 兜底，避免把全量字库打进安装包。",
        "   由 scripts/fetch-fonts.py 生成，勿手工调整 unicode-range。 */",
    ]
    for b in picked:
        lines += [
            "@font-face {",
            f'  font-family: "{FAMILY}";',
            f'  font-style: {"italic" if b["style"] == "italic" else "normal"};',
            f'  font-weight: {b["weight"]};',
            "  font-display: swap;",
            f'  src: url("../assets/fonts/{OUT_DIR_NAME}/{b["file"]}") format("woff2");',
            f'  unicode-range: {b["range"]};',
            "}",
        ]
    with open(OUT_CSS, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")

    # CI 会跑 `npm run format:check`（含 src/**/*.css），unicode-range 一行太长会被判
    # 格式不合规 → 生成后直接过一遍 prettier；没装就跳过，不影响产出。
    try:
        subprocess.run(
            ["npx", "prettier", "--write", os.path.relpath(OUT_CSS, ROOT)],
            cwd=ROOT,
            shell=os.name == "nt",  # Windows 上 npx 是 npx.cmd，必须走 shell
            check=False,
            capture_output=True,
        )
    except OSError:
        pass

    print(f"完成：{len(picked)} 个分片 / {total / 1024:.0f} KB")
    print(f"  {os.path.relpath(OUT_FONT_DIR, ROOT)}")
    print(f"  {os.path.relpath(OUT_CSS, ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
