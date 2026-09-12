// @m3e/web 原生组件按需副作用注册（导入即 customElements.define）。
// 仅引入本项目实际用到的三个组件，避免打包整个 @m3e/all：
// - m3e-button / m3e-button-group：连通按钮组（子选项卡）
// - m3e-list / m3e-list-item：连通分组列表（百宝箱）
import "@m3e/web/button";
import "@m3e/web/button-group";
import "@m3e/web/list";
