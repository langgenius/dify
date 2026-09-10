# install.ps1 — one-line difyctl installer for Windows. difyctl ships as assets
# on Dify GitHub Releases; this installs the build matching your Dify version.
#
# usage:
#   irm https://raw.githubusercontent.com/langgenius/dify/main/cli/scripts/install.ps1 | iex
#
# env:
#   DIFY_VERSION     Dify release tag to install difyctl from (e.g. 1.14.2). Primary key.
#   DIFYCTL_VERSION  difyctl version pin (used only when DIFY_VERSION is unset).
#   DIFYCTL_PREFIX   install dir (default $env:LOCALAPPDATA\difyctl)
#   DIFYCTL_REPO     release source repo (default langgenius/dify)
#   GITHUB_TOKEN     GitHub token (or GH_TOKEN) sent as a bearer to raise the API
#                    rate limit from 60 to 5000 requests/hour (useful in CI).

$ErrorActionPreference = 'Stop'

$repo           = if ($env:DIFYCTL_REPO) { $env:DIFYCTL_REPO } else { 'langgenius/dify' }
$difyVersion    = $env:DIFY_VERSION
$difyctlVersion = $env:DIFYCTL_VERSION
$prefix         = if ($env:DIFYCTL_PREFIX) { $env:DIFYCTL_PREFIX } else { Join-Path $env:LOCALAPPDATA 'difyctl' }
$target         = 'windows-x64'
$apiBase        = "https://api.github.com/repos/$repo"
$dlBase         = "https://github.com/$repo/releases/download"
$headers        = @{ Accept = 'application/vnd.github+json' }

$ghToken = if ($env:GITHUB_TOKEN) { $env:GITHUB_TOKEN } elseif ($env:GH_TOKEN) { $env:GH_TOKEN } else { $null }
if ($ghToken) { $headers.Authorization = "Bearer $ghToken" }

# Read a response header, coping with both PS7 (TryGetValues) and PS5.1 (indexer).
function Get-HeaderValue($Response, [string]$Name) {
    if (-not $Response -or -not $Response.Headers) { return $null }
    try {
        $vals = $null
        if ($Response.Headers.TryGetValues($Name, [ref]$vals)) { return ($vals | Select-Object -First 1) }
        return $null
    }
    catch {
        try { return $Response.Headers[$Name] } catch { return $null }
    }
}

# $null unless the error is a GitHub rate limit; else an object with the reset epoch.
function Get-RateLimitInfo($ErrorRecord) {
    $resp = $null
    try { $resp = $ErrorRecord.Exception.Response } catch { return $null }
    if (-not $resp) { return $null }
    $status = 0; try { $status = [int]$resp.StatusCode } catch {}
    if ($status -ne 403 -and $status -ne 429) { return $null }
    $remaining = Get-HeaderValue $resp 'x-ratelimit-remaining'
    if ($status -eq 429 -or $remaining -eq '0') {
        return [pscustomobject]@{ Reset = (Get-HeaderValue $resp 'x-ratelimit-reset') }
    }
    return $null
}

function Write-RateLimitHint($ResetEpoch) {
    [Console]::Error.WriteLine('GitHub API rate limit exceeded (unauthenticated requests are capped at 60/hour per IP).')
    if ("$ResetEpoch" -match '^\d+$') {
        $mins = [int][math]::Ceiling(([long]$ResetEpoch - [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()) / 60)
        if ($mins -gt 0) { [Console]::Error.WriteLine("The limit resets in ~$mins min.") }
    }
    [Console]::Error.WriteLine('To proceed now, authenticate to raise the limit to 5000/hour:')
    [Console]::Error.WriteLine('  $env:GITHUB_TOKEN = "<token>"; irm <install-url> | iex')
    [Console]::Error.WriteLine('Tip: pinning DIFY_VERSION makes a single API call (DIFYCTL_VERSION scans many).')
}

# Print the hint and exit if rate-limited; else return so the caller can throw.
function Stop-IfRateLimited($ErrorRecord) {
    $info = Get-RateLimitInfo $ErrorRecord
    if (-not $info) { return }
    Write-RateLimitHint $info.Reset
    exit 1
}

function Get-AssetSemver([string]$Name) {
    if ($Name -notmatch '^difyctl-v(.+?)-windows-x64\.exe$') { return $null }
    $v = $Matches[1]
    $core = (($v -split '\+')[0] -split '-')[0]
    if ($core -notmatch '^\d+\.\d+\.\d+$') { return $null }
    $rc = if ($v -match '-rc\.(\d+)') { [int]$Matches[1] } else { [int]::MaxValue }
    return [pscustomobject]@{ Name = $Name; Version = $v; Core = [version]$core; Rc = $rc }
}

function Select-Asset([object]$Release) {
    $Release.assets |
        ForEach-Object { Get-AssetSemver $_.name } |
        Where-Object { $_ } |
        Sort-Object Core, Rc |
        Select-Object -Last 1
}

function Find-ReleaseForDifyctl([string]$Want) {
    try { $releases = Invoke-RestMethod -Uri "$apiBase/releases?per_page=100" -Headers $headers }
    catch { Stop-IfRateLimited $_; throw }
    foreach ($rel in $releases) {
        $asset = Select-Asset $rel
        if ($asset -and $asset.Version -eq $Want) { return $rel }
    }
    return $null
}

function Resolve-Release {
    if ($difyVersion) {
        try { return Invoke-RestMethod -Uri "$apiBase/releases/tags/$difyVersion" -Headers $headers }
        catch { Stop-IfRateLimited $_; throw "Dify release $difyVersion not found: $_" }
    }
    elseif ($difyctlVersion) {
        $release = Find-ReleaseForDifyctl $difyctlVersion
        if (-not $release) { throw "difyctl $difyctlVersion not found on any Dify release" }
        return $release
    }
    else {
        try { return Invoke-RestMethod -Uri "$apiBase/releases/latest" -Headers $headers }
        catch { Stop-IfRateLimited $_; throw "failed to query latest Dify release (set DIFY_VERSION to pin one): $_" }
    }
}

function Invoke-Main {
    $release = Resolve-Release
    $difyTag = $release.tag_name
    $asset = Select-Asset $release
    if (-not $asset) { throw "no difyctl published for Dify $difyTag (target $target); set DIFY_VERSION to a release that has one" }

    $assetName = $asset.Name
    $ver       = $asset.Version
    $checksums = "difyctl-v$ver-checksums.txt"
    $base      = "$dlBase/$difyTag"

    $tmp = Join-Path $env:TEMP ("difyctl-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tmp -Force | Out-Null
    try {
        Write-Host "downloading $assetName (Dify $difyTag)..."
        $assetPath = Join-Path $tmp $assetName
        $sumsPath  = Join-Path $tmp $checksums
        Invoke-WebRequest -Uri "$base/$assetName" -OutFile $assetPath
        Invoke-WebRequest -Uri "$base/$checksums" -OutFile $sumsPath

        $expected = (Get-Content $sumsPath |
            Where-Object { $_ -match '\s' + [regex]::Escape($assetName) + '$' } |
            ForEach-Object { ($_ -split '\s+')[0] } |
            Select-Object -First 1)
        if (-not $expected) { throw "no checksum entry for $assetName" }
        $actual = (Get-FileHash -Path $assetPath -Algorithm SHA256).Hash.ToLower()
        if ($actual -ne $expected.ToLower()) { throw "checksum mismatch for $assetName" }

        $binDir = Join-Path $prefix 'bin'
        New-Item -ItemType Directory -Path $binDir -Force | Out-Null
        $targetBin = Join-Path $binDir 'difyctl.exe'
        Copy-Item -Path $assetPath -Destination $targetBin -Force

        Write-Host ""
        Write-Host "difyctl v$ver installed (from Dify $difyTag): $targetBin"
        if (($env:PATH -split ';') -notcontains $binDir) {
            Write-Host ""
            Write-Host "$binDir is not on your PATH. Add it with:"
            Write-Host "  [Environment]::SetEnvironmentVariable('PATH', `"$binDir;`$env:PATH`", 'User')"
        }
        else {
            Write-Host 'verify: run "difyctl version"'
        }
    }
    finally {
        Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    }
}

if ($env:DIFYCTL_INSTALL_LIB -ne '1') { Invoke-Main }
