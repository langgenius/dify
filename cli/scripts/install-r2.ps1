# install-r2.ps1 — one-line difyctl installer (Windows) from Cloudflare R2.
# Usage: $env:DIFYCTL_R2_BASE='<BASE>'; irm <BASE>/difyctl/install.ps1 | iex
# Env: DIFYCTL_R2_BASE (required), DIFYCTL_CHANNEL (default edge), DIFYCTL_PREFIX (default %LOCALAPPDATA%\difyctl)
$ErrorActionPreference = 'Stop'

function Get-TargetField($manifest, [string]$target, [string]$field) {
  $t = $manifest.targets.$target
  if (-not $t) { return $null }
  return $t.$field
}

function Install-DifyctlR2 {
  $base = $env:DIFYCTL_R2_BASE
  if (-not $base) { throw "set DIFYCTL_R2_BASE to the R2 public base (e.g. https://pub-….r2.dev)" }
  $base = $base.TrimEnd('/')
  $channel = if ($env:DIFYCTL_CHANNEL) { $env:DIFYCTL_CHANNEL } else { 'edge' }
  $prefix = if ($env:DIFYCTL_PREFIX) { $env:DIFYCTL_PREFIX } else { Join-Path $env:LOCALAPPDATA 'difyctl' }
  $target = 'windows-x64'

  $murl = "$base/difyctl/$channel/manifest.json"
  try { $manifest = Invoke-RestMethod -Uri $murl }
  catch {
    if ($_.Exception.Response.StatusCode.value__ -eq 404) {
      throw "channel '$channel' not published to R2. For rc/stable use install.ps1 (GitHub)."
    }
    throw "R2 unavailable fetching $murl; retry."
  }
  if ($manifest.channel -ne $channel) { throw "manifest channel '$($manifest.channel)' != requested '$channel'" }

  $asset = Get-TargetField $manifest $target 'asset'
  $sha   = Get-TargetField $manifest $target 'sha256'
  if (-not $asset) { throw "no build for $target in channel $channel" }

  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) $asset
  Invoke-WebRequest -Uri "$($manifest.baseUrl)/$asset" -OutFile $tmp
  $actual = (Get-FileHash -Path $tmp -Algorithm SHA256).Hash.ToLower()
  if ($actual -ne $sha.ToLower()) { throw "checksum mismatch for $asset" }

  $binDir = Join-Path $prefix 'bin'
  New-Item -ItemType Directory -Path $binDir -Force | Out-Null
  $dest = Join-Path $binDir 'difyctl.exe'
  try { Move-Item -Path $tmp -Destination $dest -Force }
  catch { throw "cannot replace $dest — close any running difyctl and re-run." }

  Write-Host "difyctl $($manifest.version) (channel $channel) installed: $dest"
  if (($env:PATH -split ';') -notcontains $binDir) {
    Write-Host "$binDir is not on your PATH. Add it with:"
    Write-Host "  [Environment]::SetEnvironmentVariable('PATH', `"$binDir;`$env:PATH`", 'User')"
  }
}

if ($env:DIFYCTL_INSTALL_LIB -ne '1') { Install-DifyctlR2 }
