$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $PSScriptRoot 'HelperLauncher.cs'
$icon = Join-Path $PSScriptRoot 'helper-icon.ico'
$createIconScript = Join-Path $PSScriptRoot 'create-helper-icon.js'
$output = Join-Path $root 'Video Playback Helper.exe'
$candidates = @(
  (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
  (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
)
$compiler = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $compiler) {
  throw 'Unable to find csc.exe. Install .NET Framework build tools or run this on a standard Windows install.'
}

if (-not (Test-Path $icon)) {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js is required to generate the helper icon.'
  }

  node $createIconScript
}

$iconArgs = @()
if (Test-Path $icon) {
  $iconArgs = @("/win32icon:$icon")
}

$resourceArgs = @(
  "/resource:$icon,helper-icon.ico",
  "/resource:$(Join-Path $PSScriptRoot 'install-ytdlp.js'),install-ytdlp.js",
  "/resource:$(Join-Path $PSScriptRoot 'install-ffmpeg.js'),install-ffmpeg.js",
  "/resource:$(Join-Path $PSScriptRoot 'install-aria2.js'),install-aria2.js",
  "/resource:$(Join-Path $PSScriptRoot 'ytdlp-server.js'),ytdlp-server.js"
)

& $compiler `
  /nologo `
  /target:winexe `
  /out:"$output" `
  @iconArgs `
  @resourceArgs `
  /reference:System.Windows.Forms.dll `
  /reference:System.Drawing.dll `
  /reference:System.Web.Extensions.dll `
  "$source"

if ($LASTEXITCODE -ne 0) {
  throw "Helper executable compilation failed with exit code $LASTEXITCODE."
}

Write-Host "Built $output"
