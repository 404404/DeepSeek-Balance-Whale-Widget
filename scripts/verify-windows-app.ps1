param(
  [Parameter(Mandatory = $true)][string]$AppDir,
  [Parameter(Mandatory = $true)][ValidateSet('x64', 'arm64')][string]$Arch,
  [Parameter(Mandatory = $true)][string]$Version
)
$ErrorActionPreference = 'Stop'
$AppDir = (Resolve-Path -LiteralPath $AppDir).Path
$Exe = Join-Path $AppDir 'AI Balance Whale.exe'
$Asar = Join-Path $AppDir 'resources\app.asar'
$ShareHelper = Join-Path $AppDir 'resources\whale-share.exe'
foreach ($Required in @($Exe, $Asar, $ShareHelper)) {
  if (-not (Test-Path -LiteralPath $Required -PathType Leaf)) { throw "Packaged file missing: $Required" }
}
function Get-PeMachine([string]$Path) {
  $Stream = [IO.File]::OpenRead($Path)
  try {
    $Reader = [IO.BinaryReader]::new($Stream)
    if ($Reader.ReadUInt16() -ne 0x5A4D) { throw "Not a PE executable: $Path" }
    $Stream.Position = 0x3c
    $PeOffset = $Reader.ReadInt32()
    if ($PeOffset -lt 0 -or $PeOffset + 6 -gt $Stream.Length) { throw "Invalid PE header: $Path" }
    $Stream.Position = $PeOffset
    if ($Reader.ReadUInt32() -ne 0x00004550) { throw "Invalid PE signature: $Path" }
    return $Reader.ReadUInt16()
  } finally { $Stream.Dispose() }
}
$ExpectedMachine = if ($Arch -eq 'x64') { 0x8664 } else { 0xAA64 }
foreach ($Path in @($Exe, $ShareHelper)) {
  $Machine = Get-PeMachine $Path
  if ($Machine -ne $ExpectedMachine) { throw ("PE architecture mismatch for {0}: 0x{1:X4}, expected 0x{2:X4}" -f $Path, $Machine, $ExpectedMachine) }
}
$Npx = Get-Command npx.cmd -ErrorAction SilentlyContinue
if (-not $Npx) { throw 'npx.cmd unavailable; cannot inspect app.asar' }
$Entries = & $Npx.Source --no-install asar list $Asar
if ($LASTEXITCODE -ne 0) { throw 'Unable to list packaged app.asar' }
$NormalizedEntries = @($Entries | ForEach-Object { ([string]$_).TrimStart([char[]]@([char]'/', [char]'\')).Replace('\', '/') })
foreach ($Entry in @('assets/DSniang1.png', 'assets/whale-widget.js', 'desktop/ui/widget.html', 'desktop/standalone-main.cjs', 'desktop/preload.cjs', 'desktop/drop-paths.cjs', 'desktop/drop-action.cjs', 'desktop/quick-chat-window.cjs', 'desktop/quick-chat-config.cjs', 'runtime/dispatcher.mjs')) {
  if (-not ($NormalizedEntries -contains $Entry)) { throw "Missing packaged app resource: $Entry" }
}
$ElectronVersion = (Get-Content -Raw -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) 'node_modules\electron\package.json') | ConvertFrom-Json).version
$FileVersion = (Get-Item -LiteralPath $Exe).VersionInfo.ProductVersion
if ($FileVersion -and -not $FileVersion.StartsWith($Version, [StringComparison]::OrdinalIgnoreCase)) { throw "App version metadata mismatch: $FileVersion != $Version" }
Write-Output "verified Windows App=$AppDir arch=$Arch version=$Version electron=$ElectronVersion exe-machine=0x$('{0:X4}' -f (Get-PeMachine $Exe)) helper-machine=0x$('{0:X4}' -f (Get-PeMachine $ShareHelper))"
