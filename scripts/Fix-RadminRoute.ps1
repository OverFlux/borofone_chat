param(
    [switch]$NoElevate,
    [switch]$CheckOnly,
    [switch]$Quiet,
    [switch]$PauseOnExit
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$RadminNetwork = "26.0.0.0/8"
$GuardPrefixes = @("26.0.0.0/9", "26.128.0.0/9")
$OutboundFirewallRule = "BorotalkRadminNetworkOutbound"

function Write-Status {
    param(
        [string]$Message,
        [ConsoleColor]$Color = [ConsoleColor]::Gray
    )
    if (-not $Quiet) {
        Write-Host $Message -ForegroundColor $Color
    }
}

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-RadminConnection {
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
            Where-Object { $_.IPAddress -like "26.*" } |
            Select-Object -First 1
        if ($address) {
            return [pscustomobject]@{
                Adapter = $adapter
                Address = $address.IPAddress
            }
        }
    }
    return $null
}

function Get-ActiveTunnelAdapters {
    param([uint32]$RadminInterfaceIndex)

    return @(
        Get-NetAdapter -IncludeHidden -ErrorAction SilentlyContinue |
            Where-Object {
                $_.Status -eq "Up" -and
                $_.ifIndex -ne $RadminInterfaceIndex -and (
                    $_.Name -match "Amnezia|Wintun|WireGuard|OpenVPN|ovpn|tun2" -or
                    $_.InterfaceDescription -match "Amnezia|Wintun|WireGuard|OpenVPN|ovpn|tun2"
                )
            }
    )
}

function Test-RadminRoute {
    param([uint32]$InterfaceIndex)

    foreach ($prefix in $GuardPrefixes) {
        $route = Get-NetRoute `
            -AddressFamily IPv4 `
            -DestinationPrefix $prefix `
            -InterfaceIndex $InterfaceIndex `
            -ErrorAction SilentlyContinue |
            Where-Object { $_.NextHop -eq "0.0.0.0" } |
            Select-Object -First 1
        if (-not $route) {
            return $false
        }
    }
    return $true
}

function Repair-RadminRoute {
    param($Connection)

    $adapter = $Connection.Adapter
    Set-NetIPInterface `
        -InterfaceIndex $adapter.ifIndex `
        -AddressFamily IPv4 `
        -AutomaticMetric Disabled `
        -InterfaceMetric 1 *> $null

    foreach ($prefix in $GuardPrefixes) {
        $route = Get-NetRoute `
            -AddressFamily IPv4 `
            -DestinationPrefix $prefix `
            -InterfaceIndex $adapter.ifIndex `
            -ErrorAction SilentlyContinue |
            Where-Object { $_.NextHop -eq "0.0.0.0" } |
            Select-Object -First 1

        if ($route) {
            if ($route.RouteMetric -ne 1) {
                Set-NetRoute -InputObject $route -RouteMetric 1 *> $null
            }
        } else {
            New-NetRoute `
                -AddressFamily IPv4 `
                -DestinationPrefix $prefix `
                -InterfaceIndex $adapter.ifIndex `
                -NextHop "0.0.0.0" `
                -RouteMetric 1 `
                -PolicyStore ActiveStore *> $null
        }
    }

    $rule = Get-NetFirewallRule -Name $OutboundFirewallRule -ErrorAction SilentlyContinue
    if ($rule) {
        Set-NetFirewallRule `
            -Name $OutboundFirewallRule `
            -Enabled True `
            -Direction Outbound `
            -Action Allow `
            -RemoteAddress $RadminNetwork `
            -InterfaceAlias $adapter.Name `
            -Profile Any *> $null
    } else {
        New-NetFirewallRule `
            -Name $OutboundFirewallRule `
            -DisplayName "Borotalk: Radmin VPN outbound" `
            -Description "Allows Borotalk and WebRTC peer traffic only through the Radmin adapter." `
            -Enabled True `
            -Direction Outbound `
            -Action Allow `
            -RemoteAddress $RadminNetwork `
            -InterfaceAlias $adapter.Name `
            -Profile Any *> $null
    }
}

function Show-AmneziaAdvice {
    Write-Host ""
    Write-Host "If AmneziaVPN still blocks Borotalk:" -ForegroundColor Yellow
    Write-Host "  1. Open AmneziaVPN -> Split tunneling -> Sites/IP addresses."
    Write-Host "  2. Select the mode where listed addresses bypass the VPN."
    Write-Host "  3. Add 26.0.0.0/8 and reconnect AmneziaVPN."
    Write-Host "  4. If it is still blocked, disable KillSwitch in AmneziaVPN."
    Write-Host ""
    Write-Host "KillSwitch is an AmneziaVPN filter and cannot be safely bypassed by a Windows route." -ForegroundColor DarkGray
}

try {
    $connection = Get-RadminConnection
    if (-not $connection) {
        throw "An active Radmin VPN adapter with a 26.x.x.x address was not found."
    }

    $adapter = $connection.Adapter
    $activeTunnels = @(Get-ActiveTunnelAdapters -RadminInterfaceIndex $adapter.ifIndex)

    if ($CheckOnly) {
        Write-Status "Radmin VPN: $($connection.Address), interface $($adapter.ifIndex)" Green
        if (Test-RadminRoute -InterfaceIndex $adapter.ifIndex) {
            Write-Status "The Borotalk route is protected from VPN interception." Green
        } else {
            Write-Status "The Borotalk guard routes have not been created yet." Yellow
        }
        if ($activeTunnels.Count -gt 0) {
            Write-Status "Active VPN/TUN adapter: $(($activeTunnels.Name -join ', '))" Yellow
            Show-AmneziaAdvice
        }
        exit 0
    }

    if (-not $NoElevate -and -not (Test-IsAdministrator)) {
        $arguments = @(
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-File", "`"$PSCommandPath`"",
            "-NoElevate",
            "-PauseOnExit"
        )
        Start-Process `
            -FilePath "powershell.exe" `
            -Verb RunAs `
            -ArgumentList ($arguments -join " ")
        exit 0
    }

    if (-not (Test-IsAdministrator)) {
        throw "Administrator rights are required to repair the route."
    }

    Repair-RadminRoute -Connection $connection
    if (-not (Test-RadminRoute -InterfaceIndex $adapter.ifIndex)) {
        throw "Windows did not keep the Radmin guard routes."
    }

    Write-Status "The 26.0.0.0/8 network is pinned to Radmin VPN." Green
    Write-Status "Outbound Borotalk traffic is allowed through the Radmin adapter." Green

    if ($activeTunnels.Count -gt 0) {
        Write-Status "Active VPN/TUN adapter detected: $(($activeTunnels.Name -join ', '))." Yellow
        Show-AmneziaAdvice
    }

    if ($PauseOnExit) {
        Read-Host "Press Enter to close this window"
    }
    exit 0
} catch {
    Write-Host ""
    Write-Host "Could not repair the Radmin route: $($_.Exception.Message)" -ForegroundColor Red
    Show-AmneziaAdvice
    if ($PauseOnExit) {
        Read-Host "Press Enter to close this window"
    }
    exit 1
}
