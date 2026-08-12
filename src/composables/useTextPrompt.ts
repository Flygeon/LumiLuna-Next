/**
 * M3 文本输入对话框（重命名等场景）。
 * TextPrompt.vue 读取此状态渲染；调用 promptText() 得到一个 Promise。
 */
import { reactive } from "vue";

interface TextPromptState {
  visible: boolean;
  title: string;
  initial: string;
  resolve: ((value: string | null) => void) | null;
}

const state = reactive<TextPromptState>({
  visible: false,
  title: "",
  initial: "",
  resolve: null,
});

/** 弹出文本输入框；resolve 为输入的字符串，取消返回 null */
export function promptText(title: string, initial = ""): Promise<string | null> {
  state.title = title;
  state.initial = initial;
  state.visible = true;
  return new Promise((res) => {
    state.resolve = res;
  });
}

export function resolvePrompt(value: string | null): void {
  state.visible = false;
  state.resolve?.(value);
  state.resolve = null;
}

export function useTextPrompt(): TextPromptState {
  return state;
}
