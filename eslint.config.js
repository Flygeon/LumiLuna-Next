import js from "@eslint/js";
import globals from "globals";
import vue from "eslint-plugin-vue";
import vueParser from "vue-eslint-parser";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import prettier from "eslint-plugin-prettier/recommended";

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "src-tauri/**",
      "public/**",
      "*.config.*",
      "coverage/**",
      "src/assets/**",
      "**/*参考*/**",
    ],
  },
  js.configs.recommended,
  ...vue.configs["flat/recommended"],
  {
    files: ["**/*.{ts,vue}"],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tsParser,
        ecmaVersion: "latest",
        sourceType: "module",
        extraFileExtensions: [".vue"],
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.worker,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      // TS 已接管未定义检查，关闭 JS 侧 no-undef 避免误报（worker 全局等）
      "no-undef": "off",
      // ---- 类型规则：存量代码较多，先放宽，后续逐步收紧 ----
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-unused-vars": "off",
      "@typescript-eslint/ban-ts-comment": "warn",
      // ---- Vue 规则 ----
      "vue/multi-word-component-names": "off",
      "vue/no-v-html": "off",
      "vue/require-default-prop": "off",
      "vue/no-mutating-props": "warn",
      // ---- 基础规则 ----
      "no-console": "warn",
      "no-debugger": "warn",
    },
  },
  {
    // 这两个组件向 @m3e/web 自定义元素（web components）投影内容，用的是原生 slot
    // 属性（web components 的插槽机制），并非 Vue 2 已废弃的具名插槽语法，故关闭该规则
    files: ["src/components/SegmentedTabs.vue", "src/views/TreasureView.vue"],
    rules: {
      "vue/no-deprecated-slot-attribute": "off",
    },
  },
  prettier,
];
