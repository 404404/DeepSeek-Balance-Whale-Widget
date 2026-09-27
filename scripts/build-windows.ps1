$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $Root
$Package = Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json
$Version = if ($env:VERSION) { $env:VERSION } else { $Package.version }
$BuildNumber = if ($env:BUILD_NUMBER) { $env:BUILD_NUMBER } else { '1' }
$SourceSha = (& git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $SourceSha -notmatch '^[0-9a-f]{40}$') { throw 'Could not resolve the source commit SHA.' }
$ShortSha = $SourceSha.Substring(0, 7)
$Dist = Join-Path $Root 'dist'
$Packaged = Join-Path $Dist 'desktop-demo-win32-x64'
$Exe = Join-Path $Packaged 'desktop-demo.exe'
$ArchiveName = "desktop-demo-$Version-windows-x64-$ShortSha.zip"
$Archive = Join-Path $Dist $ArchiveName

if (Test-Path $Dist) { Remove-Item $Dist -Recurse -Force }
New-Item -ItemType Directory -Path $Dist -Force | Out-Null
$PackagerArgs = @(
  '.', 'desktop-demo', '--platform=win32', '--arch=x64', "--out=$Dist", '--overwrite', '--asar', '--prune=true',
  '--app-bundle-id=com.404404.desktopdemo', "--app-version=$Version", "--build-version=$BuildNumber", '--ignore=desktop/follow-main.cjs'
)
& npx.cmd --no-install electron-packager @PackagerArgs
if ($LASTEXITCODE -ne 0) { throw "electron-packager failed with exit code $LASTEXITCODE." }
if (-not (Test-Path $Exe -PathType Leaf)) { throw "Packaged desktop-demo.exe is missing: $Exe" }
if (-not (Test-Path (Join-Path $Packaged 'resources\app.asar') -PathType Leaf)) { throw 'Packaged resources/app.asar is missing.' }

$BuildInfo = @(
  "product=desktop-demo"
  "version=$Version"
  "architecture=x64"
  "source_sha=$SourceSha"
  "baseline_sha=$env:DESKTOP_DEMO_BASELINE_SHA"
  "build_number=$BuildNumber"
  "actions_run=$env:GITHUB_SERVER_URL/$env:GITHUB_REPOSITORY/actions/runs/$env:GITHUB_RUN_ID"
) -join "`n"
Set-Content -Path (Join-Path $Packaged 'desktop-demo-build-info.txt') -Value $BuildInfo -Encoding utf8

Compress-Archive -Path $Packaged -DestinationPath $Archive -CompressionLevel Optimal -Force
$Digest = (Get-FileHash $Archive -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -Path "$Archive.sha256" -Value "$Digest  $ArchiveName" -Encoding ascii
Set-Content -Path (Join-Path $Dist 'desktop-demo-build-info.txt') -Value $BuildInfo -Encoding utf8
Write-Host "Created $Archive"
Write-Host "SHA-256 $Digest"
