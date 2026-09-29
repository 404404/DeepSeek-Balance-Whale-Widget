param(
  [Parameter(Mandatory = $true)][string]$AppDir,
  [Parameter(Mandatory = $true)][ValidateSet('x64', 'arm64')][string]$Arch,
  [Parameter(Mandatory = $true)][string]$OutputDir,
  [string]$Installer = '',
  [string]$PortableZip = ''
)
$ErrorActionPreference = 'Stop'
$AppDir = (Resolve-Path -LiteralPath $AppDir).Path
$OutputDir = [IO.Path]::GetFullPath($OutputDir)
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$Exe = Join-Path $AppDir 'AI Balance Whale.exe'
if (-not (Test-Path -LiteralPath $Exe -PathType Leaf)) { throw "Packaged executable missing: $Exe" }

function Invoke-PackagedCase([string]$Label, [double]$Scale, [bool]$Legacy, [string]$Executable) {
  $Data = Join-Path $OutputDir "data-$Label"
  New-Item -ItemType Directory -Force -Path $Data | Out-Null
  Set-Content -LiteralPath (Join-Path $Data '.dshw-size.json') -Encoding utf8 -Value (@{ scale = $Scale; sound = $true; vol = 0.9; soundSet = 'duck'; bubbleOn = $true } | ConvertTo-Json -Compress)
  if ($Legacy) {
    Set-Content -LiteralPath (Join-Path $Data 'window-state.json') -Encoding utf8 -Value '{"version":1,"frame":{"x":100,"y":100,"width":248,"height":274}}'
  }
  $Info = [Diagnostics.ProcessStartInfo]::new()
  $Info.FileName = $Executable
  $Info.UseShellExecute = $false
  $Info.RedirectStandardOutput = $true
  $Info.RedirectStandardError = $true
  foreach ($Arg in @('--standalone', '--whale-render-test', '--whale-interaction-test', "--whale-data=$Data")) { [void]$Info.ArgumentList.Add($Arg) }
  $Info.Environment['WHALE_DESKTOP_TEST'] = '1'
  $Info.Environment['WHALE_HOME'] = $Data
  $Info.Environment['ELECTRON_ENABLE_LOGGING'] = '1'
  $Process = [Diagnostics.Process]::new()
  $Process.StartInfo = $Info
  [void]$Process.Start()
  $StdoutTask = $Process.StandardOutput.ReadToEndAsync()
  $StderrTask = $Process.StandardError.ReadToEndAsync()
  try {
    $Deadline = [DateTime]::UtcNow.AddSeconds(90)
    $EvidencePath = Join-Path $Data 'interaction-test.json'
    while ([DateTime]::UtcNow -lt $Deadline -and -not (Test-Path -LiteralPath $EvidencePath)) {
      if ($Process.HasExited) { throw "Packaged app exited early ($($Process.ExitCode)); stdout=$($StdoutTask.Result); stderr=$($StderrTask.Result)" }
      Start-Sleep -Milliseconds 250
    }
    if (-not (Test-Path -LiteralPath $EvidencePath)) { throw "Packaged app timed out; stdout=$($StdoutTask.Result); stderr=$($StderrTask.Result)" }
    $Evidence = Get-Content -Raw -LiteralPath $EvidencePath | ConvertFrom-Json
    if (-not $Evidence.pass) { throw "Interaction test failed: $($Evidence | ConvertTo-Json -Depth 30 -Compress)" }
    if ($Evidence.osPointerValidated -ne $false) { throw 'Synthetic Electron input must not claim native OS-pointer validation' }
    if ($Evidence.steps | Where-Object { -not $_.pass }) { throw 'One or more required packaged interaction steps failed' }
    foreach ($Name in @('desktop-error.json', 'renderer-gone.json', 'renderer-errors.json')) {
      if (Test-Path -LiteralPath (Join-Path $Data $Name)) { throw "Packaged runtime emitted $Name" }
    }
    $RuntimePath = Join-Path $Data 'runtime-environment.json'
    if (-not (Test-Path -LiteralPath $RuntimePath)) { throw 'Packaged runtime architecture evidence missing' }
    $Runtime = Get-Content -Raw -LiteralPath $RuntimePath | ConvertFrom-Json
    if ($Runtime.arch -ne $Arch) { throw "Electron runtime arch $($Runtime.arch) != target $Arch" }
    if (-not [string]::Equals([IO.Path]::GetFullPath($Runtime.executablePath), [IO.Path]::GetFullPath($Executable), [StringComparison]::OrdinalIgnoreCase)) { throw "Packaged executable path mismatch: runtime=$($Runtime.executablePath) expected=$Executable" }
    $Layout = Get-Content -Raw -LiteralPath (Join-Path $Data 'layout-diagnostic.json') | ConvertFrom-Json
    if ($Layout.image.complete -ne $true -or $Layout.image.naturalWidth -le 0 -or $Layout.image.naturalHeight -le 0) { throw "Packaged role image did not decode: $($Layout.image | ConvertTo-Json -Compress)" }
    if ($Layout.root.display -eq 'none' -or $Layout.root.visibility -eq 'hidden' -or [double]$Layout.root.opacity -le 0) { throw "Packaged role root is hidden: $($Layout.root | ConvertTo-Json -Compress)" }
    $Routing = Get-Content -Raw -LiteralPath (Join-Path $Data 'input-routing.json') | ConvertFrom-Json
    if ($Routing.mode -ne 'native-screen-hit-region' -or -not $Routing.hitRegions -or -not ($Routing.hitRegions | Where-Object { $_.width -ge 50 -and $_.height -ge 50 })) { throw "Packaged native hit routing lacks the role region: $($Routing | ConvertTo-Json -Compress)" }
    $Startup = Get-Content -Raw -LiteralPath (Join-Path $Data 'startup-timings.json') | ConvertFrom-Json
    foreach ($Phase in @('appReady', 'dispatcherReady', 'windowCreated', 'pageLoaded', 'imageAndInputReady', 'interactive')) { if ($null -eq $Startup.phases.$Phase) { throw "Packaged startup phase missing: $Phase" } }
    $Expected = [Math]::Max(122, [Math]::Min(625, 250 * $Scale))
    if ([Math]::Abs($Layout.root.width - $Expected) -gt 3 -or [Math]::Abs($Layout.root.height - $Expected) -gt 3) { throw "Widget layout does not match scale=$Scale: $($Layout.root | ConvertTo-Json -Compress)" }
    if ($Legacy -and ($Layout.nativeFrame.width -lt 300 -or $Layout.nativeFrame.height -lt 300)) { throw "Legacy 248x274 window was not migrated: $($Layout.nativeFrame | ConvertTo-Json -Compress)" }
    foreach ($Image in @($Evidence.screenshots)) { if (-not (Test-Path -LiteralPath $Image -PathType Leaf)) { throw "Packaged interaction screenshot missing: $Image" } }
    $TestOutput = [pscustomobject]@{ label = $Label; arch = $Arch; scale = $Scale; legacyFrame = $Legacy; pass = $true; evidence = $Evidence; layout = $Layout; runtime = $Runtime }
    $TestOutput | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath (Join-Path $Data 'windows-smoke-result.json') -Encoding utf8
    Write-Output "packaged Windows smoke passed: case=$Label target=$Arch electron=$($Runtime.electron) scale=$Scale"
  } finally {
    if (-not $Process.HasExited) { $Process.Kill($true); [void]$Process.WaitForExit(10000) }
    $Process.Dispose()
  }
}

Invoke-PackagedCase "app-$Arch" 1.5 $true $Exe
if ($PortableZip) {
  if (-not (Test-Path -LiteralPath $PortableZip -PathType Leaf)) { throw "Portable ZIP missing: $PortableZip" }
  $PortableRoot = Join-Path $OutputDir 'portable extraction with spaces'
  if (Test-Path -LiteralPath $PortableRoot) { Remove-Item -LiteralPath $PortableRoot -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $PortableRoot | Out-Null
  Expand-Archive -LiteralPath $PortableZip -DestinationPath $PortableRoot -Force
  Invoke-PackagedCase "portable-$Arch" 1.5 $true $PortableRoot
}
if ($Installer) {
  $InstallRoot = Join-Path $OutputDir 'installer-test'
  if (Test-Path -LiteralPath $InstallRoot) { Remove-Item -LiteralPath $InstallRoot -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
  $InstallDir = Join-Path $InstallRoot 'Installed App With Spaces'
  $Install = Start-Process -FilePath $Installer -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CURRENTUSER', "/DIR=`"$InstallDir`"") -Wait -PassThru
  if ($Install.ExitCode -ne 0) { throw "Inno install failed: $($Install.ExitCode)" }
  $InstalledExe = Join-Path $InstallDir 'AI Balance Whale.exe'
  if (-not (Test-Path -LiteralPath $InstalledExe -PathType Leaf)) { throw 'Installer did not install the app into the selected path' }
  Invoke-PackagedCase "installed-$Arch" 1.5 $true $InstalledExe
  $Uninstaller = Join-Path $InstallDir 'unins000.exe'
  if (-not (Test-Path -LiteralPath $Uninstaller -PathType Leaf)) { throw 'Uninstaller is missing' }
  $Uninstall = Start-Process -FilePath $Uninstaller -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART') -Wait -PassThru
  if ($Uninstall.ExitCode -ne 0) { throw "Inno uninstall failed: $($Uninstall.ExitCode)" }
  if (Test-Path -LiteralPath $InstallDir) { throw 'Uninstall left the installation directory behind' }
}
