$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'dist'
$releaseDir = Join-Path $dist 'release'
$helperPackageDir = Join-Path $dist 'helper-package'
$extensionZip = Join-Path $releaseDir 'video-playback-extension.zip'
$helperZip = Join-Path $releaseDir 'video-playback-helper-windows.zip'
$sourceZip = Join-Path $releaseDir 'video-playback-source.zip'

function Reset-Directory {
  param([string]$Path)

  if (Test-Path $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }

  New-Item -ItemType Directory -Path $Path | Out-Null
}

function Copy-RequiredItem {
  param(
    [string]$Source,
    [string]$Destination
  )

  if (-not (Test-Path $Source)) {
    throw "Missing release file: $Source"
  }

  Copy-Item -LiteralPath $Source -Destination $Destination -Recurse -Force
}

Reset-Directory $releaseDir
Reset-Directory $helperPackageDir

Push-Location $root
try {
  npm run build
  npm run build:helper

  if (-not (Test-Path (Join-Path $root 'build\manifest.json'))) {
    throw 'Extension build output is missing build\manifest.json.'
  }

  Compress-Archive -Path (Join-Path $root 'build\*') -DestinationPath $extensionZip -Force

  Copy-RequiredItem (Join-Path $root 'Video Playback Helper.exe') $helperPackageDir
  Copy-RequiredItem (Join-Path $root 'Video Playback Helper.cmd') $helperPackageDir
  Copy-RequiredItem (Join-Path $root 'Video Playback Helper.vbs') $helperPackageDir

  $helperUtilsDir = Join-Path $helperPackageDir 'utils'
  New-Item -ItemType Directory -Path $helperUtilsDir | Out-Null

  @(
    'helper-ui.ps1',
    'helper-icon.ico',
    'install-ytdlp.js',
    'install-ffmpeg.js',
    'install-aria2.js',
    'ytdlp-server.js'
  ) | ForEach-Object {
    Copy-RequiredItem (Join-Path $root "utils\$_") $helperUtilsDir
  }

  @'
# Video Playback Helper

Run `Video Playback Helper.exe` to start the local companion app.

Requirements:

- Windows
- Node.js available in PATH

The helper downloads yt-dlp, FFmpeg, and aria2 automatically when needed.
'@ | Set-Content -Path (Join-Path $helperPackageDir 'README.txt') -Encoding UTF8

  Compress-Archive -Path (Join-Path $helperPackageDir '*') -DestinationPath $helperZip -Force

  git archive --format=zip --output=$sourceZip HEAD

  Write-Host "Created $extensionZip"
  Write-Host "Created $helperZip"
  Write-Host "Created $sourceZip"
} finally {
  Pop-Location
}
