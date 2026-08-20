/**
 * 动态配色：由一个种子色（seed）实时生成整套 Material Design 3 颜色令牌，
 * 以内联样式写到 <html> 上，从而覆盖 tokens/theme.css 里的静态默认值
 * （行内样式优先级高于任何选择器，浅色/深色两套 [data-theme] 规则都会被盖住）。
 *
 * 使用 @material/material-color-utilities 的 SchemeTonalSpot，随浅/深色切换重算。
 */
import {
  Hct,
  SchemeTonalSpot,
  MaterialDynamicColors,
  argbFromHex,
  hexFromArgb,
  type DynamicColor,
} from "@material/material-color-utilities";

/** CSS 变量 ↔ MD3 动态颜色角色映射（与 theme.css 中定义的令牌一一对应）。
 *  故意不含 --md-sys-color-scrim：它在 theme.css 里是半透明 rgba，
 *  若替换成不透明色会让所有蒙层变实心，故保留原值。 */
const TOKEN_MAP: Array<[string, DynamicColor]> = [
  ["--md-sys-color-primary", MaterialDynamicColors.primary],
  ["--md-sys-color-on-primary", MaterialDynamicColors.onPrimary],
  ["--md-sys-color-primary-container", MaterialDynamicColors.primaryContainer],
  ["--md-sys-color-on-primary-container", MaterialDynamicColors.onPrimaryContainer],
  ["--md-sys-color-secondary", MaterialDynamicColors.secondary],
  ["--md-sys-color-on-secondary", MaterialDynamicColors.onSecondary],
  ["--md-sys-color-secondary-container", MaterialDynamicColors.secondaryContainer],
  ["--md-sys-color-on-secondary-container", MaterialDynamicColors.onSecondaryContainer],
  ["--md-sys-color-tertiary", MaterialDynamicColors.tertiary],
  ["--md-sys-color-on-tertiary", MaterialDynamicColors.onTertiary],
  ["--md-sys-color-tertiary-container", MaterialDynamicColors.tertiaryContainer],
  ["--md-sys-color-on-tertiary-container", MaterialDynamicColors.onTertiaryContainer],
  ["--md-sys-color-error", MaterialDynamicColors.error],
  ["--md-sys-color-on-error", MaterialDynamicColors.onError],
  ["--md-sys-color-error-container", MaterialDynamicColors.errorContainer],
  ["--md-sys-color-on-error-container", MaterialDynamicColors.onErrorContainer],
  ["--md-sys-color-surface", MaterialDynamicColors.surface],
  ["--md-sys-color-on-surface", MaterialDynamicColors.onSurface],
  ["--md-sys-color-surface-dim", MaterialDynamicColors.surfaceDim],
  ["--md-sys-color-surface-bright", MaterialDynamicColors.surfaceBright],
  ["--md-sys-color-surface-container-lowest", MaterialDynamicColors.surfaceContainerLowest],
  ["--md-sys-color-surface-container-low", MaterialDynamicColors.surfaceContainerLow],
  ["--md-sys-color-surface-container", MaterialDynamicColors.surfaceContainer],
  ["--md-sys-color-surface-container-high", MaterialDynamicColors.surfaceContainerHigh],
  ["--md-sys-color-surface-container-highest", MaterialDynamicColors.surfaceContainerHighest],
  ["--md-sys-color-on-surface-variant", MaterialDynamicColors.onSurfaceVariant],
  ["--md-sys-color-outline", MaterialDynamicColors.outline],
  ["--md-sys-color-outline-variant", MaterialDynamicColors.outlineVariant],
  ["--md-sys-color-inverse-surface", MaterialDynamicColors.inverseSurface],
  ["--md-sys-color-inverse-on-surface", MaterialDynamicColors.inverseOnSurface],
  ["--md-sys-color-inverse-primary", MaterialDynamicColors.inversePrimary],
  ["--md-sys-color-on-background", MaterialDynamicColors.onBackground],
  ["--md-sys-color-background", MaterialDynamicColors.background],
];

function normalizeHex(seed: string): string | null {
  if (!/^#?[0-9a-fA-F]{6}$/.test(seed)) return null;
  return seed.startsWith("#") ? seed : `#${seed}`;
}

/**
 * 依据种子色与深/浅模式，把整套 MD3 颜色令牌写到 documentElement 上。
 * seed 非法时静默返回，沿用 theme.css 的默认配色。
 */
export function applySeedColor(seed: string, dark: boolean): void {
  if (typeof document === "undefined") return;
  const hex = normalizeHex(seed);
  if (!hex) return;
  const scheme = new SchemeTonalSpot(Hct.fromInt(argbFromHex(hex)), dark, 0);
  const root = document.documentElement;
  for (const [cssVar, role] of TOKEN_MAP) {
    root.style.setProperty(cssVar, hexFromArgb(role.getArgb(scheme)));
  }
}
