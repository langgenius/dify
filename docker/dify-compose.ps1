$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

$DefaultEnvFile = ".env.default"
$UserEnvFile = ".env"
$MergedEnvFile = $null
$Utf8NoBom = New-Object System.Text.UTF8Encoding -ArgumentList $false

function Write-Info {
    param([string]$Message)
    [Console]::Error.WriteLine($Message)
}

function Fail {
    param([string]$Message)
    [Console]::Error.WriteLine("Error: $Message")
    exit 1
}

function Test-CommandSuccess {
    param([string[]]$Command)

    try {
        $Executable = $Command[0]
        $CommandArgs = @()
        if ($Command.Length -gt 1) {
            $CommandArgs = @($Command[1..($Command.Length - 1)])
        }

        & $Executable @CommandArgs *> $null
        return $LASTEXITCODE -eq 0
    }
    catch {
        return $false
    }
}

function Get-ComposeCommand {
    if (Test-CommandSuccess @("docker", "compose", "version")) {
        return @("docker", "compose")
    }

    if ((Get-Command "docker-compose" -ErrorAction SilentlyContinue) -and (Test-CommandSuccess @("docker-compose", "version"))) {
        return @("docker-compose")
    }

    Fail "Docker Compose is not available. Install Docker Compose, then run this command again."
}

function New-SecretKey {
    $Bytes = New-Object byte[] 42
    $Generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()

    try {
        $Generator.GetBytes($Bytes)
    }
    finally {
        $Generator.Dispose()
    }

    return [Convert]::ToBase64String($Bytes)
}

function Ensure-EnvFiles {
    if (-not (Test-Path $DefaultEnvFile -PathType Leaf)) {
        Fail "$DefaultEnvFile is missing."
    }

    if (Test-Path $UserEnvFile -PathType Leaf) {
        return
    }

    New-Item -ItemType File -Path $UserEnvFile | Out-Null

    if ([Console]::IsInputRedirected) {
        Write-Info "Created $UserEnvFile for local overrides."
        return
    }

    Write-Info "Created $UserEnvFile for local overrides."
    $Answer = Read-Host "Do you need a custom deployment now? (Most users can press Enter to skip.) [y/N]"

    if ($Answer -match "^(y|yes)$") {
        Write-Output "Edit .env with the settings you want to override, using .env.example as the full reference."
        Write-Output "Run .\dify-compose.ps1 up -d again when you are ready."
        exit 0
    }
}

function Read-EnvFile {
    param([string]$Path)

    $Values = [ordered]@{}

    if (-not (Test-Path $Path -PathType Leaf)) {
        return $Values
    }

    foreach ($Line in Get-Content -Path $Path) {
        if ($Line -match "^\s*#" -or $Line -notmatch "=") {
            continue
        }

        $SeparatorIndex = $Line.IndexOf("=")
        $Key = $Line.Substring(0, $SeparatorIndex).Trim()
        $Value = $Line.Substring($SeparatorIndex + 1).Trim()

        if (($Value.StartsWith('"') -and $Value.EndsWith('"')) -or ($Value.StartsWith("'") -and $Value.EndsWith("'"))) {
            $Value = $Value.Substring(1, $Value.Length - 2)
        }

        if ($Key.Length -gt 0) {
            $Values[$Key] = $Value
        }
    }

    return $Values
}

function Set-UserEnvValue {
    param(
        [string]$Key,
        [string]$Value
    )

    $Path = [string](Resolve-Path $UserEnvFile)
    $Lines = [System.IO.File]::ReadAllLines($Path, [System.Text.Encoding]::UTF8)
    $Output = New-Object System.Collections.Generic.List[string]
    $Replaced = $false

    foreach ($Line in $Lines) {
        if ($Line -match "^\s*#" -or $Line -notmatch "=") {
            $Output.Add($Line)
            continue
        }

        $SeparatorIndex = $Line.IndexOf("=")
        $CurrentKey = $Line.Substring(0, $SeparatorIndex).Trim()

        if ($CurrentKey -eq $Key) {
            if (-not $Replaced) {
                $Output.Add("$Key=$Value")
                $Replaced = $true
            }
            continue
        }

        $Output.Add($Line)
    }

    if (-not $Replaced) {
        $Output.Add("$Key=$Value")
    }

    [System.IO.File]::WriteAllLines($Path, $Output, $Utf8NoBom)
}

function Ensure-SecretKey {
    $Values = Read-EnvFile $UserEnvFile

    if ($Values.Contains("SECRET_KEY") -and $Values["SECRET_KEY"]) {
        return
    }

    Set-UserEnvValue "SECRET_KEY" (New-SecretKey)
    Write-Info "Generated SECRET_KEY in $UserEnvFile."
}

function Merge-EnvValues {
    $Values = [ordered]@{}

    foreach ($Entry in (Read-EnvFile $DefaultEnvFile).GetEnumerator()) {
        $Values[$Entry.Key] = $Entry.Value
    }

    foreach ($Entry in (Read-EnvFile $UserEnvFile).GetEnumerator()) {
        $Values[$Entry.Key] = $Entry.Value
    }

    return $Values
}

function User-Overrides {
    param([string]$Key)

    if (-not (Test-Path $UserEnvFile -PathType Leaf)) {
        return $false
    }

    return [bool](Select-String -Path $UserEnvFile -Pattern "^\s*$([regex]::Escape($Key))\s*=" -Quiet)
}

function Metadata-DbHost {
    param([string]$DbType, $Values)

    switch ($DbType) {
        "mysql" { return "db_mysql" }
        "postgresql" { return "db_postgres" }
        "" { return "db_postgres" }
        default { return $Values["DB_HOST"] }
    }
}

function Metadata-DbPort {
    param([string]$DbType, $Values)

    switch ($DbType) {
        "mysql" { return "3306" }
        "postgresql" { return "5432" }
        "" { return "5432" }
        default { return $Values["DB_PORT"] }
    }
}

function Metadata-DbUser {
    param([string]$DbType, $Values)

    switch ($DbType) {
        "mysql" { return "root" }
        "postgresql" { return "postgres" }
        "" { return "postgres" }
        default { return $Values["DB_USERNAME"] }
    }
}

function Write-MergedEnv {
    param($Values)

    $Output = New-Object System.Collections.Generic.List[string]

    foreach ($Entry in $Values.GetEnumerator()) {
        $Output.Add("$($Entry.Key)=$($Entry.Value)")
    }

    [System.IO.File]::WriteAllLines($MergedEnvFile, $Output, $Utf8NoBom)
}

function Build-MergedEnv {
    $Values = Merge-EnvValues
    $script:MergedEnvFile = [System.IO.Path]::GetTempFileName()

    $DbType = if ($Values.Contains("DB_TYPE")) { $Values["DB_TYPE"] } else { "postgresql" }

    if (-not (User-Overrides "DB_HOST")) {
        $Values["DB_HOST"] = Metadata-DbHost $DbType $Values
    }

    if (-not (User-Overrides "DB_PORT")) {
        $Values["DB_PORT"] = Metadata-DbPort $DbType $Values
    }

    if (-not (User-Overrides "DB_USERNAME")) {
        $Values["DB_USERNAME"] = Metadata-DbUser $DbType $Values
    }

    if (-not (User-Overrides "CELERY_BROKER_URL")) {
        $RedisHost = if ($Values.Contains("REDIS_HOST") -and $Values["REDIS_HOST"]) { $Values["REDIS_HOST"] } else { "redis" }
        $RedisPort = if ($Values.Contains("REDIS_PORT") -and $Values["REDIS_PORT"]) { $Values["REDIS_PORT"] } else { "6379" }
        $RedisUsername = if ($Values.Contains("REDIS_USERNAME")) { $Values["REDIS_USERNAME"] } else { "" }
        $RedisPassword = if ($Values.Contains("REDIS_PASSWORD")) { $Values["REDIS_PASSWORD"] } else { "" }
        $RedisAuth = ""

        if ($RedisUsername -and $RedisPassword) {
            $RedisAuth = "${RedisUsername}:${RedisPassword}@"
        }
        elseif ($RedisPassword) {
            $RedisAuth = ":${RedisPassword}@"
        }
        elseif ($RedisUsername) {
            $RedisAuth = "${RedisUsername}@"
        }

        $Values["CELERY_BROKER_URL"] = "redis://$RedisAuth${RedisHost}:${RedisPort}/1"
    }

    if (-not (User-Overrides "SANDBOX_API_KEY")) {
        $CodeExecutionApiKey = if ($Values.Contains("CODE_EXECUTION_API_KEY") -and $Values["CODE_EXECUTION_API_KEY"]) { $Values["CODE_EXECUTION_API_KEY"] } else { "dify-sandbox" }
        $Values["SANDBOX_API_KEY"] = $CodeExecutionApiKey
    }

    if (-not (User-Overrides "WEAVIATE_AUTHENTICATION_APIKEY_ALLOWED_KEYS")) {
        $WeaviateApiKey = if ($Values.Contains("WEAVIATE_API_KEY") -and $Values["WEAVIATE_API_KEY"]) { $Values["WEAVIATE_API_KEY"] } else { "WVF5YThaHlkYwhGUSmCRgsX3tD5ngdN8pkih" }
        $Values["WEAVIATE_AUTHENTICATION_APIKEY_ALLOWED_KEYS"] = $WeaviateApiKey
    }

    Write-MergedEnv $Values
}

$ComposeCommand = Get-ComposeCommand

try {
    Ensure-EnvFiles
    Ensure-SecretKey
    Build-MergedEnv

    $ComposeArgs = @($args)
    if ($ComposeArgs.Count -eq 0) {
        $ComposeArgs = @("up", "-d")
    }

    $ComposeCommandArgs = @()
    if ($ComposeCommand.Length -gt 1) {
        $ComposeCommandArgs = @($ComposeCommand[1..($ComposeCommand.Length - 1)])
    }

    $ComposeExecutable = $ComposeCommand[0]
    & $ComposeExecutable @ComposeCommandArgs --env-file $MergedEnvFile @ComposeArgs
    exit $LASTEXITCODE
}
finally {
    if ($MergedEnvFile -and (Test-Path $MergedEnvFile -PathType Leaf)) {
        Remove-Item -Force $MergedEnvFile
    }
}
