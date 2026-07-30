param(
    [switch]$Stop,
    [switch]$Reset,
    [switch]$NoBrowser,
    [switch]$PrepareOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$ProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$ComposeFile = Join-Path $ProjectRoot "deploy\docker\docker-compose.local-vps.yml"
$EnvFile = Join-Path $ProjectRoot ".env.local-vps"
$DataDirectory = Join-Path $ProjectRoot ".borotalk\local-vps\uploads"
$ProjectName = "borotalk-local-vps"
$AppUrl = "http://127.0.0.1:8080"
$RegisterUrl = "$AppUrl/register.html"
$MailUrl = "http://127.0.0.1:8025"
$OwnerEmail = "owner@example.com"

function Test-NativeCommand {
    param(
        [string]$Executable,
        [string[]]$CommandArguments = @()
    )
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        & $Executable @CommandArguments *> $null
        return $LASTEXITCODE -eq 0
    }
    finally {
        $ErrorActionPreference = $previousPreference
    }
}

function Wait-ForDocker {
    if (Test-NativeCommand -Executable "docker" -CommandArguments @("info")) {
        return
    }

    $desktopCandidates = @(
        (Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"),
        (Join-Path $env:LOCALAPPDATA "Docker\Docker Desktop.exe")
    )
    $desktop = $desktopCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $desktop) {
        throw "Docker Desktop is not installed. Install it and run TEST_VPS_LOCAL.bat again."
    }

    Write-Host "[Docker] Starting Docker Desktop..." -ForegroundColor Cyan
    Start-Process -FilePath $desktop -WindowStyle Hidden
    for ($attempt = 1; $attempt -le 90; $attempt++) {
        Start-Sleep -Seconds 2
        if (Test-NativeCommand -Executable "docker" -CommandArguments @("info")) {
            Write-Host "[Docker] Ready." -ForegroundColor Green
            return
        }
        if ($attempt % 10 -eq 0) {
            Write-Host "[Docker] Still waiting..." -ForegroundColor DarkGray
        }
    }
    throw "Docker Desktop did not become ready in three minutes."
}

function New-RandomHex {
    param([int]$Bytes = 32)
    $buffer = New-Object byte[] $Bytes
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($buffer)
    }
    finally {
        $generator.Dispose()
    }
    return (($buffer | ForEach-Object { $_.ToString("x2") }) -join "")
}

function Ensure-Environment {
    if (Test-Path -LiteralPath $EnvFile) {
        $existing = [System.IO.File]::ReadAllText($EnvFile)
        $migrated = $existing `
            -replace "BOOTSTRAP_ADMIN_EMAIL=owner@borotalk\.local", "BOOTSTRAP_ADMIN_EMAIL=${OwnerEmail}" `
            -replace "SMTP_FROM_EMAIL=local@borotalk\.test", "SMTP_FROM_EMAIL=local@example.com"
        if ($migrated -ne $existing) {
            [System.IO.File]::WriteAllText(
                $EnvFile,
                $migrated,
                [System.Text.UTF8Encoding]::new($false)
            )
        }
        return
    }
    $databasePassword = New-RandomHex -Bytes 18
    $jwtSecret = New-RandomHex -Bytes 48
    $content = @"
APP_ENV=local
APP_HOST=0.0.0.0
APP_PORT=8000

PUBLIC_BASE_URL=http://127.0.0.1:8080
PUBLIC_API_BASE_URL=
PUBLIC_WS_BASE_URL=
ALLOWED_ORIGINS=http://127.0.0.1:8080

DATABASE_URL=postgresql+asyncpg://app:${databasePassword}@postgres:5432/borotalk_local_vps
POSTGRES_DB=borotalk_local_vps
POSTGRES_USER=app
POSTGRES_PASSWORD=${databasePassword}
REDIS_URL=redis://redis:6379/0

JWT_SECRET_KEY=${jwtSecret}
COOKIE_SECURE=false
COOKIE_SAMESITE=lax
ACCESS_TOKEN_EXPIRE_MINUTES=15
REFRESH_TOKEN_EXPIRE_DAYS=30

UPLOADS_DIR=/code/uploads
SMTP_HOST=mailpit
SMTP_PORT=1025
SMTP_USERNAME=
SMTP_PASSWORD=
SMTP_FROM_EMAIL=local@example.com
SMTP_FROM_NAME=Borotalk Local
SMTP_STARTTLS=false

TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=
TELEGRAM_WEBHOOK_SECRET=
TURN_HOST=
TURN_SHARED_SECRET=

SERVER_OWNER_LIMIT=5
REGISTRATION_RETENTION_DAYS=90
BOOTSTRAP_ADMIN_EMAIL=${OwnerEmail}
RADMIN_IP=
"@
    [System.IO.Directory]::CreateDirectory((Split-Path -Parent $EnvFile)) | Out-Null
    [System.IO.File]::WriteAllText(
        $EnvFile,
        $content.Replace("`r`n", "`n") + "`n",
        [System.Text.UTF8Encoding]::new($false)
    )
}

function Invoke-Compose {
    param([string[]]$Arguments)
    & docker compose `
        --project-name $ProjectName `
        --env-file $EnvFile `
        --file $ComposeFile `
        @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose command failed: $($Arguments -join ' ')"
    }
}

function Wait-ForApplication {
    for ($attempt = 1; $attempt -le 60; $attempt++) {
        try {
            $response = Invoke-WebRequest -Uri "$AppUrl/healthz" -UseBasicParsing -TimeoutSec 3
            if ($response.StatusCode -eq 200) {
                return
            }
        }
        catch {
            Start-Sleep -Seconds 2
        }
    }
    Invoke-Compose -Arguments @("logs", "--tail", "80", "api", "worker")
    throw "The local application did not become healthy."
}

Set-Location $ProjectRoot
Ensure-Environment
[System.IO.Directory]::CreateDirectory($DataDirectory) | Out-Null

if ($PrepareOnly) {
    Write-Host "Local VPS environment prepared." -ForegroundColor Green
    exit 0
}

Wait-ForDocker
if (-not (Test-NativeCommand -Executable "docker" -CommandArguments @("compose", "version"))) {
    throw "Docker Compose v2 is unavailable. Update Docker Desktop."
}

if ($Reset) {
    Write-Host "This removes ONLY the isolated local VPS database, Redis data, emails and uploads." -ForegroundColor Yellow
    $confirmation = Read-Host "Type RESET to continue"
    if ($confirmation -cne "RESET") {
        Write-Host "Reset cancelled."
        exit 1
    }
    Invoke-Compose -Arguments @("down", "--volumes", "--remove-orphans")
    $localStateRoot = Join-Path $ProjectRoot ".borotalk\local-vps"
    $expectedStateRoot = [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot ".borotalk\local-vps"))
    if (Test-Path -LiteralPath $localStateRoot) {
        $resolvedStateRoot = (Resolve-Path -LiteralPath $localStateRoot).Path
        if ($resolvedStateRoot -ne $expectedStateRoot) {
            throw "Refusing to remove an unexpected state directory: $resolvedStateRoot"
        }
        Remove-Item -LiteralPath $resolvedStateRoot -Recurse -Force
    }
    if (Test-Path -LiteralPath $EnvFile) {
        Remove-Item -LiteralPath $EnvFile -Force
    }
    Write-Host "Local VPS test data removed. The regular Radmin data was not touched." -ForegroundColor Green
    exit 0
}

if ($Stop) {
    Write-Host "[Stop] Stopping the isolated local VPS..." -ForegroundColor Cyan
    Invoke-Compose -Arguments @("stop")
    exit 0
}

Write-Host "[1/5] Starting PostgreSQL, Redis and local mail..." -ForegroundColor Cyan
Invoke-Compose -Arguments @("up", "-d", "postgres", "redis", "mailpit")

Write-Host "[2/5] Building Borotalk API and worker..." -ForegroundColor Cyan
Invoke-Compose -Arguments @("build", "api", "worker")

Write-Host "[3/5] Applying database migrations..." -ForegroundColor Cyan
Invoke-Compose -Arguments @("run", "--rm", "api", "alembic", "upgrade", "head")

Write-Host "[4/5] Starting Borotalk..." -ForegroundColor Cyan
Invoke-Compose -Arguments @("up", "-d", "api", "worker")

Write-Host "[5/5] Checking health..." -ForegroundColor Cyan
Wait-ForApplication

Write-Host ""
Write-Host "Local Borotalk: $AppUrl" -ForegroundColor Green
Write-Host "Local mailbox:  $MailUrl" -ForegroundColor Green
Write-Host "First admin:    $OwnerEmail" -ForegroundColor Green
Write-Host ""
Write-Host "Register without an invite, open the email in Mailpit, and confirm it." -ForegroundColor Yellow

if (-not $NoBrowser) {
    Start-Process $RegisterUrl
    Start-Process $MailUrl
}
