# Cross-platform desktop candidate

This note describes the Electron desktop changes introduced on `for-macdesktop` after the independent macOS widget work. The macOS and Windows targets are separate native Electron bundles; this work does not replace Electron, the upstream widget renderer, or the existing quota/auth services.

## Quick chat

The compact chat button sits directly above the existing settings button and uses the existing widget hit-region reporting. Hover visibility is not an expanded-window signal. The user chooses ChatGPT, Grok, DeepSeek, or a custom HTTPS destination in the existing settings dialog. Custom URLs reject credentials, control characters, and non-HTTPS schemes. The native process validates the IPC sender, requires a recent trusted click, and calls the OS default browser; it does not create an embedded browser, send model prompts, or access quota credentials.

The first button placement and the idea of a separate menu-adjacent hit target were reviewed against fork demo commit `b8a5510` on `demo/macdesktop-quick-chat`. That demo is not used as a product implementation: product routing goes through the settings schema and a narrowly scoped native IPC action.

## Local file sharing

External file drops are accepted only over the role image's hit area. Files dropped on chat/settings controls or editor sorting regions are not shared. The preload uses Electron `webUtils.getPathForFile`; the main process then canonicalizes and checks each path and accepts at most 20 readable regular files. Directories, missing files, and special entries receive explicit rejection results. File contents are not read and there is no upload endpoint in this flow.

- macOS uses Electron `ShareMenu` with real local file paths (`filePaths`) and keeps the native menu callback separate from any claim about send/delivery.
- Windows uses a small native C++/WinRT process. It obtains the window-scoped `DataTransferManager` through `IDataTransferManagerInterop`, registers `DataRequested`, gets a deferral while resolving `StorageFile` values, supplies storage items, and pumps the STA message queue until share completion/cancellation or a bounded timeout. Its `opened` status only means the OS accepted the request; it is not a delivery receipt. The helper is statically linked to the Visual C++ runtime and shipped as an unpacked resource next to `app.asar`.

The helper is built for the same target architecture as Electron. The two Windows builds use native x64 and ARM64 runners. The UI is controlled by an explicit drop state and is returned to its normal hit-test/transparent routing after drop, cancellation, blur, or helper exit. Actual target selection and receiver-side delivery remain OS-user actions and are not covered by headless CI.

## Position ownership

Electron main owns the screen-space window and role-layout anchor. The renderer only reports its role layout box and local hit regions. Resize requests are calculated around the role-layout bottom-center ratio; root geometry and menu/expanded-surface geometry are not persisted as the user's compact widget position. During native drag or expanded editing surfaces, only the latest size request is retained and applied after that state ends. Hovering either side button does not resize the native window.

This is intentionally a small ownership change rather than a renderer rewrite. `desktop/standalone-interaction-model.cjs` supplies pure geometry functions; the packaged interaction harness checks the actual window/controller/renderer reports during repeated scale changes.

## Build and acceptance

The required native matrix is:

| Artifact target | Runner | Product |
| --- | --- | --- |
| `windows-x64` | `windows-2022` | per-user Inno Setup installer + portable ZIP |
| `windows-arm64` | `windows-11-vs2026-arm` | native ARM64 per-user installer + portable ZIP |
| `macos-x64` | `macos-15-intel` | Intel DMG |
| `macos-arm64` | `macos-15` | Apple Silicon DMG |

macOS jobs explicitly select Xcode 16.4 and verify the main executable and Electron Framework architecture, bundle metadata, `app.asar` resources, ad-hoc signature integrity and mounted DMG contents. The bundle short version is the numeric release base (for example `0.3.0`); the legal increasing CFBundleVersion is the CI build number. The prerelease suffix remains in the release tag and asset filenames, not in the Apple bundle version fields.

Windows jobs compile the native helper using the matching MSVC target, inspect the PE machine field for both Electron and helper executables, verify unpacked helper/resource placement and `app.asar`, launch the packaged executable, install to a path containing spaces, launch the installed executable, and uninstall it. Application state is isolated to the test data directory.

Every native job captures its runner/runtime target, app and `app.asar` size, output bytes and SHA-256, plus packaged screenshots and diagnostic JSON. `acceptance-gate` requires all four jobs and verifies artifact records against the downloaded files. Release builds use one resolved full commit SHA for all four targets. A draft Release is only made public after downloading and byte-verifying its assets.

Synthetic Electron input and packaged-app launch are automated evidence, not OS-level physical pointer testing. Headless runner tests also do not prove that a particular share target is installed, can consume every file type, or successfully sends it. Those items require manual testing on native Windows x64/ARM64 and Intel/Apple Silicon Macs. Release notes must preserve these distinctions.

## Security and packaging boundaries

- Quick-chat configuration stores only provider/custom URL/name in the existing app configuration; it has no linkage to subscription Auth.
- Preload exposes `webUtils.getPathForFile` only within the purpose-built `shareDroppedFiles` method; it does not expose general file read/write or shell execution.
- The external URL is revalidated in main and is never opened automatically at startup or after saving.
- File paths are passed as argument-array items to the Windows helper (`shell: false`), not concatenated into a shell command. The helper never prints paths or file content.
- Windows installers are current-user installs and are not Authenticode signed. macOS App bundles are ad-hoc signed but not Developer ID signed or notarized. Neither status is presented as platform trust verification.
- Existing Codex Auth, quota refresh, DeepSeek/API provider configuration, upstream click queue and renderer data remain independent of this feature.
