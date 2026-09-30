param(
  [Parameter(Mandatory = $true)][ValidateSet('x64', 'arm64')][string]$Arch,
  [string]$Version = '',
  [string]$BuildNumber = '1',
  [string]$OutputDir = ''
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Root
if (-not $Version) { $Version = (Get-Content -Raw -LiteralPath (Join-Path $Root 'package.json') | ConvertFrom-Json).version }
if ($Version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') { throw "Invalid app version: $Version" }
if ($BuildNumber -notmatch '^\d+$') { throw 'BuildNumber must be a non-negative integer' }
if (-not $OutputDir) { $OutputDir = Join-Path $Root "dist\windows-$Arch" }
$OutputDir = [IO.Path]::GetFullPath($OutputDir)
$Helper = Join-Path $Root "build\windows-$Arch\whale-share.exe"
$AppDir = Join-Path $OutputDir "AI Balance Whale-win32-$Arch"
$PackagerScratch = Join-Path $OutputDir '.packager'
$PortableZip = Join-Path $OutputDir "AI-Balance-Whale-windows-$Arch-v$Version-portable.zip"
$Installer = Join-Path $OutputDir "AI-Balance-Whale-windows-$Arch-v$Version-setup.exe"
$Node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $Node) { throw 'node.exe is unavailable' }
$PackagerCli = Join-Path $Root 'node_modules\electron-packager\bin\electron-packager.js'
if (-not (Test-Path -LiteralPath $PackagerCli -PathType Leaf)) { throw "Locked electron-packager CLI is missing: $PackagerCli" }
$Iscc = Get-Command ISCC.exe -ErrorAction SilentlyContinue
if (-not $Iscc) { throw 'ISCC.exe is required (install Inno Setup on the build runner)' }
if (-not (Test-Path -LiteralPath $Helper -PathType Leaf)) { throw "Compiled native share helper missing: $Helper" }
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
if (Test-Path -LiteralPath $PackagerScratch) { Remove-Item -LiteralPath $PackagerScratch -Recurse -Force }
& $Node.Source $PackagerCli . 'AI Balance Whale' `
  "--platform=win32" "--arch=$Arch" "--out=$PackagerScratch" '--overwrite' '--asar' '--prune=true' `
  "--app-version=$Version" "--build-version=$BuildNumber" '--executable-name=AI Balance Whale' `
  "--extra-resource=$Helper" `
  '--version-string.CompanyName=404404' '--version-string.ProductName=AI Balance Whale' `
  '--ignore=^dist(/|$)|(^|/)(\.git|\.github|build|qa-output|tests|docs|scripts|skills)(/|$)|(^|/)(desktop/(follow-main\.cjs|WindowApi\.cs|WhaleLauncher\.cs|supervisor\.ps1|native/windows-share\.cpp|mac-info\.plist)|assets/DSH2\.png|package-lock\.json)'
if ($LASTEXITCODE -ne 0) { throw "electron-packager failed with exit code $LASTEXITCODE" }
$PackagedApp = Join-Path $PackagerScratch "AI Balance Whale-win32-$Arch"
if (-not (Test-Path -LiteralPath $PackagedApp -PathType Container)) { throw "Packaged directory missing: $PackagedApp" }
if (Test-Path -LiteralPath $AppDir) { Remove-Item -LiteralPath $AppDir -Recurse -Force }
Move-Item -LiteralPath $PackagedApp -Destination $AppDir
Remove-Item -LiteralPath $PackagerScratch -Recurse -Force
& (Join-Path $PSScriptRoot 'verify-windows-app.ps1') -AppDir $AppDir -Arch $Arch -Version $Version
if (Test-Path -LiteralPath $PortableZip) { Remove-Item -LiteralPath $PortableZip -Force }
Compress-Archive -Path (Join-Path $AppDir '*') -DestinationPath $PortableZip -CompressionLevel Optimal
& $Iscc.Source "/DAppDir=$AppDir" "/DAppVersion=$Version" "/DAppArch=$Arch" "/DOutputDir=$OutputDir" (Join-Path $PSScriptRoot 'AI-Balance-Whale.iss')
if ($LASTEXITCODE -ne 0) { throw "Inno Setup compilation failed with exit code $LASTEXITCODE" }
if (-not (Test-Path -LiteralPath $Installer -PathType Leaf)) { throw "Installer missing: $Installer" }
foreach ($File in @($PortableZip, $Installer)) {
  $Info = Get-Item -LiteralPath $File
  $Hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $File).Hash.ToLowerInvariant()
  Set-Content -LiteralPath "$File.sha256" -NoNewline -Encoding ascii -Value "$Hash  $($Info.Name)"
  Write-Output "artifact=$($Info.Name) bytes=$($Info.Length) sha256=$Hash"
}
