<script setup lang="ts">
/**
 * 终端布局主页（ak-ui terminal 强度）：命令面板式入口。
 * 仅在激活皮肤声明 manifest.layout === "terminal" 时可达——App.vue 负责隐藏侧栏与落地本页。
 * 约定：结构与交互留在组件内，设计语言交给皮肤；视觉属性一律走 --ak-* 语义令牌 + MD3 兜底，
 * 因此没有 ak-ui 令牌层时也不会裸奔。
 */
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useSettingsStore } from "@/stores/settings";
import { useLibraryStore } from "@/stores/library";
import { BOTTOM_DESTINATIONS, PRIMARY_DESTINATIONS } from "@/utils/navDestinations";
import { translate } from "@shared/i18n";

const settings = useSettingsStore();
const library = useLibraryStore();
const router = useRouter();

function t(key: string) {
  return translate(settings.lang, key);
}

const modules = computed(() =>
  PRIMARY_DESTINATIONS.map((d) => ({
    key: d.key,
    path: d.path,
    icon: d.icon,
    title: d.label || t(`nav.${d.key}`),
    sub: t(`navDesc.${d.key}`),
    count: d.type ? (library.counts[d.type] ?? 0) : null,
  })),
);

/** 真实遥测：已索引的媒体条目总数（不是装饰性编号） */
const total = computed(() =>
  PRIMARY_DESTINATIONS.reduce((sum, d) => (d.type ? sum + (library.counts[d.type] ?? 0) : sum), 0),
);

const telemetry = computed(() =>
  PRIMARY_DESTINATIONS.filter((d) => d.type).map((d) => ({
    key: d.key,
    label: t(`nav.${d.key}`),
    value: library.counts[d.type as string] ?? 0,
  })),
);

function open(path: string) {
  void router.push(path);
}
</script>

<template>
  <div class="term-home">
    <header class="term-hero">
      <div class="term-hero-text">
        <p class="term-kicker">{{ t("terminal.kicker") }}</p>
        <h1 class="term-title">{{ t("app.name") }}</h1>
        <p class="term-meta">
          <span class="term-meta-value tabular-nums">{{ total }}</span>
          <span>{{ t("terminal.indexed") }}</span>
        </p>
      </div>
      <dl class="term-telemetry">
        <div v-for="item in telemetry" :key="item.key" class="term-stat">
          <dt>{{ item.label }}</dt>
          <dd class="tabular-nums">{{ item.value }}</dd>
        </div>
      </dl>
    </header>

    <nav class="term-modules" :aria-label="t('terminal.modules')">
      <button
        v-for="m in modules"
        :key="m.path"
        type="button"
        class="term-module"
        @click="open(m.path)"
      >
        <span class="term-module-icon material-symbols-outlined">{{ m.icon }}</span>
        <span class="term-module-text">
          <span class="term-module-title">{{ m.title }}</span>
          <span class="term-module-sub">{{ m.sub }}</span>
        </span>
        <span v-if="m.count !== null" class="term-module-count tabular-nums">{{ m.count }}</span>
        <span v-else class="term-module-enter material-symbols-outlined">arrow_forward</span>
      </button>
    </nav>

    <footer class="term-foot">
      <button
        v-for="d in BOTTOM_DESTINATIONS"
        :key="d.path"
        type="button"
        class="term-foot-btn"
        @click="open(d.path)"
      >
        <span class="material-symbols-outlined">{{ d.icon }}</span>
        <span class="term-foot-label">{{ t(`nav.${d.key}`) }}</span>
      </button>
    </footer>
  </div>
</template>

<style scoped>
.term-home {
  display: flex;
  flex-direction: column;
  gap: var(--ak-space-5, 24px);
  min-height: 100%;
}

/* ---- 命令平面头部：主命令 + 支撑上下文 + 真实遥测 ---- */
.term-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--ak-space-4, 16px) var(--ak-space-6, 32px);
  padding-bottom: var(--ak-space-4, 16px);
  border-bottom: var(--ak-line-hairline, 1px) solid var(--md-sys-color-outline-variant);
}
.term-hero-text {
  min-width: 0;
}
.term-kicker {
  margin: 0 0 8px;
  font-family: var(--ak-font-mono, ui-monospace, Consolas, monospace);
  font-size: 11px;
  letter-spacing: var(--ak-type-wide, 0.12em);
  text-transform: uppercase;
  color: var(--ak-signal-info, var(--md-sys-color-primary));
}
.term-title {
  margin: 0;
  font-family: var(--ak-font-command, inherit);
  font-size: clamp(30px, 4.2vw, 52px);
  font-weight: 800;
  line-height: 1;
  letter-spacing: var(--ak-type-tight, -0.03em);
  color: var(--ak-text-primary, var(--md-sys-color-on-surface));
}
.term-meta {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 12px 0 0;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--ak-text-secondary, var(--md-sys-color-on-surface-variant));
}
.term-meta-value {
  font-family: var(--ak-font-mono, ui-monospace, Consolas, monospace);
  font-size: 18px;
  color: var(--ak-text-primary, var(--md-sys-color-on-surface));
}
.term-telemetry {
  display: flex;
  gap: var(--ak-space-5, 24px);
  margin: 0;
}
.term-stat dt {
  font-size: 10px;
  letter-spacing: var(--ak-type-wide, 0.12em);
  text-transform: uppercase;
  color: var(--ak-text-secondary, var(--md-sys-color-on-surface-variant));
}
.term-stat dd {
  margin: 4px 0 0;
  font-family: var(--ak-font-mono, ui-monospace, Consolas, monospace);
  font-size: 20px;
  color: var(--ak-text-primary, var(--md-sys-color-on-surface));
}

/* ---- 模块矩阵：首模块跨两列打破等距，5 个模块 + 跨列 = 6 格，正好铺满不留孤儿 ---- */
.term-modules {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--ak-space-3, 12px);
}
.term-module {
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--ak-space-4, 16px);
  min-height: 88px;
  padding: var(--ak-space-4, 16px) var(--ak-space-5, 24px);
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.term-module:first-child {
  grid-column: span 2;
}
/* 可见形状切角（::before 承载），命中区域保持矩形 */
.term-module::before {
  content: "";
  position: absolute;
  inset: 0;
  background: var(--ak-surface-raised, var(--md-sys-color-surface-container-low));
  border: var(--ak-line-hairline, 1px) solid var(--md-sys-color-outline-variant);
  clip-path: polygon(
    0 0,
    calc(100% - var(--ak-cut-md, 12px)) 0,
    100% var(--ak-cut-md, 12px),
    100% 100%,
    0 100%
  );
  transition:
    background var(--ak-motion-fast, 120ms) var(--ak-ease-standard, cubic-bezier(0.2, 0, 0, 1)),
    border-color var(--ak-motion-fast, 120ms) var(--ak-ease-standard, cubic-bezier(0.2, 0, 0, 1)),
    transform var(--ak-motion-fast, 120ms) var(--ak-ease-standard, cubic-bezier(0.2, 0, 0, 1));
}
/* 左侧信号规则：唯一的强几何手势 */
.term-module::after {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: var(--ak-line-strong, 4px);
  background: var(--ak-signal-info, var(--md-sys-color-primary));
}
.term-module:first-child::after {
  background: var(--ak-signal-action, var(--md-sys-color-tertiary));
}
.term-module > * {
  position: relative;
}
.term-module-icon {
  font-size: 26px;
  color: var(--ak-signal-info, var(--md-sys-color-primary));
  transition: transform var(--ak-motion-fast, 120ms)
    var(--ak-ease-standard, cubic-bezier(0.2, 0, 0, 1));
}
.term-module:first-child .term-module-icon {
  color: var(--ak-signal-action, var(--md-sys-color-tertiary));
}
.term-module-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.term-module-title {
  font-size: var(--md-sys-typescale-title-medium-size);
  font-weight: 700;
  color: var(--ak-text-primary, var(--md-sys-color-on-surface));
}
.term-module-sub {
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--ak-text-secondary, var(--md-sys-color-on-surface-variant));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.term-module-count,
.term-module-enter {
  font-family: var(--ak-font-mono, ui-monospace, Consolas, monospace);
  font-size: 20px;
  color: var(--ak-text-secondary, var(--md-sys-color-on-surface-variant));
}
.term-module:hover::before {
  background: var(--ak-surface-muted, var(--md-sys-color-surface-container));
  border-color: var(--ak-signal-info, var(--md-sys-color-primary));
}
.term-module:hover .term-module-icon {
  transform: translateX(3px);
}
.term-module:hover .term-module-title {
  letter-spacing: var(--ak-type-tight, -0.02em);
}
.term-module:active::before {
  transform: translateY(1px);
}
.term-module:focus-visible {
  outline: var(--ak-focus-width, 3px) solid var(--ak-focus-color, var(--md-sys-color-primary));
  outline-offset: var(--ak-focus-offset, 3px);
}

/* ---- 次级入口 ---- */
.term-foot {
  display: flex;
  gap: var(--ak-space-2, 8px);
  margin-top: auto;
  padding-top: var(--ak-space-4, 16px);
  border-top: var(--ak-line-hairline, 1px) solid var(--md-sys-color-outline-variant);
}
.term-foot-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 0 var(--ak-space-4, 16px);
  border: var(--ak-line-hairline, 1px) solid var(--md-sys-color-outline-variant);
  background: transparent;
  color: var(--ak-text-secondary, var(--md-sys-color-on-surface-variant));
  font: inherit;
  cursor: pointer;
  transition:
    color var(--ak-motion-fast, 120ms) var(--ak-ease-standard, cubic-bezier(0.2, 0, 0, 1)),
    border-color var(--ak-motion-fast, 120ms) var(--ak-ease-standard, cubic-bezier(0.2, 0, 0, 1));
}
.term-foot-btn:hover {
  color: var(--ak-text-primary, var(--md-sys-color-on-surface));
  border-color: var(--ak-signal-info, var(--md-sys-color-primary));
}
.term-foot-btn:focus-visible {
  outline: var(--ak-focus-width, 3px) solid var(--ak-focus-color, var(--md-sys-color-primary));
  outline-offset: var(--ak-focus-offset, 3px);
}
.term-foot-btn .material-symbols-outlined {
  font-size: 18px;
}
.term-foot-label {
  font-size: var(--md-sys-typescale-label-large-size);
  letter-spacing: var(--ak-type-wide, 0.12em);
}

/* 中视口 2 列（跨列首模块 + 4 个 = 3 行铺满），窄视口单列堆叠 */
@media (max-width: 1100px) {
  .term-modules {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 760px) {
  .term-modules {
    grid-template-columns: minmax(0, 1fr);
  }
  .term-module:first-child {
    grid-column: span 1;
  }
  .term-telemetry {
    gap: var(--ak-space-4, 16px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .term-module::before,
  .term-module-icon,
  .term-foot-btn {
    transition: none;
  }
}
</style>
