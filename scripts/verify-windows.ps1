$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $Root
function Get-DesktopDemoSha256([string] $Path) {
  $Hasher = [System.Security.Cryptography.SHA256]::Create()
  $Stream = [System.IO.File]::OpenRead($Path)
  try { return ([BitConverter]::ToString($Hasher.ComputeHash($Stream))).Replace('-', '').ToLowerInvariant() }
  finally { $Stream.Dispose(); $Hasher.Dispose() }
}
$Dist = Join-Path $Root 'dist'
$BuildInfoPath = Join-Path $Dist 'desktop-demo-build-info.txt'
if (-not (Test-Path $BuildInfoPath -PathType Leaf)) { throw 'desktop-demo-build-info.txt is missing.' }
$BuildInfo = @{}
Get-Content $BuildInfoPath | ForEach-Object {
  $Pair = $_ -split '=', 2
  if ($Pair.Count -eq 2) { $BuildInfo[$Pair[0]] = $Pair[1] }
}
if ($BuildInfo.product -ne 'desktop-demo' -or $BuildInfo.architecture -ne 'x64') { throw 'Build identity does not describe desktop-demo Windows x64.' }
$Packaged = Join-Path $Dist 'desktop-demo-win32-x64'
$Exe = Join-Path $Packaged 'desktop-demo.exe'
$Asar = Join-Path $Packaged 'resources\app.asar'
if (-not (Test-Path $Exe -PathType Leaf)) { throw "desktop-demo.exe is missing: $Exe" }
if (-not (Test-Path $Asar -PathType Leaf)) { throw "resources/app.asar is missing: $Asar" }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$AsarFiles = & npx.cmd --no-install asar list $Asar
if ($LASTEXITCODE -ne 0) { throw 'Could not read resources/app.asar.' }
$Required = @(
  'desktop/desktop-demo-main.cjs', 'desktop/standalone-main.cjs', 'desktop/preload.cjs',
  'desktop/ui/widget.html', 'desktop/ui/desktop-demo.css', 'desktop/ui/desktop-demo-model.js',
  'desktop/ui/desktop-demo.js', 'assets/desktop-demo-dragging.svg', 'assets/desktop-demo-received.svg',
  'assets/desktop-demo-processing.svg', 'assets/desktop-demo-complete.svg',
  'lib/desktop-demo-state-images.mjs', 'runtime/dispatcher.mjs'
)
foreach ($Path in $Required) {
  if (-not ($AsarFiles -match [regex]::Escape($Path))) { throw "Packaged resource is missing: $Path" }
}
if ($AsarFiles -match 'desktop/follow-main\.cjs') { throw 'The Windows standalone app must not package the legacy Codex-following host.' }
$Archive = Get-ChildItem $Dist -Filter 'desktop-demo-*-windows-x64-*.zip' | Select-Object -First 1
if (-not $Archive) { throw 'Windows portable ZIP is missing.' }
$ChecksumPath = "$($Archive.FullName).sha256"
if (-not (Test-Path $ChecksumPath -PathType Leaf)) { throw 'Windows portable ZIP checksum is missing.' }
$ExpectedDigest = (Get-Content $ChecksumPath -Raw).Trim().Split(' ')[0]
$ActualDigest = Get-DesktopDemoSha256 $Archive.FullName
if ($ExpectedDigest -ne $ActualDigest) { throw 'Windows portable ZIP checksum does not match.' }
$Zip = [System.IO.Compression.ZipFile]::OpenRead($Archive.FullName)
try {
  if (-not ($Zip.Entries.FullName -contains 'desktop-demo-win32-x64/desktop-demo.exe')) { throw 'ZIP does not contain desktop-demo.exe.' }
  if (-not ($Zip.Entries.FullName -contains 'desktop-demo-win32-x64/resources/app.asar')) { throw 'ZIP does not contain resources/app.asar.' }
} finally { $Zip.Dispose() }
Write-Host "Verified desktop-demo Windows x64 package $($BuildInfo.version), SHA-256 $ActualDigest"
