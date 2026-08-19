// Wenku8 登录态共享：当任意 Wenku8 请求返回 [WENKU8_LOGIN_REQUIRED] 时，
// 子组件（详情/阅读器）通过本模块通知顶层视图弹出“重新登录”提示。
import { ref } from "vue";

/** 顶层视图监听此信号以弹出重登提示 */
export const reloginRequested = ref(false);

/** 在子组件捕获到登录失效时调用 */
export function requestRelogin() {
  reloginRequested.value = true;
}

/** 顶层视图处理完成后复位 */
export function clearRelogin() {
  reloginRequested.value = false;
}
