# desktop-demo

`desktop-demo` 是一个可独立运行的 macOS 与 Windows 桌面人偶 Demo。它保留上游小鲸鱼角色、气泡、点击、拖动、吸附、翻转、音效、菜单、素材管理和余额编辑器，并增加本地模拟的聊天、附件分流、助手任务状态和人偶交互图片演示。

代码改编自 [MeteorNOX/DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget) 的 For-Codex Electron 版本。当前 fork 仓库仍为 [404404/DeepSeek-Balance-Whale-Widget](https://github.com/404404/DeepSeek-Balance-Whale-Widget)。

## 下载

[打开 desktop-demo Releases](https://github.com/404404/DeepSeek-Balance-Whale-Widget/releases) 获取最新版本：

- macOS 14+ Apple Silicon：下载 `desktop-demo-…-macos-arm64-….dmg`；Intel Mac：下载 `desktop-demo-…-macos-x64-….dmg`。将 `desktop-demo.app` 拖进“应用程序”。两个构建均使用 ad-hoc 签名，未经 Apple 公证；首次打开时请在 Finder 中右键 App 并选择“打开”。
- Windows x64：下载 `desktop-demo-…-windows-x64-….zip`，解压后运行 `desktop-demo-win32-x64/desktop-demo.exe`。这是便携应用目录，EXE 需要同目录 Electron 运行时文件；Windows 构建未签名。

两个平台的 Release 都附带 SHA-256 校验文件。

## 演示功能

- 本地快速聊天：模拟快速对话与深度思考状态，不连接真实模型。
- 附件演示：选择或拖入文件、展示类型与大小、发送到聊天或交给演示助手流程；不会读取普通附件内容或上传文件。
- 助手任务卡：展示等待、处理中和完成状态。
- 人偶状态图片：支持导入 PNG、JPEG、WebP，并将复制后的图片保存在应用数据目录。
- 原有角色、气泡、点击、拖动、吸附、翻转、音效、菜单和余额编辑器继续可用。

人偶和编辑器不需要 Codex、DSH、Node.js 或浏览器即可启动。余额只使用用户显式配置的 provider；没有配置时显示未配置或不可查询，不伪造数值。Demo 聊天和任务流程仅用于交互演示。

## 开发

需要 Node.js 24+：

```bash
npm ci
npm test
npm run desktop
```

开发模式也可以用 `DESKTOP_DEMO_HOME=/path/to/data` 或 `--desktop-demo-data=/path/to/data` 隔离数据。不要把密钥、账本或用户素材提交到仓库。

## 本地构建

```bash
npm run build:mac
npm run verify:mac
bash scripts/create-dmg.sh
npm run build:windows
npm run verify:windows
```

macOS 包为 arm64 与 x86_64 `.app`/DMG；Windows 包为 x64 Electron 便携目录 ZIP，入口是 `desktop-demo.exe`。GitHub Actions 会分别在 Apple Silicon、Intel macOS 与 Windows runner 上构建、启动和验证应用，并只在所有目标都通过后创建同一个 `desktop-demo` prerelease。

## 数据与安全

应用将设置、窗口位置、账本和导入素材保存在系统应用数据目录下的 `desktop-demo` 文件夹。独立桌面模式不会读取浏览器 Cookie，也不会改写 Codex `auth.json` 或 `config.toml`；它不要求辅助功能、屏幕录制或完全磁盘访问权限。

## 来源与许可

代码沿用上游 MIT 许可和作者归属。角色、动图和音效依照上游声明随项目分发；第三方声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。感谢 MeteorNOX 与上游贡献者。
