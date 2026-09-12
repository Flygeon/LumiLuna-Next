/// <reference types="vite/client" />

/** 构建期注入的应用版本号（来源 package.json，见 vite.config.ts 的 define） */
declare const __APP_VERSION__: string;

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}
