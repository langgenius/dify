param(
    [switch]$Recreate
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$dockerDir = Join-Path $repoRoot "docker"
$contextRoot = Join-Path $dockerDir ".build\web-context"
$contextE2eDir = Join-Path $contextRoot "e2e"
$contextSdkDir = Join-Path $contextRoot "sdks\nodejs-client"

function Copy-Tree {
    param(
        [string]$Source,
        [string]$Destination,
        [string[]]$ExcludeDirs = @()
    )

    New-Item -ItemType Directory -Path $Destination -Force | Out-Null

    $arguments = @(
        $Source,
        $Destination,
        "/E",
        "/R:1",
        "/W:1",
        "/NFL",
        "/NDL",
        "/NJH",
        "/NJS",
        "/NP"
    )

    if ($ExcludeDirs.Count -gt 0) {
        $arguments += "/XD"
        $arguments += $ExcludeDirs
    }

    & robocopy @arguments | Out-Null

    if ($LASTEXITCODE -ge 8) {
        throw "robocopy failed for '$Source' -> '$Destination' with exit code $LASTEXITCODE"
    }
}

if (Test-Path $contextRoot) {
    Remove-Item -LiteralPath $contextRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $contextRoot | Out-Null
New-Item -ItemType Directory -Path $contextE2eDir -Force | Out-Null
New-Item -ItemType Directory -Path $contextSdkDir -Force | Out-Null

Copy-Item -LiteralPath (Join-Path $repoRoot "package.json") -Destination $contextRoot
Copy-Item -LiteralPath (Join-Path $repoRoot "pnpm-lock.yaml") -Destination $contextRoot
Copy-Item -LiteralPath (Join-Path $repoRoot "pnpm-workspace.yaml") -Destination $contextRoot

$nvmrcPath = Join-Path $repoRoot ".nvmrc"
if (Test-Path $nvmrcPath) {
    Copy-Item -LiteralPath $nvmrcPath -Destination $contextRoot
}

Copy-Tree -Source (Join-Path $repoRoot "web") -Destination (Join-Path $contextRoot "web") -ExcludeDirs @(
    "node_modules",
    ".pnpm-store",
    ".next",
    "dist",
    "build",
    "coverage",
    "logs",
    ".git",
    ".idea",
    ".vscode"
)
Copy-Tree -Source (Join-Path $repoRoot "packages") -Destination (Join-Path $contextRoot "packages") -ExcludeDirs @(
    "node_modules",
    ".pnpm-store",
    ".git"
)
Copy-Item -LiteralPath (Join-Path $repoRoot "e2e\package.json") -Destination $contextE2eDir
Copy-Item -LiteralPath (Join-Path $repoRoot "sdks\nodejs-client\package.json") -Destination $contextSdkDir

$env:DIFY_WEB_BUILD_CONTEXT = $contextRoot

Push-Location $repoRoot
try {
    docker compose -f docker/docker-compose.yaml -f docker/docker-compose.enterprise.yaml build web

    if ($Recreate) {
        docker compose -f docker/docker-compose.yaml -f docker/docker-compose.enterprise.yaml up -d --force-recreate web nginx
    }
}
finally {
    Pop-Location
}
