# AI Balance Whale · Windows 与 macOS 独立桌面挂件

AI Balance Whale 是一只常驻桌面的透明小鲸鱼挂件，沿用上游 `For-Codex` Electron 版本的角色、气泡、连续点击、拖动吸附、翻转、音效、菜单、素材管理和余额编辑器。桌面 App 可独立启动，不需要 Codex、DSH、Node.js 或浏览器才能看见和操作人偶。

本分支基于上游 `MeteorNOX/DeepSeek-Balance-Whale-Widget` 的 `For-Codex` 基线 `8c13a627120a175f6c92b3aeb12c99d392416ac7`。仓库归属与发布链接使用本 fork：<https://github.com/404404/DeepSeek-Balance-Whale-Widget>。

## 桌面版能力

- 新增“快速聊天”按钮，显示在设置按钮上方；可选择 ChatGPT、Grok、DeepSeek 或自定义 HTTPS 网址，在系统默认浏览器打开。此设置与账户额度、API provider 和 Auth 登录无关。
- 从 Finder 或 Windows 文件资源管理器把普通本地文件拖到人偶上，会打开操作系统的分享界面。应用只验证文件路径并交给系统；不读取文件正文、不上传、不移动原文件，也不声称分享已送达。暂不接受文件夹和虚拟附件。
- 独立桌面版覆盖 Windows x64、Windows ARM64、macOS Intel x64 和 macOS Apple Silicon ARM64；Windows 普通安装版独立启动，开发模式保留 Codex-follow 脚本入口。
- macOS App 兼容下限为 macOS 11（由当前 Electron 36 runtime 决定）；Windows Share UI 需要受支持的 Windows 桌面环境。

角色和编辑器仍使用仓库里的上游 `assets/whale-widget.js` 与原有配置，不用 demo 对话页面替换。聊天按钮的相对位置、按钮命中和显隐参考 fork 的 `demo/macdesktop-quick-chat`（`b8a5510`），但真实产品按钮通过正式设置及受控原生桥接打开外部网站，不带入 demo overlay。

余额功能保留上游 API 余额模式：账单接口、New API/One API、自定义 JSON、DeepSeek 等适配；没有配置时显示未知或不可查询，不伪造余额。此改动不调整现有 Codex/其他订阅 Auth。

桌面位置和缩放由 Electron 原生层维护，人偶布局框底部中心是稳定锚点；按钮 hover 不触发展开窗口。应用数据放在各系统的用户数据目录中，不写入 App Bundle 或安装目录。

## 安装

从 [GitHub Releases](https://github.com/404404/DeepSeek-Balance-Whale-Widget/releases) 下载与你的系统和处理器架构匹配的 Windows 安装包／便携 ZIP，或 macOS Intel／Apple Silicon DMG。DMG 将 App 拖到 `Applications` 后启动。当前 macOS 包为 ad-hoc 签名、未经 Apple Developer ID 签名和公证；首次打开若被系统拦截，可按 Apple 的“打开被阻止的 App”流程从“隐私与安全性”中确认，不要关闭 Gatekeeper。Windows 安装包目前未做 Authenticode 签名。

DMG 内含 `Applications` 快捷方式；Windows 安装包按当前用户安装，不要求管理员权限。

## 使用

启动后人偶会出现在当前主屏幕右下角：

- 左键点击：按当前上游点击队列显示/推进气泡；
- 按住并拖动：移动原生窗口，松开后保存位置；
- 人偶菜单按钮或右键：打开上游菜单和编辑器；
- 人偶上方聊天图标：打开设置页选定的聊天网站；
- 从系统文件管理器拖文件到角色身体：打开原生分享界面，发送目标由用户选择；
- 菜单栏图标：显示/隐藏、打开设置、恢复人偶位置、退出；
- 缩放、角色、音效、气泡内容、资源和账本继续使用上游设置与数据结构。

没有 Codex 或没有 API 配置时，人偶、菜单、随机语句、图片、音效和编辑器仍可使用；余额只显示“未配置/不可查询/未知”，不会把失败变成 0。

## 本地开发

Node.js 24 仅用于开发和打包，安装后的 App 自带 Electron 运行时：

```bash
npm install
npm test
npm run desktop
```

`npm run desktop` 在 macOS 上启动独立模式；Windows 开发模式仍进入上游保留的跟随模式，已打包 Windows App 默认独立启动。开发数据目录可用 `WHALE_HOME=/path/to/data` 或 `--whale-data=/path/to/data` 隔离。Windows 原生分享 helper 用 Visual Studio C++/WinRT 编译（见下文）；不要求终端用户安装 Node 或开发工具。不要把真实密钥、账本或用户素材提交到仓库。

## 打包与验证

```bash
npm ci
npm test
ARCH=x64 npm run build:mac       # 或 ARCH=arm64
ARCH=x64 npm run verify:mac
ARCH=x64 bash scripts/create-dmg.sh
ARCH=x64 bash scripts/smoke-mac-app.sh 'dist/AI Balance Whale.app'
```

Windows 打包需在对应原生架构的 Visual Studio Developer 环境中运行：

```powershell
./scripts/build-windows-share.ps1 -Arch x64 # ARM64 runner 使用 -Arch arm64
./scripts/build-windows.ps1 -Arch x64 -Version 0.3.0-beta.1
./scripts/smoke-windows-app.ps1 -AppDir 'dist/windows-x64/AI Balance Whale-win32-x64' -Arch x64 -OutputDir 'qa-output/windows-x64' -Installer 'dist/windows-x64/AI-Balance-Whale-windows-x64-v0.3.0-beta.1-setup.exe'
```

`npm test` 包含语法、坐标模型、HTTPS 设置校验、文件路径拒绝规则、macOS ShareMenu／Windows helper 注入契约以及现有额度 Auth 回归。打包 smoke 会启动实际 `.app`／`.exe`，检查角色资源、命中区域、配置旧版窗口迁移、聊天按钮一次打开、快速连点与 20 轮同进程缩放；Windows 还测试安装到含空格路径后运行与卸载，macOS 验证 DMG 可挂载。`sendInputEvent` 是合成 Electron 输入，不是 OS 物理鼠标验收；GitHub-hosted runner 不验证系统分享面板中目标 App 的真实选择或文件收件结果。smoke 截图与诊断将作为 Actions artifacts 上传。Electron/Chromium 仍是安装包主体积，本次只报告体积，不移除运行时功能。

GitHub Actions：

- `Cross-platform desktop acceptance` 对 PR 与开发分支运行行为测试，并分别在 `windows-2022`、`windows-11-vs2026-arm`、`macos-15-intel`、`macos-15` 原生 runner 上构建、启动最终包和运行打包检查；Mac runner 固定选择 Xcode 16.4，Node 固定 24.8.0。
- `Cross-platform desktop prerelease` 接受 `desktop-v*` 标签和手动输入；发布矩阵先解析单一源 SHA，全部四架构验收后才制作 draft Release，校验远程资产后公开。
- PR/普通 CI 只有 `contents: read`，没有真实 Auth 凭据或签名 secrets；Windows 安装包与 macOS App 当前均未做正式开发者签名/公证。此仓库不向 npm 发布。

更细的结构和验收记录见：

- [macOS 独立模式说明](docs/MACOS-STANDALONE.md)
- [上游迁移记录](docs/UPSTREAM-MIGRATION.md)
- [macOS 验证清单](docs/MACOS-VERIFICATION.md)
- [跨平台桌面、快速聊天与文件分享](docs/CROSS-PLATFORM-DESKTOP.md)
- [来源与许可](PROVENANCE.md)

## 数据与安全

应用只在本机 Application Support 目录保存设置、窗口状态、账本和导入素材。余额 provider 使用用户明确配置的接口和环境变量；密钥不写入普通设置、日志或构建产物。独立模式的 Unix socket 只用于本应用自己的本地控制，带随机 token 并限制为本机权限。

本阶段不读取浏览器 Cookie、不修改 Codex `auth.json`/`config.toml`，也不要求辅助功能、屏幕录制或完全磁盘访问权限。

## 来源与许可

代码与宿主改造沿用上游 MIT 许可和作者归属。`assets/` 中的角色、动图和音效按上游实际说明随项目分发，不额外主张为原创或授予超出原授权范围的再许可；第三方声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。感谢 MeteorNOX 及上游贡献者。
