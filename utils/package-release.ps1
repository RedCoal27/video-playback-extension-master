$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'dist'
$releaseDir = Join-Path $dist 'release'
$extensionCrx = Join-Path $releaseDir 'video-playback-extension.crx'

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

function Find-Chrome {
  $candidates = @(
    (Join-Path ${env:ProgramFiles} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:LocalAppData} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles} 'BraveSoftware\Brave-Browser\Application\brave.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'BraveSoftware\Brave-Browser\Application\brave.exe'),
    (Join-Path ${env:LocalAppData} 'BraveSoftware\Brave-Browser\Application\brave.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path ${env:ProgramFiles} 'Microsoft\Edge\Application\msedge.exe')
  )

  return $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
}

function Write-ExtensionKey {
  if (-not $env:CHROME_EXTENSION_PRIVATE_KEY_BASE64) {
    return ''
  }

  $keyPath = Join-Path $dist 'chrome-extension-key.pem'
  [System.IO.File]::WriteAllBytes(
    $keyPath,
    [System.Convert]::FromBase64String($env:CHROME_EXTENSION_PRIVATE_KEY_BASE64)
  )

  return $keyPath
}

function Pack-ExtensionCrx {
  $chrome = Find-Chrome

  if (-not $chrome) {
    throw 'Chrome, Brave, or Edge was not found. A Chromium browser is required to package the extension as a .crx file.'
  }

  $generatedCrx = Join-Path $root 'build.crx'
  $generatedPem = Join-Path $root 'build.pem'
  $keyPath = Write-ExtensionKey

  Remove-Item -LiteralPath $generatedCrx, $generatedPem -Force -ErrorAction SilentlyContinue

  $args = @("--pack-extension=$(Join-Path $root 'build')")

  if ($keyPath) {
    $args += "--pack-extension-key=$keyPath"
  }

  & $chrome @args

  for ($i = 0; $i -lt 20 -and -not (Test-Path $generatedCrx); $i++) {
    Start-Sleep -Milliseconds 500
  }

  if (-not (Test-Path $generatedCrx)) {
    throw 'Chrome did not create build.crx.'
  }

  Move-Item -LiteralPath $generatedCrx -Destination $extensionCrx -Force

  if (Test-Path $generatedPem) {
    Remove-Item -LiteralPath $generatedPem -Force
  }
}

Reset-Directory $releaseDir

Push-Location $root
try {
  npm run build
  npm run build:helper

  if (-not (Test-Path (Join-Path $root 'build\manifest.json'))) {
    throw 'Extension build output is missing build\manifest.json.'
  }

  Pack-ExtensionCrx

  @(
    'Video Playback Helper.exe',
    'Video Playback Helper.cmd',
    'Video Playback Helper.vbs'
  ) | ForEach-Object {
    Copy-RequiredItem (Join-Path $root $_) $releaseDir
  }

  Write-Host "Created $extensionCrx"
  Write-Host "Created $(Join-Path $releaseDir 'Video Playback Helper.exe')"
} finally {
  Pop-Location
}
