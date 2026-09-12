// @m3e/web 原生组件按需副作用注册（导入即 customElements.define）。
// 仅引入本项目实际用到的组件，避免打包整个 @m3e/all：
// - m3e-button / m3e-button-group：按钮与连通按钮组（子选项卡）
// - m3e-list / m3e-list-item：连通分组列表（百宝箱 / 设置 / 目录）
// - m3e-icon-button：图标按钮（播放控制 / 窗口控制 / 工具栏）
// - m3e-fab：浮动操作按钮（播放器主播放键）
// - m3e-card：卡片（媒体卡片 / 扩展卡 / 统计卡）
// - m3e-chips：chip-set / filter-chip / suggestion-chip（筛选 / 预设 / 搜索联想）
// - m3e-slider：滑块（模糊度 / 遮罩 / EQ / 字号 / 行距）
// - m3e-switch：开关（启用 / 禁用 / 桌面歌词选项）
// - m3e-segmented-button：分段按钮（背景类型 / 视图模式 / PDF 模式）
// - m3e-dialog：对话框（文本输入 / 确认弹窗）
// - m3e-form-field：表单字段容器（dialog 内输入框）
// - m3e-progress-indicator：加载指示器（circular-progress）
// - m3e-nav-rail / m3e-nav-bar / m3e-nav-item：左侧导航 rail（m3e-nav-item 由 nav-bar 定义）
import "@m3e/web/button";
import "@m3e/web/button-group";
import "@m3e/web/list";
import "@m3e/web/icon-button";
import "@m3e/web/fab";
import "@m3e/web/card";
import "@m3e/web/chips";
import "@m3e/web/slider";
import "@m3e/web/switch";
import "@m3e/web/segmented-button";
import "@m3e/web/dialog";
import "@m3e/web/form-field";
import "@m3e/web/progress-indicator";
import "@m3e/web/nav-bar";
import "@m3e/web/nav-rail";
