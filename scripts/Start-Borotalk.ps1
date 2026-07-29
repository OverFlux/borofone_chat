param(
    [string]$RadminIp = "",
    [ValidateRange(1024, 65535)]
    [int]$Port = 8443,
    [switch]$Stop,
    [switch]$CheckOnly,
    [switch]$NoBrowser,
    [switch]$NoElevate,
    [switch]$PauseOnError
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$ProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$StateDir = Join-Path $ProjectRoot ".borotalk"
$PidFile = Join-Path $StateDir "server.pid"
$LogDir = Join-Path $StateDir "logs"
$ShareDir = Join-Path $ProjectRoot "BOROTALK_SHARE"
$ComposeFile = Join-Path $ProjectRoot "deploy\docker\docker-compose.infra.yml"
$EnvFile = Join-Path $ProjectRoot ".env"
$RequirementsFile = Join-Path $ProjectRoot "requirements.txt"
$VenvDir = Join-Path $ProjectRoot ".venv"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
$DependencyMarker = Join-Path $VenvDir ".borotalk-requirements"
$CertificateHostFile = Join-Path $StateDir "certificate-host.txt"
$InviteFile = Join-Path $StateDir "invite.txt"
$LauncherErrorFile = Join-Path $StateDir "launcher-error.log"
$FirewallRuleName = "BorotalkRadminHTTPS"

function Write-Stage {
    param([string]$Message)
    Write-Host ""
    Write-Host "[$Message]" -ForegroundColor Cyan
}

function Write-Ok {
    param([string]$Message)
    Write-Host "  OK  $Message" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Message)
    Write-Host "  !   $Message" -ForegroundColor Yellow
}

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Start-ElevatedCopy {
    $arguments = @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", "`"$PSCommandPath`"",
        "-Port", $Port,
        "-PauseOnError"
    )
    if ($RadminIp) {
        $arguments += @("-RadminIp", $RadminIp)
    }
    if ($Stop) {
        $arguments += "-Stop"
    }
    if ($NoBrowser) {
        $arguments += "-NoBrowser"
    }

    Start-Process `
        -FilePath "powershell.exe" `
        -Verb RunAs `
        -WorkingDirectory $ProjectRoot `
        -ArgumentList ($arguments -join " ")
}

function Test-NativeCommand {
    param(
        [string]$Executable,
        [string[]]$CommandArguments = @()
    )
    # Windows PowerShell 5 turns native stderr into a terminating
    # NativeCommandError when ErrorActionPreference is Stop. Probes are
    # expected to fail while Docker Desktop is still starting.
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        & $Executable @CommandArguments *> $null
        return $LASTEXITCODE -eq 0
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
}

function Get-RadminIPv4 {
    try {
        $adapters = @(
            Get-NetAdapter -ErrorAction Stop |
                Where-Object {
                    $_.Status -eq "Up" -and (
                        $_.Name -match "Radmin" -or
                        $_.InterfaceDescription -match "Radmin"
                    )
                }
        )
        foreach ($adapter in $adapters) {
            $address = Get-NetIPAddress `
                -InterfaceIndex $adapter.ifIndex `
                -AddressFamily IPv4 `
                -ErrorAction SilentlyContinue |
                Where-Object {
                    $_.IPAddress -notlike "169.254.*" -and
                    $_.IPAddress -ne "127.0.0.1"
                } |
                Select-Object -First 1
            if ($address) {
                return $address.IPAddress
            }
        }
    } catch {
        return $null
    }
    return $null
}

function Test-IPv4 {
    param([string]$Address)
    $parsed = $null
    return (
        [System.Net.IPAddress]::TryParse($Address, [ref]$parsed) -and
        $parsed.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork
    )
}

function Get-EnvValue {
    param([string]$Key)
    if (-not (Test-Path -LiteralPath $EnvFile)) {
        return ""
    }
    $pattern = "^\s*" + [regex]::Escape($Key) + "\s*=(.*)$"
    foreach ($line in Get-Content -LiteralPath $EnvFile -Encoding UTF8) {
        if ($line -match $pattern) {
            return $Matches[1].Trim()
        }
    }
    return ""
}

function Set-EnvValue {
    param(
        [string]$Key,
        [string]$Value
    )
    $lines = @()
    if (Test-Path -LiteralPath $EnvFile) {
        $lines = @(Get-Content -LiteralPath $EnvFile -Encoding UTF8)
    }
    $pattern = "^\s*" + [regex]::Escape($Key) + "\s*="
    $updated = [System.Collections.Generic.List[string]]::new()
    $written = $false
    foreach ($line in $lines) {
        if ($line -match $pattern) {
            if (-not $written) {
                $updated.Add("$Key=$Value")
                $written = $true
            }
            continue
        }
        $updated.Add($line)
    }
    if (-not $written) {
        $updated.Add("$Key=$Value")
    }
    Set-Content -LiteralPath $EnvFile -Value $updated -Encoding UTF8
}

function New-RandomHex {
    param([int]$Bytes = 32)
    $buffer = New-Object byte[] $Bytes
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($buffer)
    } finally {
        $generator.Dispose()
    }
    return (($buffer | ForEach-Object { $_.ToString("x2") }) -join "")
}

function Get-ManagedServerProcess {
    if (-not (Test-Path -LiteralPath $PidFile)) {
        return $null
    }
    $storedPid = (Get-Content -LiteralPath $PidFile -Raw -Encoding UTF8).Trim()
    if ($storedPid -notmatch "^\d+$") {
        return $null
    }
    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $storedPid" -ErrorAction SilentlyContinue
    if (-not $processInfo) {
        return $null
    }
    $expectedScript = [regex]::Escape((Join-Path $ProjectRoot "run_https.py"))
    if ($processInfo.CommandLine -notmatch $expectedScript) {
        return $null
    }
    return $processInfo
}

function Stop-ProcessTree {
    param([int]$RootProcessId)
    $children = @(
        Get-CimInstance Win32_Process -Filter "ParentProcessId = $RootProcessId" -ErrorAction SilentlyContinue
    )
    foreach ($child in $children) {
        Stop-ProcessTree -RootProcessId $child.ProcessId
    }
    Stop-Process -Id $RootProcessId -Force -ErrorAction SilentlyContinue
}

function Stop-ManagedServer {
    $processInfo = Get-ManagedServerProcess
    if (-not $processInfo) {
        if (Test-Path -LiteralPath $PidFile) {
            Remove-Item -LiteralPath $PidFile -Force
        }
        Write-Ok "Управляемый процесс Borotalk уже остановлен"
        return
    }
    Stop-ProcessTree -RootProcessId $processInfo.ProcessId
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    Write-Ok "Borotalk остановлен"
}

function Resolve-Compose {
    if (Get-Command docker -ErrorAction SilentlyContinue) {
        if (Test-NativeCommand "docker" @("compose", "version")) {
            return @{
                Exe = "docker"
                Prefix = @("compose")
            }
        }
    }
    if (Get-Command docker-compose -ErrorAction SilentlyContinue) {
        return @{
            Exe = "docker-compose"
            Prefix = @()
        }
    }
    return $null
}

function Invoke-Compose {
    param(
        [hashtable]$Compose,
        [string[]]$CommandArguments,
        [switch]$AllowFailure
    )
    $allArguments = @($Compose.Prefix) + @("-f", $ComposeFile) + $CommandArguments
    $result = & $Compose.Exe @allArguments
    if (-not $AllowFailure -and $LASTEXITCODE -ne 0) {
        throw "Команда Docker Compose завершилась с ошибкой."
    }
    return $result
}

function Wait-ForDocker {
    param([int]$Seconds = 120)
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-NativeCommand "docker" @("info")) {
            return $true
        }
        Start-Sleep -Seconds 2
    }
    return $false
}

function Start-DockerDesktopIfAvailable {
    $candidates = @(
        @(
            (Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"),
            (Join-Path ${env:ProgramFiles(x86)} "Docker\Docker\Docker Desktop.exe")
        ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
    )
    if ($candidates.Count -gt 0) {
        Start-Process -FilePath $candidates[0] -WindowStyle Hidden
        return $true
    }
    return $false
}

function Wait-ForInfrastructure {
    param(
        [hashtable]$Compose,
        [int]$Seconds = 90
    )
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        Invoke-Compose $Compose @(
            "exec", "-T", "postgres",
            "pg_isready", "-U", "app", "-d", "app"
        ) -AllowFailure *> $null
        $postgresReady = $LASTEXITCODE -eq 0

        Invoke-Compose $Compose @(
            "exec", "-T", "redis",
            "redis-cli", "ping"
        ) -AllowFailure *> $null
        $redisReady = $LASTEXITCODE -eq 0

        if ($postgresReady -and $redisReady) {
            return $true
        }
        Start-Sleep -Seconds 2
    }
    return $false
}

function Resolve-Python {
    if (Test-Path -LiteralPath $VenvPython) {
        return $VenvPython
    }
    if (Get-Command py -ErrorAction SilentlyContinue) {
        & py -3 -m venv $VenvDir
    } elseif (Get-Command python -ErrorAction SilentlyContinue) {
        & python -m venv $VenvDir
    } else {
        throw "Python 3 не найден. Установите Python и включите пункт Add Python to PATH."
    }
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $VenvPython)) {
        throw "Не удалось создать виртуальное окружение Python."
    }
    return $VenvPython
}

function Install-DependenciesIfNeeded {
    param([string]$Python)
    $requirementsHash = (Get-FileHash -LiteralPath $RequirementsFile -Algorithm SHA256).Hash
    $installedHash = ""
    if (Test-Path -LiteralPath $DependencyMarker) {
        $installedHash = (Get-Content -LiteralPath $DependencyMarker -Raw -Encoding UTF8).Trim()
    }
    if ($requirementsHash -eq $installedHash) {
        Write-Ok "Python-зависимости уже готовы"
        return
    }
    Write-Host "  Первый запуск: устанавливаю зависимости..."
    & $Python -m pip install --disable-pip-version-check -r $RequirementsFile
    if ($LASTEXITCODE -ne 0) {
        throw "Не удалось установить Python-зависимости."
    }
    Set-Content -LiteralPath $DependencyMarker -Value $requirementsHash -Encoding UTF8
    Write-Ok "Python-зависимости установлены"
}

function Ensure-Certificate {
    param(
        [string]$HostAddress,
        [string]$Password
    )
    $pfx = Join-Path $ProjectRoot "ssl\voice.pfx"
    $crt = Join-Path $ProjectRoot "ssl\cert.crt"
    $storedHost = ""
    if (Test-Path -LiteralPath $CertificateHostFile) {
        $storedHost = (Get-Content -LiteralPath $CertificateHostFile -Raw -Encoding UTF8).Trim()
    }
    if (
        $storedHost -ne $HostAddress -or
        -not (Test-Path -LiteralPath $pfx) -or
        -not (Test-Path -LiteralPath $crt)
    ) {
        Write-Host "  Создаю сертификат для $HostAddress..."
        & (Join-Path $PSScriptRoot "generate_ssl.ps1") `
            -IpAddress $HostAddress `
            -OutputDir (Join-Path $ProjectRoot "ssl") `
            -Password $Password `
            -Force
        if ($LASTEXITCODE -ne 0) {
            throw "Не удалось создать HTTPS-сертификат."
        }
        Set-Content -LiteralPath $CertificateHostFile -Value $HostAddress -Encoding UTF8
    } else {
        Write-Ok "HTTPS-сертификат уже готов"
    }

    $publicCertificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($crt)
    $trusted = Get-ChildItem Cert:\LocalMachine\Root |
        Where-Object { $_.Thumbprint -eq $publicCertificate.Thumbprint } |
        Select-Object -First 1
    if (-not $trusted) {
        Import-Certificate `
            -FilePath $crt `
            -CertStoreLocation Cert:\LocalMachine\Root *> $null
        Write-Ok "Сертификат добавлен в доверенные на этом компьютере"
    }
}

function Ensure-FirewallRule {
    param(
        [string]$HostAddress,
        [int]$ListenPort
    )
    $rule = Get-NetFirewallRule -Name $FirewallRuleName -ErrorAction SilentlyContinue
    if (-not $rule) {
        New-NetFirewallRule `
            -Name $FirewallRuleName `
            -DisplayName "Borotalk через Radmin VPN" `
            -Direction Inbound `
            -Action Allow `
            -Protocol TCP `
            -LocalAddress $HostAddress `
            -RemoteAddress "26.0.0.0/8" `
            -LocalPort $ListenPort `
            -Profile Any *> $null
    } else {
        Set-NetFirewallRule `
            -Name $FirewallRuleName `
            -Enabled True `
            -Action Allow `
            -LocalAddress $HostAddress `
            -RemoteAddress "26.0.0.0/8" `
            -Profile Any *> $null
        Get-NetFirewallPortFilter -AssociatedNetFirewallRule $rule |
            Set-NetFirewallPortFilter -Protocol TCP -LocalPort $ListenPort *> $null
    }
    Write-Ok "Firewall разрешает порт $ListenPort только для сети Radmin"
}

function Ensure-Invite {
    param([hashtable]$Compose)
    $storedInvite = ""
    if (Test-Path -LiteralPath $InviteFile) {
        $storedInvite = (Get-Content -LiteralPath $InviteFile -Raw -Encoding UTF8).Trim()
    }

    if ($storedInvite) {
        $safeInvite = $storedInvite.Replace("'", "''")
        $checkSql = "SELECT code FROM invites WHERE code='$safeInvite' AND revoked=FALSE AND (expires_at IS NULL OR expires_at > NOW()) AND (max_uses IS NULL OR current_uses < max_uses) LIMIT 1;"
        $check = Invoke-Compose $Compose @(
            "exec", "-T", "postgres",
            "psql", "-At", "-U", "app", "-d", "app", "-c", $checkSql
        )
        if (($check -join "").Trim() -eq $storedInvite) {
            return $storedInvite
        }
    }

    $newInvite = "boro-" + (New-RandomHex -Bytes 8)
    $insertSql = "INSERT INTO invites (code, created_by, expires_at, max_uses, current_uses, revoked) VALUES ('$newInvite', NULL, NOW() + INTERVAL '30 days', 50, 0, FALSE);"
    Invoke-Compose $Compose @(
        "exec", "-T", "postgres",
        "psql", "-v", "ON_ERROR_STOP=1", "-U", "app", "-d", "app", "-c", $insertSql
    ) *> $null
    Set-Content -LiteralPath $InviteFile -Value $newInvite -Encoding UTF8
    return $newInvite
}

function Write-FriendBundle {
    param(
        [string]$Url,
        [string]$Invite
    )
    New-Item -ItemType Directory -Path $ShareDir -Force *> $null
    Copy-Item `
        -LiteralPath (Join-Path $ProjectRoot "ssl\cert.crt") `
        -Destination (Join-Path $ShareDir "Borotalk-cert.crt") `
        -Force

    $certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new(
        (Join-Path $ProjectRoot "ssl\cert.crt")
    )
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $fingerprintBytes = $sha256.ComputeHash($certificate.RawData)
        $certificateFingerprint = (
            [System.BitConverter]::ToString($fingerprintBytes)
        ).Replace("-", "")
    } finally {
        $sha256.Dispose()
        $certificate.Dispose()
    }

    $desktopConnection = [ordered]@{
        schema_version = 1
        base_url = $Url.TrimEnd("/")
        invite_code = $Invite
        certificate_sha256 = $certificateFingerprint
    }
    $desktopConnection |
        ConvertTo-Json |
        Set-Content `
            -LiteralPath (Join-Path $ShareDir "Borotalk-connect.borotalk") `
            -Encoding UTF8

    $instructions = @"
BOROTALK — КАК ЗАЙТИ
====================

BOROTALK DESKTOP (рекомендуется)
1. Установите Radmin VPN и войдите в сеть хоста.
2. Установите Borotalk Desktop.
3. Откройте в нём файл Borotalk-connect.borotalk.
4. Войдите или зарегистрируйте отдельный аккаунт. Инвайт уже заполнен.

БРАУЗЕР (старый способ)
1. Установите Radmin VPN и войдите в сеть хоста.
2. Откройте Borotalk-cert.crt.
3. Установите сертификат для «Локального компьютера» в хранилище
   «Доверенные корневые центры сертификации».
4. Полностью перезапустите Chrome или Edge.
5. Откройте:
   $Url
6. Зарегистрируйте отдельный аккаунт:
   ${Url}register.html
7. Инвайт-код:
   $Invite
8. Получите у хоста ID сервера, нажмите 🔎 и войдите по этому ID.

Каждому человеку нужен отдельный аккаунт. Не используйте один Demo User на всех.
"@
    Set-Content `
        -LiteralPath (Join-Path $ShareDir "КАК ЗАЙТИ.txt") `
        -Value $instructions `
        -Encoding UTF8
}

function Start-BorotalkServer {
    param(
        [string]$Python,
        [string]$HealthUrl
    )
    Stop-ManagedServer

    $listeners = @(
        Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
    )
    if ($listeners.Count -gt 0) {
        $owners = ($listeners | Select-Object -ExpandProperty OwningProcess -Unique) -join ", "
        throw "Порт $Port уже занят процессом $owners. Закройте его или запустите лаунчер с другим портом."
    }

    New-Item -ItemType Directory -Path $LogDir -Force *> $null
    $stdout = Join-Path $LogDir "server-output.log"
    $stderr = Join-Path $LogDir "server-error.log"
    Set-Content -LiteralPath $stdout -Value "" -Encoding UTF8
    Set-Content -LiteralPath $stderr -Value "" -Encoding UTF8

    $serverScript = Join-Path $ProjectRoot "run_https.py"
    $process = Start-Process `
        -FilePath $Python `
        -ArgumentList @(
            "`"$serverScript`"",
            "--host", "0.0.0.0",
            "--port", $Port
        ) `
        -WorkingDirectory $ProjectRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr `
        -PassThru
    Set-Content -LiteralPath $PidFile -Value $process.Id -Encoding UTF8

    try {
        $deadline = (Get-Date).AddSeconds(40)
        while ((Get-Date) -lt $deadline) {
            if ($process.HasExited) {
                $details = (Get-Content -LiteralPath $stderr -Raw -ErrorAction SilentlyContinue)
                throw "Сервер завершился при запуске. $details"
            }
            if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
                $statusCode = & curl.exe `
                    --silent `
                    --insecure `
                    --output NUL `
                    --write-out "%{http_code}" `
                    --max-time 3 `
                    $HealthUrl
                if (($statusCode -join "").Trim() -eq "200") {
                    $listener = Get-NetTCPConnection `
                        -State Listen `
                        -LocalPort $Port `
                        -ErrorAction SilentlyContinue |
                        Select-Object -First 1
                    if ($listener) {
                        Set-Content -LiteralPath $PidFile -Value $listener.OwningProcess -Encoding UTF8
                    }
                    return
                }
            } else {
                try {
                    $client = [System.Net.Sockets.TcpClient]::new()
                    $client.Connect("127.0.0.1", $Port)
                    $client.Dispose()
                    return
                } catch {
                    # Retry until the deadline.
                }
            }
            Start-Sleep -Seconds 1
        }
        throw "Сервер не ответил за 40 секунд. Логи: $LogDir"
    } catch {
        Stop-ManagedServer
        throw
    }
}

function Show-Check {
    Write-Host "Borotalk — проверка one-click launcher" -ForegroundColor Cyan
    Write-Host "Проект: $ProjectRoot"
    $detected = Get-RadminIPv4
    if ($detected) { Write-Ok "Radmin IP: $detected" } else { Write-Warn "Radmin IP не найден" }
    if (Get-Command docker -ErrorAction SilentlyContinue) { Write-Ok "Docker найден" } else { Write-Warn "Docker не найден" }
    if ((Get-Command py -ErrorAction SilentlyContinue) -or (Get-Command python -ErrorAction SilentlyContinue)) {
        Write-Ok "Python найден"
    } else {
        Write-Warn "Python не найден"
    }
    foreach ($path in @($ComposeFile, $RequirementsFile, (Join-Path $ProjectRoot "run_https.py"))) {
        if (Test-Path -LiteralPath $path) { Write-Ok $path } else { Write-Warn "Нет файла: $path" }
    }
}

try {
    Set-Location -LiteralPath $ProjectRoot

    if ($CheckOnly) {
        Show-Check
        exit 0
    }

    if (-not $NoElevate -and -not (Test-IsAdministrator)) {
        Write-Host "Borotalk запросит права администратора для HTTPS и Firewall."
        Start-ElevatedCopy
        exit 0
    }

    New-Item -ItemType Directory -Path $StateDir -Force *> $null
    Remove-Item -LiteralPath $LauncherErrorFile -Force -ErrorAction SilentlyContinue

    if ($Stop) {
        Write-Stage "Остановка"
        Stop-ManagedServer
        Write-Host ""
        Write-Host "Можно закрыть это окно." -ForegroundColor Green
        exit 0
    }

    Write-Host "==============================================" -ForegroundColor DarkGray
    Write-Host "       BOROTALK — АВТОМАТИЧЕСКИЙ ЗАПУСК" -ForegroundColor Green
    Write-Host "==============================================" -ForegroundColor DarkGray

    Write-Stage "Radmin VPN"
    if (-not $RadminIp) {
        $RadminIp = Get-RadminIPv4
    }
    if (-not $RadminIp) {
        throw "Radmin VPN не найден. Запустите Radmin VPN, включите сервис и повторите двойной клик."
    }
    if (-not (Test-IPv4 $RadminIp)) {
        throw "Некорректный Radmin IP: $RadminIp"
    }
    Write-Ok "IP хоста: $RadminIp"

    Write-Stage "Локальные настройки"
    $jwtSecret = Get-EnvValue "JWT_SECRET_KEY"
    if (-not $jwtSecret -or $jwtSecret -like "CHANGE_ME*") {
        $jwtSecret = New-RandomHex -Bytes 48
    }
    $pfxPassword = Get-EnvValue "SSL_PFX_PASSWORD"
    if (-not $pfxPassword) {
        if (Test-Path -LiteralPath (Join-Path $ProjectRoot "ssl\voice.pfx")) {
            $pfxPassword = "1234"
        } else {
            $pfxPassword = New-RandomHex -Bytes 16
        }
    }
    $publicUrl = "https://${RadminIp}:$Port/"
    $hostUrl = "https://localhost:$Port/"
    Set-EnvValue "APP_ENV" "development"
    Set-EnvValue "RADMIN_IP" $RadminIp
    Set-EnvValue "SSL_PORT" $Port
    Set-EnvValue "SSL_PFX_PASSWORD" $pfxPassword
    Set-EnvValue "COOKIE_SECURE" "true"
    Set-EnvValue "JWT_SECRET_KEY" $jwtSecret
    Set-EnvValue "PUBLIC_BASE_URL" ""
    Set-EnvValue "PUBLIC_API_BASE_URL" ""
    Set-EnvValue "PUBLIC_WS_BASE_URL" ""
    Set-EnvValue "ALLOWED_ORIGINS" $publicUrl.TrimEnd("/")
    Write-Ok ".env подготовлен"

    Write-Stage "Docker"
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw "Docker не найден. Установите Docker Desktop и повторите запуск."
    }
    if (-not (Test-NativeCommand "docker" @("info"))) {
        Write-Host "  Запускаю Docker Desktop..."
        if (-not (Start-DockerDesktopIfAvailable)) {
            throw "Docker Desktop не запущен и не найден в стандартной папке."
        }
        if (-not (Wait-ForDocker)) {
            throw "Docker Desktop не запустился за 2 минуты."
        }
    }
    $compose = Resolve-Compose
    if (-not $compose) {
        throw "Docker Compose не найден."
    }
    Invoke-Compose $compose @("up", "-d")
    if (-not (Wait-ForInfrastructure $compose)) {
        throw "PostgreSQL или Redis не готовы. Проверьте Docker Desktop."
    }
    Write-Ok "PostgreSQL и Redis готовы"

    Write-Stage "Приложение"
    $python = Resolve-Python
    Install-DependenciesIfNeeded $python
    & $python -m alembic upgrade head
    if ($LASTEXITCODE -ne 0) {
        throw "Не удалось применить миграции базы данных."
    }
    Write-Ok "База данных обновлена"

    Write-Stage "HTTPS и Firewall"
    Ensure-Certificate $RadminIp $pfxPassword
    Ensure-FirewallRule $RadminIp $Port

    Write-Stage "Доступ для друзей"
    $invite = Ensure-Invite $compose
    Write-FriendBundle $publicUrl $invite
    $clipboard = "Borotalk: $publicUrl`r`nИнвайт: $invite"
    try {
        Set-Clipboard -Value $clipboard
        Write-Ok "Адрес и инвайт скопированы в буфер обмена"
    } catch {
        Write-Warn "Не удалось скопировать адрес в буфер обмена"
    }

    Write-Stage "Запуск"
    Start-BorotalkServer $python $hostUrl

    Write-Host ""
    Write-Host "==============================================" -ForegroundColor DarkGray
    Write-Host " BOROTALK ЗАПУЩЕН" -ForegroundColor Green
    Write-Host " Для вас:    $hostUrl" -ForegroundColor White
    Write-Host " Для друзей: $publicUrl" -ForegroundColor White
    Write-Host " Инвайт: $invite" -ForegroundColor White
    Write-Host " Папка друзьям: $ShareDir" -ForegroundColor White
    Write-Host "==============================================" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "Отправьте друзьям содержимое BOROTALK_SHARE и данные сети Radmin." -ForegroundColor Cyan
    Write-Host "Для остановки используйте STOP_BOROTALK.bat." -ForegroundColor Cyan

    if (-not $NoBrowser) {
        Start-Process -FilePath $hostUrl
        Start-Process -FilePath "explorer.exe" -ArgumentList "`"$ShareDir`""
    }

    Write-Host ""
    Read-Host "Нажмите Enter, чтобы закрыть окно запуска (сервер продолжит работать)"
    exit 0
} catch {
    $errorMessage = $_.Exception.Message
    $errorLog = $LauncherErrorFile
    try {
        New-Item -ItemType Directory -Path $StateDir -Force *> $null
        @(
            "Time: $([DateTime]::Now.ToString('s'))"
            "Error: $errorMessage"
            "Stack: $($_.ScriptStackTrace)"
        ) | Set-Content -LiteralPath $errorLog -Encoding UTF8
    } catch {
        $errorLog = ""
    }
    Write-Host ""
    Write-Host "ОШИБКА: $errorMessage" -ForegroundColor Red
    if ($errorLog) {
        Write-Host "Лог: $errorLog" -ForegroundColor DarkGray
    }
    Write-Host ""
    Write-Host "Исправьте указанную проблему и снова запустите START_BOROTALK.bat." -ForegroundColor Yellow
    if ($PauseOnError) {
        Write-Host ""
        Read-Host "Нажмите Enter, чтобы закрыть окно"
    }
    exit 1
}
