# install-r2.ps1 — one-line difyctl installer (Windows) from Cloudflare R2.
# Usage: $env:DIFYCTL_R2_BASE='<BASE>'; irm https://raw.githubusercontent.com/langgenius/dify/main/cli/scripts/install-r2.ps1 | iex
# Env: DIFYCTL_R2_BASE (required), DIFYCTL_CHANNEL (default edge),
#      DIFYCTL_PREFIX (default %LOCALAPPDATA%\difyctl),
#      DIFYCTL_VERSION (pin exact published version),
#      DIFYCTL_COMMIT  (pin by git commit, short or full sha; via index.json).
# With no pin the channel pointer (latest) is installed.
$ErrorActionPreference = 'Stop'

function Get-TargetField($manifest, [string]$target, [string]$field) {
  $t = $manifest.targets.$target
  if (-not $t) { return $null }
  return $t.$field
}

# First build in index.json matching by exact version or commit prefix.
function Resolve-IndexBuild($index, [string]$kind, [string]$want) {
  foreach ($b in $index.builds) {
    $sel = if ($kind -eq 'commit') { $b.commit } else { $b.version }
    $hit = if ($kind -eq 'commit') { $sel.StartsWith($want) } else { $sel -eq $want }
    if ($hit) { return $b }
  }
  return $null
}

# Parse a checksums.txt ("<sha>  <asset>") for the line whose asset matches the
# target; returns @{ Sha; Asset } or $null.
function Get-ChecksumTarget([string]$text, [string]$target) {
  foreach ($line in ($text -split "`n")) {
    $line = $line.Trim()
    if ($line -match "\sdifyctl-v.*-$target(\.exe)?$") {
      $parts = $line -split '\s+'
      return @{ Sha = $parts[0]; Asset = $parts[-1] }
    }
  }
  return $null
}

# Download, sha256-verify, place. Returns nothing; throws on mismatch.
function Install-DifyctlBinary([string]$dlUrl, [string]$sha, [string]$version, [string]$channel, [string]$prefix) {
  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetFileName($dlUrl))
  Invoke-WebRequest -Uri $dlUrl -OutFile $tmp
  $actual = (Get-FileHash -Path $tmp -Algorithm SHA256).Hash.ToLower()
  if ($actual -ne $sha.ToLower()) { throw "checksum mismatch for $dlUrl" }

  $binDir = Join-Path $prefix 'bin'
  New-Item -ItemType Directory -Path $binDir -Force | Out-Null
  $dest = Join-Path $binDir 'difyctl.exe'
  try { Move-Item -Path $tmp -Destination $dest -Force }
  catch { throw "cannot replace $dest — close any running difyctl and re-run." }

  Write-Host "difyctl $version (channel $channel) installed: $dest"
  if (($env:PATH -split ';') -notcontains $binDir) {
    Write-Host "$binDir is not on your PATH. Add it with:"
    Write-Host "  [Environment]::SetEnvironmentVariable('PATH', `"$binDir;`$env:PATH`", 'User')"
  }
}

function Install-DifyctlR2 {
  $base = $env:DIFYCTL_R2_BASE
  if (-not $base) { throw "set DIFYCTL_R2_BASE to the R2 public base (e.g. https://pub-….r2.dev)" }
  $base = $base.TrimEnd('/')
  $channel = if ($env:DIFYCTL_CHANNEL) { $env:DIFYCTL_CHANNEL } else { 'edge' }
  $prefix = if ($env:DIFYCTL_PREFIX) { $env:DIFYCTL_PREFIX } else { Join-Path $env:LOCALAPPDATA 'difyctl' }
  $target = 'windows-x64'

  if ($env:DIFYCTL_VERSION -or $env:DIFYCTL_COMMIT) {
    $iurl = "$base/difyctl/$channel/index.json"
    try { $index = Invoke-RestMethod -Uri $iurl }
    catch { throw "R2 unavailable fetching $iurl; retry." }
    $build = if ($env:DIFYCTL_VERSION) { Resolve-IndexBuild $index 'version' $env:DIFYCTL_VERSION }
             else { Resolve-IndexBuild $index 'commit' $env:DIFYCTL_COMMIT }
    $pin = if ($env:DIFYCTL_VERSION) { $env:DIFYCTL_VERSION } else { $env:DIFYCTL_COMMIT }
    if (-not $build) { throw "no build matching $pin in channel $channel" }
    $version = $build.version
    $vbase = "$base/difyctl/$channel/$($build.dir)"
    try { $cf = (Invoke-WebRequest -Uri "$vbase/difyctl-v$version-checksums.txt").Content }
    catch { throw "checksums missing for $version (channel $channel)" }
    $ct = Get-ChecksumTarget $cf $target
    if (-not $ct) { throw "no build for $target at $version" }
    Install-DifyctlBinary "$vbase/$($ct.Asset)" $ct.Sha $version $channel $prefix
    return
  }

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
  Install-DifyctlBinary "$($manifest.baseUrl)/$asset" $sha $manifest.version $channel $prefix
}

if ($env:DIFYCTL_INSTALL_LIB -ne '1') { Install-DifyctlR2 }
