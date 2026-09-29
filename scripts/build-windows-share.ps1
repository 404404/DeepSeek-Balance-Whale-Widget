param(
  [Parameter(Mandatory = $true)][ValidateSet('x64', 'arm64')][string]$Arch,
  [string]$Output = ''
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
if (-not $Output) { $Output = Join-Path $Root "build\windows-$Arch\whale-share.exe" }
$ActualTargetArch = switch -Regex ($env:VSCMD_ARG_TGT_ARCH) {
  '^(amd64|x64)$' { 'x64'; break }
  '^arm64$' { 'arm64'; break }
  default { '' }
}
if (-not $ActualTargetArch) { throw "MSVC target architecture is not configured (VSCMD_ARG_TGT_ARCH='$env:VSCMD_ARG_TGT_ARCH')" }
if ($ActualTargetArch -ne $Arch) { throw "MSVC target architecture is $ActualTargetArch, expected $Arch" }
$Source = Join-Path $Root 'desktop\native\windows-share.cpp'
if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) { throw "Missing native helper source: $Source" }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Output) | Out-Null
$Compiler = Get-Command cl.exe -ErrorAction SilentlyContinue
if (-not $Compiler) { throw 'cl.exe is unavailable; run this script from a Visual Studio Developer environment' }
$Args = @(
  '/nologo', '/EHsc', '/std:c++20', '/O2', '/MT', '/utf-8',
  '/DUNICODE', '/D_UNICODE', '/DWIN32_LEAN_AND_MEAN',
  $Source, "/Fe:$Output", '/link', 'windowsapp.lib', 'runtimeobject.lib', 'ole32.lib', 'shell32.lib'
)
& $Compiler.Source @Args
if ($LASTEXITCODE -ne 0) { throw "C++/WinRT helper compilation failed with exit code $LASTEXITCODE" }
if (-not (Test-Path -LiteralPath $Output -PathType Leaf)) { throw 'Native share helper output is missing' }
$Hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Output).Hash.ToLowerInvariant()
Write-Output "native helper arch=$Arch path=$Output sha256=$Hash"
