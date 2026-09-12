#!/usr/bin/env python3
"""生成 M3 Expressive 弹簧缓动（CSS `linear()`），对应 Compose 的 MotionScheme.expressive()。

用法：python scripts/gen-spring-easings.py  → 打印可直接粘进 theme.css 的变量块

原理：Compose 的 expressive 方案是两组弹簧——
- spatial（位移/尺寸/旋转）：dampingRatio = 0.8、stiffness = MediumLow(400)
  → 欠阻尼，约 1.5% 的轻微回弹（「轻微弹一下」的来源）
- effects（颜色/透明度/阴影）：dampingRatio = 1.0、stiffness = MediumLow(400)
  → 临界阻尼，不回弹，避免颜色过渡出现脏色抖动
另各有一个 fast 档位（stiffness = Medium 1500）用于小幅、快速的交互反馈。

采样：把阻尼振子的位移响应 x(t) 在「稳定时间」内均匀采 N 点，输出等距的
`linear(...)` 缓动；末点强制为 1，保证任意 duration 下压缩播放都能落到终点。
"""

import math

N = 32  # 采样点数（等距，CSS 可省略百分比）
SETTLE_TOL = 0.001  # 稳定判据：|x-1| < 0.1%


def spring(t: float, damping: float, stiffness: float) -> float:
    """单位质量弹簧的位移响应 x(t)，初值 x(0)=0、x'(0)=0，终值 1。"""
    w0 = math.sqrt(stiffness)
    if damping >= 1.0:  # 临界/过阻尼
        return 1 - math.exp(-w0 * t) * (1 + w0 * t)
    wd = w0 * math.sqrt(1 - damping * damping)
    return 1 - math.exp(-damping * w0 * t) * (
        math.cos(wd * t) + (damping * w0 / wd) * math.sin(wd * t)
    )


def settle_time(damping: float, stiffness: float) -> float:
    t = 0.0
    while t < 5.0:
        if abs(spring(t, damping, stiffness) - 1) < SETTLE_TOL:
            # 连续采样确认已停在容差内（跳过中间过零点）
            if all(
                abs(spring(t + k * 0.01, damping, stiffness) - 1) < SETTLE_TOL
                for k in range(1, 6)
            ):
                return t
        t += 0.002
    return 1.0


def easing(damping: float, stiffness: float) -> tuple[str, float, float]:
    dur = settle_time(damping, stiffness)
    pts = [spring(dur * i / (N - 1), damping, stiffness) for i in range(N)]
    pts[-1] = 1.0  # 强制终点，避免浮点残差
    peak = max(pts)
    body = ", ".join(f"{p:.4f}".rstrip("0").rstrip(".") if p not in (0, 1) else f"{p:g}" for p in pts)
    return f"linear({body})", dur, peak


SPECS = [
    ("spatial", 0.8, 400.0, "位移/尺寸：默认空间弹簧，轻微回弹"),
    ("spatial-fast", 0.8, 1500.0, "位移/尺寸：快速空间弹簧，用于小幅交互反馈"),
    ("effects", 1.0, 400.0, "颜色/透明度/阴影：临界阻尼，不回弹"),
    ("effects-fast", 1.0, 1500.0, "颜色/透明度：快速档"),
]

print("/* ---- M3 Expressive 弹簧缓动（MotionScheme.expressive()）----")
print("   由 scripts/gen-spring-easings.py 生成；末点归一到 1，可安全压缩时长播放。 */")
for name, damping, stiffness, desc in SPECS:
    value, dur, peak = easing(damping, stiffness)
    print(f"  /* {desc}（阻尼 {damping} / 刚度 {stiffness:.0f}，稳定 {dur * 1000:.0f}ms，峰值 {peak:.4f}） */")
    print(f"  --md-sys-motion-spring-{name}: {value};")
