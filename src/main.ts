import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import router from "./router";
import "@/tokens/theme.css";

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

// 启动加载动画收尾：Vue 挂载后让 index.html 里的 splash 淡出并移除。
// transitionend 在个别 webview 里可能不触发，加超时兜底强制移除。
const splash = document.getElementById("boot-splash");
if (splash) {
  requestAnimationFrame(() => {
    splash.classList.add("boot-splash--leaving");
    splash.addEventListener("transitionend", () => splash.remove(), { once: true });
    window.setTimeout(() => splash.remove(), 1000);
  });
}
