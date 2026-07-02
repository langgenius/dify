param(
  [string]$Version = "enterprise-local",
  [string]$OutputDir = "dist/offline"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$outputPath = Join-Path $repoRoot $OutputDir
$manifestPath = Join-Path $outputPath "manifest-$Version.json"
$imagesPath = Join-Path $outputPath "images-$Version.txt"
$archivePath = Join-Path $outputPath "dify-enterprise-config-$Version.tar.gz"

$requiredFiles = @(
  "docker/docker-compose.yaml",
  "docker/docker-compose.enterprise.yaml",
  "docker/.env.example",
  "docker/ENTERPRISE_DEPLOY_STARTUP.md",
  "docker/UPGRADE_1.14.2_TO_1.15.0_ENTERPRISE.md",
  "docker/dify-env-sync.py",
  "docker/dify-env-sync.sh",
  "docker/README.enterprise.md",
  "scripts/check-enterprise-vector-indexes.sh",
  "$OutputDir/manifest-$Version.json",
  "$OutputDir/images-$Version.txt"
)

$envExampleFiles = Get-ChildItem -Path (Join-Path $repoRoot "docker/envs") -Recurse -File -Filter "*.env.example" |
  ForEach-Object {
    $relativePath = Resolve-Path -Path $_.FullName -Relative -RelativeBasePath $repoRoot
    $relativePath -replace "\\", "/"
  } |
  Sort-Object

if (-not $envExampleFiles -or $envExampleFiles.Count -eq 0) {
  throw "Missing required docker/envs/*.env.example files."
}

$requiredFiles += $envExampleFiles

$requiredDirs = @(
  "docker/nginx",
  "docker/ssrf_proxy"
)

foreach ($path in $requiredFiles) {
  if (-not (Test-Path (Join-Path $repoRoot $path) -PathType Leaf)) {
    throw "Missing required file: $path"
  }
}

foreach ($path in $requiredDirs) {
  if (-not (Test-Path (Join-Path $repoRoot $path) -PathType Container)) {
    throw "Missing required directory: $path"
  }
}

if (-not (Test-Path $manifestPath) -or -not (Test-Path $imagesPath)) {
  throw "Missing offline manifest or image list for version $Version. Run build-enterprise-offline with Mode=reuse after image validation first."
}

New-Item -ItemType Directory -Force -Path $outputPath | Out-Null

$archiveItems = $requiredFiles + $requiredDirs
tar --create --gzip --file $archivePath --directory $repoRoot @archiveItems

Write-Host "Enterprise configuration bundle ready."
Write-Host "Archive: $archivePath"
