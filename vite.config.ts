import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";
import { readFileSync } from "node:fs";

/**
 * 应用版本号以构建期常量注入（`__APP_VERSION__`），与 src-tauri/tauri.conf.json 的
 * version 保持同源（两处都在发版时 bump）。此前「关于」页把它写死成字符串，
 * 发版后不会跟着变，所以改成从 package.json 读取。
 */
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8"),
) as { version: string };

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [
    vue({
      template: {
        compilerOptions: {
          // m3e-* 是 @m3e/web 原生自定义元素，交给浏览器处理，不要当 Vue 组件解析
          isCustomElement: (tag) => tag.startsWith("m3e-"),
        },
      },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  // Vite options tailored for Tauri development
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
