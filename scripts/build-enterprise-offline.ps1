param(
  [string]$Version = "enterprise-local",
  [string]$OutputDir = "dist/offline",
  [ValidateSet("smart", "rebuild", "reuse")]
  [string]$Mode = "smart"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$dockerDir = Join-Path $repoRoot "docker"
$envFile = Join-Path $dockerDir ".env"
$composeFiles = @(
  "-f", (Join-Path $dockerDir "docker-compose.yaml"),
  "-f", (Join-Path $dockerDir "docker-compose.enterprise.yaml")
)

if (-not (Test-Path $envFile)) {
  throw "Missing docker\.env. Copy docker\.env.example to docker\.env and fill in your deployment settings first."
}

$apiImage = "dify-api-enterprise:$Version"
$webImage = "dify-web-enterprise:$Version"
$outputPath = Join-Path $repoRoot $OutputDir
New-Item -ItemType Directory -Force -Path $outputPath | Out-Null
$previousEnterpriseVersion = $env:DIFY_ENTERPRISE_VERSION
$previousDebug = $env:DEBUG
$previousEnterpriseEnabled = $env:ENTERPRISE_ENABLED
$previousComposeProfiles = $env:COMPOSE_PROFILES
$env:DIFY_ENTERPRISE_VERSION = $Version
if (-not $env:DEBUG) {
  $env:DEBUG = "false"
}
if (-not $env:ENTERPRISE_ENABLED) {
  $env:ENTERPRISE_ENABLED = "false"
}
if (-not $env:COMPOSE_PROFILES) {
  $envValues = @{}
  foreach ($line in Get-Content $envFile) {
    if ($line -match '^\s*#' -or $line -notmatch '=') {
      continue
    }
    $key, $value = $line -split '=', 2
    $envValues[$key.Trim()] = $value.Trim()
  }
  $vectorStore = if ($envValues.ContainsKey("VECTOR_STORE") -and $envValues["VECTOR_STORE"]) { $envValues["VECTOR_STORE"] } else { "weaviate" }
  $dbType = if ($envValues.ContainsKey("DB_TYPE") -and $envValues["DB_TYPE"]) { $envValues["DB_TYPE"] } else { "postgresql" }
  $env:COMPOSE_PROFILES = "$vectorStore,$dbType,collaboration"
}

function Get-ImageCommitSha {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Image
  )

  try {
    $envLines = docker image inspect $Image --format '{{range .Config.Env}}{{println .}}{{end}}' 2>$null
    if ($LASTEXITCODE -ne 0) {
      return $null
    }
  }
  catch {
    return $null
  }

  foreach ($line in $envLines) {
    if ($line -like 'COMMIT_SHA=*') {
      return $line.Substring('COMMIT_SHA='.Length)
    }
  }

  return $null
}

function Test-ReusableImage {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Image,
    [Parameter(Mandatory = $true)]
    [string]$ExpectedCommitSha
  )

  $commitSha = Get-ImageCommitSha -Image $Image
  return $commitSha -eq $ExpectedCommitSha
}

function Ensure-EnterpriseImage {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Image,
    [Parameter(Mandatory = $true)]
    [string]$Dockerfile,
    [Parameter(Mandatory = $true)]
    [string]$ContextPath,
    [Parameter(Mandatory = $true)]
    [string]$ExpectedCommitSha,
    [Parameter(Mandatory = $true)]
    [string]$BuildMode
  )

  $reusable = Test-ReusableImage -Image $Image -ExpectedCommitSha $ExpectedCommitSha
  switch ($BuildMode) {
    "reuse" {
      if (-not $reusable) {
        throw "Image $Image is not reusable. Expected COMMIT_SHA=$ExpectedCommitSha."
      }
      Write-Host "Reusing enterprise image: $Image"
      return
    }
    "smart" {
      if ($reusable) {
        Write-Host "Reusing enterprise image: $Image"
        return
      }
    }
  }

  Write-Host "Building enterprise image: $Image"
  docker build --build-arg COMMIT_SHA=$ExpectedCommitSha -f $Dockerfile -t $Image $ContextPath
}

Ensure-EnterpriseImage `
  -Image $apiImage `
  -Dockerfile (Join-Path $repoRoot "api/Dockerfile") `
  -ContextPath (Join-Path $repoRoot "api") `
  -ExpectedCommitSha $Version `
  -BuildMode $Mode

Ensure-EnterpriseImage `
  -Image $webImage `
  -Dockerfile (Join-Path $repoRoot "web/Dockerfile") `
  -ContextPath $repoRoot `
  -ExpectedCommitSha $Version `
  -BuildMode $Mode

try {
  Write-Host "Using DIFY_ENTERPRISE_VERSION=$Version"

  Write-Host "Resolving compose image list"
  $images = docker compose --env-file $envFile @composeFiles config --images `
    | Where-Object { $_ -and $_.Trim() } `
    | Sort-Object -Unique

  if (-not $images) {
    throw "Unable to resolve images from docker compose configuration."
  }

  $remoteImages = $images | Where-Object { $_ -notin @($apiImage, $webImage) }
  foreach ($image in $remoteImages) {
    docker image inspect $image *> $null
    if ($LASTEXITCODE -eq 0) {
      Write-Host "Reusing local dependency image: $image"
    }
    else {
      Write-Host "Pulling dependency image: $image"
      docker pull $image
    }
  }

  $manifestPath = Join-Path $outputPath "manifest-$Version.json"
  $imagesPath = Join-Path $outputPath "images-$Version.txt"
  $archivePath = Join-Path $outputPath "dify-enterprise-offline-$Version.tar"

  $manifest = [ordered]@{
    version = $Version
    generated_at = [DateTime]::UtcNow.ToString("o")
    images = $images
  }

  $manifest | ConvertTo-Json -Depth 4 | Set-Content -Path $manifestPath -Encoding UTF8
  $images | Set-Content -Path $imagesPath -Encoding UTF8

  Write-Host "Saving offline image bundle to $archivePath"
  docker save -o $archivePath $images

  Write-Host "Offline bundle ready."
  Write-Host "Manifest: $manifestPath"
  Write-Host "Images : $imagesPath"
  Write-Host "Archive: $archivePath"
}
finally {
  if ($null -eq $previousEnterpriseVersion) {
    Remove-Item Env:DIFY_ENTERPRISE_VERSION -ErrorAction SilentlyContinue
  }
  else {
    $env:DIFY_ENTERPRISE_VERSION = $previousEnterpriseVersion
  }
  if ($null -eq $previousDebug) {
    Remove-Item Env:DEBUG -ErrorAction SilentlyContinue
  }
  else {
    $env:DEBUG = $previousDebug
  }
  if ($null -eq $previousEnterpriseEnabled) {
    Remove-Item Env:ENTERPRISE_ENABLED -ErrorAction SilentlyContinue
  }
  else {
    $env:ENTERPRISE_ENABLED = $previousEnterpriseEnabled
  }
  if ($null -eq $previousComposeProfiles) {
    Remove-Item Env:COMPOSE_PROFILES -ErrorAction SilentlyContinue
  }
  else {
    $env:COMPOSE_PROFILES = $previousComposeProfiles
  }
}
