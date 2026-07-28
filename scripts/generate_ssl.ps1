# SSL Certificate Generation Script for Windows
# Run this script in PowerShell as Administrator

param(
    [string]$IpAddress = "",
    [string]$OutputDir = ".\ssl",
    [string]$Password = "",
    [switch]$Force
)

if (-not $IpAddress) {
    $IpAddress = if ($env:BOROFONE_PUBLIC_HOST) { $env:BOROFONE_PUBLIC_HOST } else { "localhost" }
}

if (-not $Password) {
    $Password = if ($env:BOROFONE_SSL_PFX_PASSWORD) { $env:BOROFONE_SSL_PFX_PASSWORD } else { "1234" }
}

Write-Host "=== SSL Certificate Generation for Borofone Chat ===" -ForegroundColor Cyan
Write-Host "IP Address: $IpAddress" -ForegroundColor Yellow
Write-Host "Output Directory: $OutputDir" -ForegroundColor Yellow
Write-Host ""

if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir | Out-Null
    Write-Host "Created directory: $OutputDir" -ForegroundColor Green
}

Write-Host "Step 1: Creating self-signed certificate..." -ForegroundColor Cyan
$parsedIp = $null
$isIpAddress = [System.Net.IPAddress]::TryParse($IpAddress, [ref]$parsedIp)
$subjectAlternativeName = if ($isIpAddress) {
    "2.5.29.17={text}IPAddress=$IpAddress&DNS=localhost"
} else {
    "2.5.29.17={text}DNS=$IpAddress&DNS=localhost"
}
$cert = New-SelfSignedCertificate `
    -Type Custom `
    -Subject "CN=$IpAddress" `
    -CertStoreLocation "cert:\LocalMachine\My" `
    -FriendlyName "Borofone Chat SSL" `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -HashAlgorithm SHA256 `
    -KeyExportPolicy Exportable `
    -KeyUsage DigitalSignature, KeyEncipherment `
    -TextExtension @(
        "2.5.29.37={text}1.3.6.1.5.5.7.3.1",
        $subjectAlternativeName
    ) `
    -NotAfter (Get-Date).AddYears(5)

Write-Host "Certificate created with Thumbprint: $($cert.Thumbprint)" -ForegroundColor Green

Write-Host "Step 2: Exporting to PFX format..." -ForegroundColor Cyan
$pfxPath = Join-Path $OutputDir "voice.pfx"
$securePassword = ConvertTo-SecureString -String $Password -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $securePassword -Force:$Force | Out-Null
Write-Host "PFX exported to: $pfxPath" -ForegroundColor Green

Write-Host "Step 3: Exporting public certificate..." -ForegroundColor Cyan
$crtPath = Join-Path $OutputDir "cert.crt"
Export-Certificate -Cert $cert -FilePath $crtPath -Type CERT -Force:$Force | Out-Null
Write-Host "Public certificate exported to: $crtPath" -ForegroundColor Green

Write-Host "Step 4: Converting to PEM format..." -ForegroundColor Cyan
$keyPemPath = Join-Path $OutputDir "key.pem"
$certPemPath = Join-Path $OutputDir "cert.pem"
$opensslAvailable = Get-Command openssl -ErrorAction SilentlyContinue

if ($opensslAvailable) {
    openssl pkcs12 -in $pfxPath -nocerts -out $keyPemPath -nodes -passin pass:$Password 2>$null
    openssl pkcs12 -in $pfxPath -clcerts -nokeys -out $certPemPath -passin pass:$Password 2>$null
    Write-Host "PEM files created:" -ForegroundColor Green
    Write-Host "  - $keyPemPath (private key)" -ForegroundColor Yellow
    Write-Host "  - $certPemPath (certificate)" -ForegroundColor Yellow
} else {
    $certBase64 = [Convert]::ToBase64String($cert.RawData, [Base64FormattingOptions]::InsertLineBreaks)
    $certPemContent = "-----BEGIN CERTIFICATE-----`n$certBase64`n-----END CERTIFICATE-----"
    Set-Content -Path $certPemPath -Value $certPemContent
    Write-Host "Certificate PEM created: $certPemPath" -ForegroundColor Green
    Write-Host "OpenSSL not found. Use PFX directly or install OpenSSL to extract the private key." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Certificate Generation Complete ===" -ForegroundColor Cyan
Get-ChildItem $OutputDir | ForEach-Object { Write-Host "  - $($_.Name)" -ForegroundColor Yellow }
