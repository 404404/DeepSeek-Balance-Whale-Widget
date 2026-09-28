$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Dist = Join-Path $Root 'dist'
$Packaged = Join-Path $Dist 'desktop-demo-win32-x64'
$Exe = Join-Path $Packaged 'desktop-demo.exe'
$Out = Join-Path $Root 'qa-output\windows-desktop-demo-smoke'
$Data = Join-Path $Out 'data'
$EvidencePath = Join-Path $Data 'desktop-demo-smoke.json'
$LogPath = Join-Path $Out 'desktop-demo.log'
$ErrorPath = Join-Path $Out 'desktop-demo-error.log'
if (-not (Test-Path $Exe -PathType Leaf)) { throw "Packaged desktop-demo.exe is missing: $Exe" }
if (Test-Path $Out) { Remove-Item $Out -Recurse -Force }
New-Item -ItemType Directory -Path $Data -Force | Out-Null
$env:DESKTOP_DEMO_TEST = '1'
$env:DESKTOP_DEMO_HOME = $Data
$env:GITHUB_SHA = (& git rev-parse HEAD).Trim()
$Process = $null
try {
  $Process = Start-Process -FilePath $Exe -ArgumentList @('--desktop-demo-render-test', '--desktop-demo-smoke', "--desktop-demo-data=$Data", '--enable-logging=stderr') -PassThru -RedirectStandardOutput $LogPath -RedirectStandardError $ErrorPath
  $Deadline = (Get-Date).AddMinutes(3)
  while ((Get-Date) -lt $Deadline -and -not (Test-Path $EvidencePath)) {
    Start-Sleep -Seconds 1
    if ($Process.HasExited) { Start-Sleep -Seconds 2; break }
  }
  if (-not (Test-Path $EvidencePath)) {
    if (Test-Path $LogPath) { Get-Content $LogPath -Tail 160 | Write-Host }
    if (Test-Path $ErrorPath) { Get-Content $ErrorPath -Tail 160 | Write-Host }
    foreach ($Name in @('desktop-error.json', 'bridge-error.json', 'renderer-gone.json', 'renderer-errors.json', 'startup-timings.json')) {
      $Path = Join-Path $Data $Name
      if (Test-Path $Path) { Write-Host "--- $Name ---"; Get-Content $Path | Write-Host }
    }
    throw 'Packaged Windows smoke did not produce evidence within three minutes.'
  }
  foreach ($Name in @('desktop-error.json', 'renderer-gone.json', 'renderer-errors.json')) {
    if (Test-Path (Join-Path $Data $Name)) { throw "Packaged Windows smoke reported $Name." }
  }
  $Evidence = Get-Content $EvidencePath -Raw | ConvertFrom-Json
  if ($Evidence.version -ne 'desktop-demo-smoke-1' -or $Evidence.pass -ne $true -or $Evidence.syntheticInputOnly -ne $true) { throw "Packaged Windows interaction smoke failed: $($Evidence | ConvertTo-Json -Depth 8 -Compress)" }
  foreach ($Key in @('finderNativeDropValidated', 'physicalImeValidated', 'mousePassthroughValidated')) {
    if ($Evidence.$Key -ne $false) { throw "Smoke evidence incorrectly claims physical OS validation for $Key." }
  }
  $Expected = @(
    'demo-controller-loaded-in-packaged-renderer', 'hover-controls-stack-vertically',
    'settings-dialog-hides-hover-controls', 'message-button-and-chat-panel-geometry',
    'ime-composition-and-shift-enter-do-not-submit', 'selected-model-and-local-chat-reply',
    'multiple-attachments-render-with-type-and-size', 'attachment-only-chat-message',
    'file-drop-opens-choice-surface', 'send-to-chat-queues-file-without-auto-send',
    'avatar-switches-during-drag-state', 'persisted-custom-received-image-loads-in-avatar',
    'assistant-route-opens-a-task-card', 'assistant-task-enters-waiting-state',
    'assistant-task-enters-processing-state', 'assistant-task-completes-with-local-demo-result',
    'closing-task-restores-default-avatar-state', 'drop-image-route-opens-state-assignment',
    'state-image-settings-shows-saved-preview', 'state-image-persistence-does-not-save-source-path'
  )
  $Steps = @{}; foreach ($Step in $Evidence.steps) { $Steps[$Step.name] = $Step }
  foreach ($Name in $Expected) { if (-not $Steps.ContainsKey($Name) -or $Steps[$Name].pass -ne $true) { throw "Windows interaction assertion failed or is missing: $Name" } }
  if ($Evidence.screenshots.Count -lt 6) { throw 'Windows smoke produced fewer than six screenshots.' }
  $Screens = Join-Path $Data 'desktop-demo-screenshots'
  foreach ($Name in $Evidence.screenshots) {
    $Shot = Join-Path $Screens $Name
    if (-not (Test-Path $Shot -PathType Leaf) -or (Get-Item $Shot).Length -lt 1024) { throw "Smoke screenshot is missing or empty: $Shot" }
  }
  Write-Host "Packaged Windows desktop-demo smoke passed: $($Expected.Count) assertions, $($Evidence.screenshots.Count) screenshots; synthetic Electron/DOM input only."
} finally {
  if ($Process -and -not $Process.HasExited) {
    & taskkill.exe /PID $Process.Id /T /F 2>$null | Out-Null
  }
  Remove-Item Env:DESKTOP_DEMO_TEST -ErrorAction SilentlyContinue
  Remove-Item Env:DESKTOP_DEMO_HOME -ErrorAction SilentlyContinue
}
