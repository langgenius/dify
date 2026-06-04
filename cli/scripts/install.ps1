# install.ps1 — one-line difyctl installer for Windows from public GitHub Releases.
#
# usage:
#   irm https://raw.githubusercontent.com/langgenius/dify/main/cli/scripts/install.ps1 | iex
#
# env:
#   DIFYCTL_CHANNEL  stable (default) | rc
#   DIFYCTL_VERSION  exact version pin (e.g. 0.2.0); overrides DIFYCTL_CHANNEL
#   DIFYCTL_PREFIX   install dir (default $env:LOCALAPPDATA\difyctl)
#   DIFYCTL_REPO     release source repo (default langgenius/dify)

$ErrorActionPreference = 'Stop'

$repo    = if ($env:DIFYCTL_REPO) { $env:DIFYCTL_REPO } else { 'langgenius/dify' }
$channel = if ($env:DIFYCTL_CHANNEL) { $env:DIFYCTL_CHANNEL } else { 'stable' }
$version = $env:DIFYCTL_VERSION
$prefix  = if ($env:DIFYCTL_PREFIX) { $env:DIFYCTL_PREFIX } else { Join-Path $env:LOCALAPPDATA 'difyctl' }
$target  = 'windows-x64'

function Select-Version([string]$Channel, [object[]]$Refs) {
    $versions = $Refs.ref |
        Where-Object { $_ -like 'refs/tags/difyctl-v*' } |
        ForEach-Object { $_ -replace '^refs/tags/difyctl-v', '' }
    switch ($Channel) {
        'rc'     { $versions = $versions | Where-Object { $_ -match '-rc\.\d+$' } }
        'stable' { $versions = $versions | Where-Object { $_ -notmatch '-' } }
        default  { throw "invalid DIFYCTL_CHANNEL: $Channel (expected stable | rc)" }
    }
    $versions |
        Sort-Object `
            @{ Expression = { [version](($_ -split '-')[0]) } }, `
            @{ Expression = { if ($_ -match '-rc\.(\d+)$') { [int]$Matches[1] } else { [int]::MaxValue } } } |
        Select-Object -Last 1
}

function Resolve-Version {
    if ($version) { return $version }
    $api = "https://api.github.com/repos/$repo/git/matching-refs/tags/difyctl-v"
    try {
        $refs = Invoke-RestMethod -Uri $api -Headers @{ Accept = 'application/vnd.github+json' }
    } catch {
        throw "failed to query $repo releases (network error or GitHub API rate limit); set DIFYCTL_VERSION to pin a version"
    }
    $resolved = Select-Version -Channel $channel -Refs $refs
    if (-not $resolved) { throw "no $channel difyctl release found in $repo" }
    return $resolved
}

$ver       = Resolve-Version
$tag       = "difyctl-v$ver"
$asset     = "difyctl-v$ver-$target.exe"
$checksums = "difyctl-v$ver-checksums.txt"
$base      = "https://github.com/$repo/releases/download/$tag"

$tmp = Join-Path $env:TEMP ("difyctl-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
try {
    Write-Host "downloading $asset ($tag)..."
    $assetPath = Join-Path $tmp $asset
    $sumsPath  = Join-Path $tmp $checksums
    Invoke-WebRequest -Uri "$base/$asset" -OutFile $assetPath
    Invoke-WebRequest -Uri "$base/$checksums" -OutFile $sumsPath

    $expected = (Get-Content $sumsPath |
        Where-Object { $_ -match '\s' + [regex]::Escape($asset) + '$' } |
        ForEach-Object { ($_ -split '\s+')[0] } |
        Select-Object -First 1)
    if (-not $expected) { throw "no checksum entry for $asset" }
    $actual = (Get-FileHash -Path $assetPath -Algorithm SHA256).Hash.ToLower()
    if ($actual -ne $expected.ToLower()) { throw "checksum mismatch for $asset" }

    $binDir = Join-Path $prefix 'bin'
    New-Item -ItemType Directory -Path $binDir -Force | Out-Null
    $targetBin = Join-Path $binDir 'difyctl.exe'
    Copy-Item -Path $assetPath -Destination $targetBin -Force

    Write-Host ""
    Write-Host "difyctl v$ver installed: $targetBin"
    if (($env:PATH -split ';') -notcontains $binDir) {
        Write-Host ""
        Write-Host "$binDir is not on your PATH. Add it with:"
        Write-Host "  [Environment]::SetEnvironmentVariable('PATH', `"$binDir;`$env:PATH`", 'User')"
    } else {
        Write-Host 'verify: run "difyctl version"'
    }
}
finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
