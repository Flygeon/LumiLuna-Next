/**
 * 全局右键菜单状态（Material Design 3）。
 * ContextMenu.vue 读取此状态渲染，任意组件调用 openContextMenu 触发。
 */
import { reactive } from "vue";

export interface MenuItem {
  id: string;
  label: string;
  icon?: string;
  danger?: boolean;
  disabled?: boolean;
}

interface ContextMenuState {
  x: number;
  y: number;
  items: MenuItem[];
  visible: boolean;
  onSelect: ((id: string) => void) | null;
}

const state = reactive<ContextMenuState>({
  x: 0,
  y: 0,
  items: [],
  visible: false,
  onSelect: null,
});

/** 菜单触发位置：桌面传右键 MouseEvent，移动端长按传合成坐标 */
export type MenuAnchor =
  | MouseEvent
  | { clientX: number; clientY: number };

/** 在右键/长按位置弹出菜单 */
export function openContextMenu(
  e: MenuAnchor,
  items: MenuItem[],
  onSelect: (id: string) => void,
): void {
  // 长按合成坐标没有 preventDefault/stopPropagation，需按存在性调用
  if (typeof (e as MouseEvent).preventDefault === "function") {
    (e as MouseEvent).preventDefault();
    (e as MouseEvent).stopPropagation();
  }
  state.x = e.clientX;
  state.y = e.clientY;
  state.items = items;
  state.onSelect = onSelect;
  state.visible = true;
}

export function closeContextMenu(): void {
  state.visible = false;
  state.onSelect = null;
}

export function useContextMenu(): ContextMenuState {
  return state;
}
