$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $PSScriptRoot 'HelperLauncher.cs'
$output = Join-Path $root 'Video Playback Helper.exe'
$candidates = @(
  (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
  (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
)
$compiler = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $compiler) {
  throw 'Unable to find csc.exe. Install .NET Framework build tools or run this on a standard Windows install.'
}

& $compiler /nologo /target:winexe /out:"$output" /reference:System.Windows.Forms.dll "$source"

Write-Host "Built $output"
