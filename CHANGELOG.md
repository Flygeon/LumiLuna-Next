# Changelog

## 1.2.1 (2026-09-12)

> 本版本涵盖自 1.2.0 以来的全部 27 个提交，按功能模块归类；括号内为对应 commit。
> 主线是**扩展框架落地**（主项目零体积增加，首个参考扩展 MiaoHui 独立分发）与**在线图片（Pixiv）**，
> 另有设置页重构与开关视觉统一。

### 新增功能

#### 扩展框架（Extension Host）
- 新增扩展主机，支持扩展的安装 / 卸载 / 启用停用 / 调用 / 打开，**主项目零体积增加**，扩展包独立分发（b5cc28f）
- 扩展目录约定 `app_data_dir/extensions/<id>/`：`manifest.json` + `engine/`（引擎）+ `web/dist/`（界面）+ `data/`（数据）（b5cc28f）
- 主机只暴露通用命令：`ext_list` / `ext_install` / `ext_uninstall` / `ext_set_enabled` / `ext_invoke` / `ext_open`；其中 `open` / `reveal` 由主机拦截代执行，扩展本身不持有高权限（b5cc28f）
- `ext_invoke` 把 `POST 127.0.0.1:<port>/<method>` 路由到引擎 sidecar（b5cc28f）
- 引擎 sidecar 以 `CREATE_NO_WINDOW` 拉起，靠 stdout 首行 `READY <port>` 完成握手；`cmd` 以 `.py` 结尾时经解释器执行（源码模式），否则补 `.exe`（PyInstaller 冻结模式）（b5cc28f）
- 扩展 Web UI 走 **iframe + postMessage**（iframe 内无 Tauri 桥接），父组件 `ExtensionHost.vue` 用 `convertFileSrc` 生成 `asset://` 地址并代理 `extInvoke`（b5cc28f）
- 新增扩展管理页与扩展宿主窗口（`ExtensionsView.vue` / `ExtensionHost.vue`），并注册对应路由（b5cc28f）
- 新增 `capabilities/extension.json` 预授权窗口 label `extension`：Tauri v2 的 capability 不能运行时动态加标签，故所有扩展 UI 共用一个预授权窗口，靠 `ext:navigate` 事件 + 路由区分（b5cc28f）
- 首个参考实现扩展 **MiaoHui（妙绘）** 独立分发：图片 / 视频索引 + OCR + ASR + 向量检索，MIT 协议，源码与打包脚本见 `miaohui-extension/`（b5cc28f）
- 扩展迁移方案文档 `doc/miaohui-migration-plan.md`（b5cc28f）

#### 在线图片（Pixiv，移植自 Pixez）
- 移植 Pixez 在线图片功能：浏览 / 搜索 / 排行榜 + 设置开关（默认关闭）（4fa1ff6）
- 图片经 Rust 代理命令取回并自动携带 `Referer`，前端转 Blob URL 并按 URL 内存缓存（4fa1ff6）
- 作品评论 + 大图预览（多页翻页）+ 旧会话用户名恢复（f6f4f53）
- 收藏 + 作者页 / 关注 + 关注流 + 全列表加载更多 + ugoira 动图 + 搜索热词与联想（cd63d54）
- 懒刷新 token：接口返回 400 / 401 时自动用 refresh_token 恢复会话后重试（cd63d54）

#### 在线番剧
- **ArtPlayer 替换原生播放器** + DanDanPlay 弹幕接入 + FFmpeg 横幅修复（29d80c4）
- Bangumi 追番同步 + MD3 三阶取色配色（9e53475）
- 番剧卡片改竖版；详情页新增 hero 动画；历史记录点击进入详情页（ac69bc0）
- hero 动画改为 overlay 飞行层实现；回滚三阶配色（1ce00a5）

#### 界面与设置
- 设置页改为**左右双栏**：左侧分类导航 + 右侧内容区（b5cc28f、9149ce2）
- 设置页改为**一次只显示一个分类**的切换视图，不再是一条长页滚动找锚点（本次发布）
- 播放器进度条 / 主播放按钮 / 侧边按钮改 MD3 风格，补齐 hover、active、elevation（b5cc28f）
- 启用 / 关闭开关统一为 **MD3 Switch**（轨道 + 滑块），提为全局样式，设置页与音效面板共用，并保留 `.lm-checkbox-native` 逃生舱给原生多选框（9149ce2）
- 引入 Google Sans 字体族（Regular / Medium / SemiBold / Bold）（b5cc28f）
- 新增 MD3 启动加载动画（1ce00a5）

### 修复

#### 设置与播放器
- 设置页双栏错位：`:deep(.page-header)` 与 PageHeader 组件实际根类名 `.page-head` 不符，选择器静默失效导致标题落进 180px 左栏、导航与卡片整体错位（9149ce2）
- 设置页分类锚点错位：`settings-playback` 原本挂在「播放器」卡片上，点「播放」会跳过 FFmpeg / 歌词 / 桌面歌词（9149ce2）
- 音乐播放器歌词高亮行偏移（视觉高亮落后播放时间轴一行）——已回滚，高亮行回到 `player.activeLine`（9149ce2）

#### 在线图片（Pixiv）
- 「登录成功但列表全空」：API JSON 为 snake_case 而结构体按 camelCase 反序列化，缺 `rename` 别名导致每条作品解析失败；同时补 `[pixiv]` 诊断日志，避免「列表全空且无报错」的无解现场（3da456a）
- 补 `base64::Engine` 引入，修复 `URL_SAFE_NO_PAD.encode` 编译错误 E0599（c027b22）
- 修 E0283：`call_api_post_blocking` 里 `.or(Ok(Value::Null))` 类型推断歧义（ad9237e）
- `Cargo.toml` 中 `zip` 重复键导致构建失败；返回推荐列表不再反复刷新（aefe342）

#### 在线番剧
- 追番按钮遇到空响应体时解析报错（ac69bc0）

#### 在线小说
- Wenku8 登录窗口点 X 关不掉 / 登录成功后不自动关闭；移除 DevTools 自启（994f6d6）

#### 扩展框架
- 更新 Tauri v2 extension 相关 API 调用（7eb70cf）
- 移除多余的快捷键 handler 变量（c46e9af）

### 工程与 CI
- 引入代码质量工具链：ESLint + Prettier（前端）、thiserror + anyhow（Rust 错误处理）、clippy + rustfmt，并修复随之暴露的 CI 问题（6a7fcdd、0dfdfc1、e95643f）
- 修复 CI clippy `useless_borrows_in_formatting` 告警（854583c）
- 清理剩余 clippy 告警（5813586）
- 为 ESLint / Prettier 增加忽略规则，排除本地参考项目（6fc4077）
- 移除仓库内的本地参考项目（93473ce）
- 统一扩展 host 与设置页 / 播放器代码格式（4645b7d、1c633b1、0dba5f3）

## 1.2.0 (2026-08-30)

> 本版本涵盖自 1.1.0 以来的全部 77 个提交，按功能模块归类；括号内为对应 commit。

### 新增功能

#### 在线番剧（Kazumi 规则采集看番）
- 复刻 Kazumi 原版 UX：热门番组主页 + 聚合搜索换源 + Bangumi 详情（e9bc5d3）
- Kazumi 规则采集看番 Phase 1 看番链路，仅桌面端（a48c538）
- 正在热播改用 Bangumi `calendar` 热度榜（按 `collection.doing` 降序取 Top30），不再依赖已挂掉的 `next.bgm.tv/p1`（67fe47f）
- Bangumi 详情改用 `api.bgm.tv/v0/subjects/{id}`（67fe47f）
- 规则管理页每条规则新增启用/禁用开关，禁用态置灰 + 删除线 + 「已禁用」徽标（67fe47f）
- 死源 DM84 / baimao 默认禁用（持久化到 `disabled.json`，可重新启用）（67fe47f）

#### 在线小说（Wenku8）
- 移植 Wenku8 登录系统：WebView 内嵌登录 + 在线书架合并（9d308ca）
- 主窗口轮询方案接管 cookie 获取（新增 `wenku8_login_poll`），不再依赖远程页注入脚本（eef9afa）
- 在线小说主页：书架置顶 + 登录条仅未登录时显示（322d398）
- 详情页加「立即阅读」按钮 + 阅读器空态提示与防御性检查（91640c4）
- 在线小说改为双栏书页排版，仿本地 EPUB 阅读效果（86e34f9）
- 把 NovelReader 合并进 BookReader，在线小说享受完整阅读设置（893ee56）
- 在线小说阅读器全屏 + 正文渲染修复（5e47cdc）
- 在线小说分页重写：JS 分页替代 CSS multicolumn（88e9ad7）
- 在线小说（Wenku8）与小说阅读统计（30b1c32）
- 章节内进度保存（20aa35d）

#### 皮肤系统
- 皮肤系统 v1：外部 JSON 导入 / 固化存储 / 任意 CSS 注入 + 四款内置皮肤（含 Material Design 1）（317509e）
- 皮肤 v2 格式：ZIP 资产包 + 背景图 + 图标包 + 布局开放；示例皮肤迁至 `example/`（5a0bc60）
- `.gitignore` 放行 `*.zip`，补上遗漏的 sakura 皮肤打包产物（336cadf）

#### 播放器与桌面歌词
- 桌面歌词：中文翻译显示 + 鼠标穿透（20aa35d）
- 播放器评论面板与迷你播放器红心喜欢（583e0ee）
- 移植「现在就听」信息流：私人 FM / 每日推荐 / 为你推荐（9c3c802）
- 面板按钮移入底部控制栏 + 配色方案 + 关窗行为 + 为你推荐卡片动效（851a6ab）
- 顶栏精简为功能面板 + 封面点击唤起左侧评论（3cfc1de）
- 预设分享弹窗支持上传预设市场，设置新增 DevTools（d08fc05）
- 移植参考项目交互要点：托盘 / 热键、空态、弹性滑块、音乐列表、播放器布局（97a4b86）

#### 听歌时长统计
- 播放会话追踪：每次播放记录开始/结束时间与累计收听时长（6303e27）
- 日聚合统计：自动聚合每日播放次数、唯一曲目数和总时长（6303e27）
- 有效播放判定：收听 ≥30 秒或完成度 ≥80% 计入统计（6303e27）
- 来源分类：按本地 / 在线 / WebDAV 三种来源分别统计（6303e27）
- 统计页面：新增 `/stats` 路由与侧边栏入口（6303e27）
- 总览指标：周期总时长、今日播放 / 曲目 / 时长（6303e27）
- 活动趋势图：每日播放次数（柱状图）与时长（面积图）（6303e27）
- 来源分布：环形图 + 百分比详情（6303e27）
- 常听歌曲排行：支持搜索、排序（播放 / 时长 / 曲名 / 艺人）、数量筛选（6303e27）
- 自定义日期范围：选择起止日期查看统计（6303e27）
- 浏览器预览：mock 数据保证页面可渲染（6303e27）
- 统计入口移至百宝箱卡片（b0a2c89）

#### Windows 样式与界面
- Windows 样式自定义标题栏：无系统边框（`decorations: false`）、自定义标题栏覆盖全窗口宽度（029894c）
- 指针拖拽窗口（screen 坐标 + rAF 节流 + 4px 阈值防抖）（029894c）
- 双击标题栏最大化 / 还原（300ms 判定）（029894c）
- 最小化 / 最大化 / 关闭窗口控制按钮（Windows 风格 hover 效果）（029894c）
- 外观菜单：跟随系统 / 浅色 / 深色一键切换（029894c）
- GitHub 仓库链接，点击在浏览器中打开（029894c）
- 页面标题并入各视图：移除原 Topbar，新增 `PageHeader` 组件，每个视图自带页面标题与描述（029894c）
- 新增导航项描述文案，仅当前选中项在导航栏下方显示（029894c）
- 文件夹入口移入百宝箱：左侧导航栏移除「文件夹」选项卡，百宝箱新增「文件夹浏览」卡片，路由 `/folders` 保持不变（029894c）
- 移除侧边栏活动项描述（0743d4d）

#### 网易云音乐（手机号登录）
- 新增手机号短信登录（c6281bc）
- 修复 phoneLogin 变量遮蔽 profile ref（0313320）
- 补充 `md-sys-shape-corner-full` token，修复手机号登录控件直角（b7dbb91）

#### 文档
- README_zh.md 更新（f4679bd）
- 贡献者名单加入 deepseek、ChatGPT（自定义）（a272da3, 2021ac1）

### 优化
- 在线番剧检索改为真并发 + TTL 缓存 + 并发闸门，修复隐藏 webview 漏音与 m3u8 无画面（a8cf374）
- 静态取流支持 JSON 转义地址，补隐藏 webview 取流诊断（cebb11e）
- Wenku8 抓取检查 HTTP 状态码，403 / 拦截页不再静默返回空列表（4088dee）
- 列表解析增加 Wenku8 改版兜底（`book/xxx.htm` 链接提取书名）（f239ad1）
- `http_client` 不再强制 `no_proxy`，走系统 / 环境代理（04817ef）
- 在线小说主页暴露错误并支持重试（ba2f230）

### 修复
- 正在热播选错番（点 A 播 B）：空关键字守卫 + 标题随当前番剧，不再退化到 `trending[0]`（67fe47f）
- 聚合搜索结果被回写丢弃导致所有源 0 条（343215b）
- 内置规则过时导致聚合搜索 0 条：7sefun 改语义 class XPath，移除已死 DM84（dc73218）
- 仓库导入规则为空导致全部请求 builder error + 首页改版（8dac2c9）
- CI 编译错误 E0507：`eval_with_callback` 回调是 `Fn` 不是 `FnOnce`（07aa4f8）
- CI 编译错误：`http_client` 返回 `&Client`、`url::Origin` 无 Display、m3u8 分支 `unused_mut`（82dc576）
- referer 链 `Option<&str>` 与 `or_else` 返回 `Option<String>` 类型不一致（ab7704d）
- `lib.rs` 命令注册误删 `scan::` 前缀导致 `list_files` / `library_counts` 回归（f341ff1）
- `lib.rs` 命令注册 CI 编译错误（e9411fb）
- 拆分 `wenku8-login` capability 到独立文件，修复 JSON 解析错误（f83f3ca）
- Wenku8 登录窗口白屏与无法关闭（多轮修复：9ed83c1、cb1c6ac、cee4d0a、8d08f4c）
- 登录窗口 `onCloseRequested` 无限递归：移除 handler 内 `win.close()` 避免 X 关闭死循环（b274a36）
- 同步 command 主线程嵌套死锁导致 build 卡死，改用 `async` + `spawn_blocking`（13f6674）
- 移除登录窗口 `on_navigation` / `on_page_load` 闭包修复 build 死锁（58a780f）
- 登录 cookie 校验误写 + 覆盖 httpOnly（2d26c96）
- 移除 `window.__TAURI__` 未类型化访问，改用 `capabilities.wenku8LoginLog` 包装（8f98a7c）
- capability 中非法权限标识符（Tauri 权限名仅允许小写 ASCII / 连字符 / 冒号，自定义命令无需显式放行）（2cd87a6）
- 开启 `withGlobalTauri` + 放行远程自定义命令 + 重写注入脚本触发逻辑（da2773f）
- 点击登录按钮卡在「登录中」、窗口不出现（6a34563）
- 登录窗口自动开启 DevTools 并修正超时误报（20f5999）
- 修正 `open_devtools()` 调用（Tauri v2 返回 `()` 非 `Result`）（1771da0）
- Wenku8 登录注入：v2 前端无 eval，改由 Rust 侧注入（a46d71d）
- 登录注入脚本增加错误兜底浮层（2f0b6e3）
- `novel.rs` 正则 raw string 定界符导致 Rust 解析失败（ca7e24e）
- 搜索乱码 + 阅读器第三栏修复（6fa8e62）
- `novel.rs` 编码嗅探 `decode` 返回值解构位置 + `stats.rs` unused import（f7bef81）
- `parse_detail` 字节切片 panic（中文 UTF-8 非 char boundary）导致点书闪退（e2bdb56）
- NovelReader 用 Teleport 挂到 body，修复 `position:fixed` 全屏失效（7fed6a8）
- 桌面歌词关不掉并还原播放器布局，补全在线列表模式（df13bb8）
- 还原进度条和音量条，恢复播放器控件布局（7b454e6）
- 补充 `fs write_text_file` ACL 权限，修复保存预设 JSON 被拦截（fd62df9）

### 调试与可观测性
- 捕获原生层闪退：Rust panic hook + 通用 `app_log` 命令 + 前端全局错误处理器（9d47b17、7fd98f9）
- 阅读链路全量日志 + `novel_content` 正文开头日志，确认真实章节还是缓存脏数据（69fdf95、70b1c14）
- `doSearch` 加日志定位在线小说搜索按钮无法触发（501b19d）
- 登录窗口创建全流程写入日志文件（d021dc6）

## 1.1.0 (2026-08-18)

### 新增功能

#### 音效系统
- 自定义音效引擎：10 段 EQ 均衡器 + 低音增强 + 混响 + 立体声宽度
- 内置预设（Flat / Pop / Rock / Classical / Dance / Bass Boost / Vocal）
- 用户自定义预设：保存、删除、导入、导出
- 预设分享机制：生成分享码，支持导入导出
- LLFX3 紧凑二进制分享码格式（~44 字符，比旧版缩短 80%+）
- 7537 字库字符码分享格式（`预设名@字符码`），内置动漫/音游彩蛋预设（轻音 K-ON、BanG Dream!、LoveLive!、东方、初音未来等 100+ 角色）
- 预设分享码偏好设置：仅中文 / 仅原版 / 两者同时输出，导出时带标签说明
- 预设分享码兼容旧版 LLFX1 格式导入

#### 桌面歌词
- 独立透明置顶窗口，始终显示当前歌词
- 控制栏交互：点击歌词展开，5 秒无操作自动隐藏；设置可选始终显示
- 4 种歌词切换动画：淡入 / 上滑 / 缩放 / 模糊浮现（设置中可选）
- 窗口大小可调节，位置自动记忆
- 支持双击歌词播放/暂停（设置中可选择关闭）
- 控制栏展开时显示窗口边界阴影，便于识别窗口范围
- 默认不显示下一句，设置中可开启
- 锁定位置功能，防止误拖动

#### 百宝箱
- 侧边栏新增「百宝箱」选项卡
- 收纳 WebDAV 远程媒体入口
- 在线音效预设市场：从 GitHub 仓库拉取预设列表，一键下载导入

#### 网易云音乐
- 扫码登录网易云账号
- 访问我的歌单
- 云盘歌曲播放与分页加载
- 匿名身份注册（MUSIC_A），规避风控
- 支持 weapi / xeapi 全协议加密

#### WebDAV
- 远程媒体源配置与浏览
- 轻量本地代理，凭据不暴露在请求地址中
- 侧边栏按设置显隐

#### 歌词系统
- 更精确的逐字歌词（QQ 音乐 QRC 官方卡拉 OK 时间轴）
- 歌词来源切换：QQ → 酷狗 → Meting(网易云) → 本地
- 歌词来源徽标，显示当前来源
- 歌词来源手动切换（记忆偏好）
- 歌词副行翻译/罗马音切换
- 前奏/间奏自动识别
- 酷狗音乐歌词回退链
- 在线歌词本地缓存

#### 在线音乐
- 实验性在线音乐功能（Meting API）
- 预设歌单 + 用户自定义歌单
- 在线搜索

#### 阅读器
- PDF 阅读模式：单页 / 双页 / 滚动
- 阅读器背景主题（dark/light/sepia/green）
- 正文字体选择（system/sans/serif/kai/yuan）
- 字号、行距、段落间距调节
- EPUB 章节跳转
- 阅读进度保存

#### 其他
- Apple Music 风格图标
- 播放器背景模式：动态模糊 / 仅图片模糊 / 关闭
- 全局 Material Design 3 主题（浅色/深色/跟随系统）
- 歌词字体选择
- 中英文双语言支持
- 许可协议改为 GPL-3.0

### 优化

- 预设分享码从 JSON+Base64 改为二进制位打包（LLFX3），码长从 ~300 字符降至 ~44 字符
- 桌面歌词控制栏交互重做：hover 改为点击展开+5s 自动隐藏
- 桌面歌词窗口边界阴影，展开控制栏时显示窗口轮廓
- 歌曲选择界面（MusicView）重构，支持在线音乐根/详情视图切换
- 网易云请求全部改为 async + spawn_blocking，不再阻塞 UI 线程
- 封面/歌词本地缓存，减少重复网络请求
- 缩略图缓存系统，支持虚拟滚动列表

### 修复

- 音效开启后无声/需要重启的问题（CORS preload + crossOrigin 联动修复）
- 桌面歌词窗口无法拖动（恢复整窗拖拽，`@dblclick.prevent` 拦截最大化）
- 桌面歌词顶部控制栏遮挡歌词（展开时歌词区自动下移）
- 鼠标移出控制栏不隐藏（延迟隐藏 + 窗口失焦监听）
- 桌面歌词默认不显示下一句，设置中可开启
- 桌面歌词右键菜单被窗口截断（已移除，改为设置页调节）
- 百宝箱页面 i18n 键名错误导致不显示中文
- Tauri 自定义 headers 配置无效导致 tauri build 校验失败
- 网易云扫码登录流程：QR 状态轮询、域名切换、匿名身份注册
- 网易云风控：weapi 双层 AES 层序修正、RSA 无填充加密、请求头注入中国 IP
- 网易云请求适用性：native-tls(schannel) + HTTP/1.1 解决空 body 问题
- 网易云命令异步化，消除 UI 冻结
- 在线音乐封面/歌词缓存
- QQ 歌词请求被 http 插件权限拦截
- 网易云响应解析容错（unikey 字段兼容两种结构）
- 代理未运行时网易云/WebDAV 连接失败
- EPUB 目录章节跳转改用 spine 索引
- CI release 安装包缺失（artifact 嵌套目录递归 glob）

### 技术变更

- 升级 Tauri 2 窗口/事件 API
- 新增桌面歌词事件同步机制（主窗口 ↔ 子窗口）
- 新增预设仓库独立 GitHub 仓库，JSON 格式索引，CI 自动生成
- 网易云签名加密全栈 Rust 实现（aes/cbc/ecb/rsa/x25519/aes-gcm/hmac-sha256）
- SQLite 数据库索引，支持增量扫描
- FFmpeg 集成：视频缩略图、时长、分辨率解析
- 全局快捷键插件
- Windows 系统媒体控件（SMTC）集成
- 项目许可协议改为 GPL-3.0