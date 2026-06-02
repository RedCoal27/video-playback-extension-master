$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'dist'
$releaseDir = Join-Path $dist 'release'
$extensionZip = Join-Path $releaseDir 'video-playback-extension-unpacked.zip'

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

Push-Location $root
try {
  npm run build
  npm run build:helper

  if (-not (Test-Path (Join-Path $root 'build\manifest.json'))) {
    throw 'Extension build output is missing build\manifest.json.'
  }

  Compress-Archive -Path (Join-Path $root 'build\*') -DestinationPath $extensionZip -Force

  @(
    'Video Playback Helper.exe',
    'Video Playback Helper.cmd',
    'Video Playback Helper.vbs'
  ) | ForEach-Object {
    Copy-RequiredItem (Join-Path $root $_) $releaseDir
  }

  Write-Host "Created $extensionZip"
  Write-Host "Created $(Join-Path $releaseDir 'Video Playback Helper.exe')"
} finally {
  Pop-Location
}
