import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import router from "./router";
import { isMobile } from "@/capabilities";
import { vLongPress } from "@/composables/useLongPress";
import "@/tokens/theme.css";

// 移动端布局开关：在挂载前给 <html> 打标记，theme.css 的 html.is-mobile
// 覆盖块随即生效（nav 宽度归零、底部导航高度、安全区内边距），
// 避免首帧按桌面布局渲染再跳变。
if (isMobile) document.documentElement.classList.add("is-mobile");

// 全局全局错误处理：将 Vue 渲染错误、window JS 错误、未捕获 Promise 异常
// 写入 lumiluna_login_debug.log（与 wenku8 登录日志共享同一文件），
// 用于诊断“点击书籍闪退”这类在崩溃前无法打开 devtools 的场景。
function safeStringify(v: unknown): string {
  if (v instanceof Error) return v.stack || v.message || String(v);
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
async function reportError(tag: string, payload: Record<string, unknown>) {
  try {
    const { capabilities } = await import("@/capabilities");
    await capabilities.appLog(`[${tag}] ${safeStringify(payload)}`);
  } catch {
    /* 忽略——不能在错误处理路径里再抛 */
  }
}

const app = createApp(App);
app.use(createPinia());
app.use(router);
// 触屏长按 = 桌面右键菜单（移动端才生效，桌面为 no-op）
app.directive("long-press", vLongPress);

// Vue 渲染/生命周期错误
app.config.errorHandler = (err, instance, info) => {
  void reportError("vue-err", {
    err: safeStringify(err),
    info,
    component: (instance?.$options as { name?: string } | undefined)?.name ?? null,
  });
};

// 未捕获的 JS 错误（同步）
window.addEventListener("error", (e) => {
  void reportError("window-err", {
    message: e.message,
    src: `${e.filename}:${e.lineno}:${e.colno}`,
    stack: e.error instanceof Error ? e.error.stack : null,
  });
});

// 未捕获的 Promise 异常
window.addEventListener("unhandledrejection", (e) => {
  void reportError("unhandledrejection", { reason: safeStringify(e.reason) });
});

app.mount("#app");