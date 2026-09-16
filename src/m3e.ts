// @m3e/web 原生组件按需副作用注册（导入即 customElements.define）。
// 仅引入本项目实际用到的组件，避免打包整个 @m3e/all：
// - m3e-button / m3e-button-group：连通按钮组（子选项卡）
// - m3e-list / m3e-list-item：连通分组列表（百宝箱）
// - m3e-switch：开关（设置页 / 音效面板）
// - m3e-slider / m3e-slider-thumb：滑块（设置页 / 音效面板 / 阅读器）
// - m3e-dialog / m3e-dialog-action：对话框（文本输入）
// - m3e-bottom-sheet：底部面板（聚合搜索播放源）
// - m3e-menu / m3e-menu-item：菜单（全局右键菜单）
import "@m3e/web/bottom-sheet";
import "@m3e/web/button";
import "@m3e/web/button-group";
import "@m3e/web/dialog";
import "@m3e/web/list";
import "@m3e/web/menu";
import "@m3e/web/slider";
import "@m3e/web/switch";
