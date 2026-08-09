[CmdletBinding()]
param(
    [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $OutputPath) {
    $OutputPath = Join-Path $projectRoot "Borotalk-VPS-Native-Installer.run"
}
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("borotalk-native-vps-bundle-" + [guid]::NewGuid().ToString("N"))
$stagingRoot = Join-Path $temporaryRoot "source"
$archivePath = Join-Path $temporaryRoot "source.tar.gz"

try {
    New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
    $files = @(
        git -C $projectRoot ls-files --cached --others --exclude-standard |
            Where-Object { $_ -notlike "docs/releases/*" -and $_ -notlike "*.run" }
    )
    if ($LASTEXITCODE -ne 0 -or $files.Count -eq 0) {
        throw "Could not read the repository file list."
    }
    foreach ($relativePath in $files) {
        if (-not $relativePath) { continue }
        $sourcePath = Join-Path $projectRoot $relativePath
        if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { continue }
        $targetPath = Join-Path $stagingRoot $relativePath
        New-Item -ItemType Directory -Path (Split-Path -Parent $targetPath) -Force | Out-Null
        Copy-Item -LiteralPath $sourcePath -Destination $targetPath
        # Git may check files out with CRLF on Windows. Linux entrypoints and
        # systemd/nginx/coturn configuration must be packaged with LF endings.
        if ($relativePath -like "*.sh" -or $relativePath -like "deploy/native/*") {
            $bytes = [System.IO.File]::ReadAllBytes($targetPath)
            $text = [System.Text.Encoding]::UTF8.GetString($bytes).Replace("`r`n", "`n")
            [System.IO.File]::WriteAllText(
                $targetPath,
                $text,
                [System.Text.UTF8Encoding]::new($false)
            )
        }
    }

    tar -czf $archivePath -C $stagingRoot .
    if ($LASTEXITCODE -ne 0) { throw "Could not build the source archive." }
    $archiveListing = @(tar -tzf $archivePath)
    foreach ($requiredFile in @(
        "./INSTALL_VPS_NATIVE.sh",
        "./app/main.py",
        "./deploy/native/borotalk-api.service"
    )) {
        if ($requiredFile -notin $archiveListing) {
            throw "Required bundle file is missing: $requiredFile"
        }
    }
    if ("./.env" -in $archiveListing -or "./.env.local-vps" -in $archiveListing) {
        throw "Refusing to include a local environment file in the VPS bundle."
    }
    $validationRoot = Join-Path $temporaryRoot "validation"
    New-Item -ItemType Directory -Path $validationRoot -Force | Out-Null
    tar -xzf $archivePath -C $validationRoot ./INSTALL_VPS_NATIVE.sh ./deploy/scripts/backup-native-data.sh
    if ($LASTEXITCODE -ne 0) { throw "Could not validate Linux entrypoints." }
    foreach ($entrypoint in @(
        (Join-Path $validationRoot "INSTALL_VPS_NATIVE.sh"),
        (Join-Path $validationRoot "deploy/scripts/backup-native-data.sh")
    )) {
        $bytes = [System.IO.File]::ReadAllBytes($entrypoint)
        if ($bytes -contains 13) {
            throw "Linux entrypoint contains a carriage return: $entrypoint"
        }
    }

    $header = @'
#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo: sudo bash Borotalk-VPS-Native-Installer.run" >&2
  exit 1
fi

install_dir="${BOROTALK_INSTALL_DIR:-/opt/borotalk}"
bundle_mode="${1:-install}"

case "${bundle_mode}" in
  --check|--switch-host)
    [ -f "${install_dir}/INSTALL_VPS_NATIVE.sh" ] || {
      echo "Borotalk is not installed in ${install_dir}." >&2
      exit 1
    }
    exec bash "${install_dir}/INSTALL_VPS_NATIVE.sh" "$@"
    ;;
  install|--update) ;;
  *)
    echo "Usage: sudo bash Borotalk-VPS-Native-Installer.run [--check|--update|--switch-host DOMAIN]" >&2
    exit 1
    ;;
esac

has_existing_install=0
if [ -e "${install_dir}" ] && [ -n "$(find "${install_dir}" -mindepth 1 -print -quit 2>/dev/null)" ]; then
  has_existing_install=1
  if [ "${bundle_mode}" != "--update" ]; then
    echo "${install_dir} already exists. Use --check or --update." >&2
    exit 1
  fi
  [ -f "${install_dir}/.borotalk-native-bundled-source" ] || {
    echo "The existing installation was not created by the native bundle." >&2
    exit 1
  }
fi

install -d -m 0755 "${install_dir}"
archive_line="$(awk '/^__BOROTALK_NATIVE_ARCHIVE_BELOW__$/ {print NR + 1; exit}' "$0")"
[ -n "${archive_line}" ] || { echo "Embedded archive not found." >&2; exit 1; }
tail -n +"${archive_line}" "$0" | tar -xzf - -C "${install_dir}"
touch "${install_dir}/.borotalk-native-bundled-source"

if [ "${has_existing_install}" = "1" ]; then
  exec bash "${install_dir}/INSTALL_VPS_NATIVE.sh" --update
fi
exec bash "${install_dir}/INSTALL_VPS_NATIVE.sh"
exit 0
__BOROTALK_NATIVE_ARCHIVE_BELOW__
'@
    $header = $header.Replace("`r`n", "`n")
    if (-not $header.EndsWith("`n")) { $header += "`n" }

    New-Item -ItemType Directory -Path (Split-Path -Parent $resolvedOutput) -Force | Out-Null
    $outputStream = [System.IO.File]::Open(
        $resolvedOutput,
        [System.IO.FileMode]::Create,
        [System.IO.FileAccess]::Write,
        [System.IO.FileShare]::None
    )
    try {
        $headerBytes = [System.Text.UTF8Encoding]::new($false).GetBytes($header)
        $outputStream.Write($headerBytes, 0, $headerBytes.Length)
        $archiveStream = [System.IO.File]::OpenRead($archivePath)
        try { $archiveStream.CopyTo($outputStream) }
        finally { $archiveStream.Dispose() }
    }
    finally { $outputStream.Dispose() }

    $sizeMb = [math]::Round((Get-Item -LiteralPath $resolvedOutput).Length / 1MB, 2)
    Write-Host "Built: $resolvedOutput ($sizeMb MB)"
}
finally {
    if (Test-Path -LiteralPath $temporaryRoot) {
        $resolvedTemporaryRoot = (Resolve-Path -LiteralPath $temporaryRoot).Path
        $expectedPrefix = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
        if ($resolvedTemporaryRoot.StartsWith($expectedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $resolvedTemporaryRoot -Recurse -Force
        }
    }
}
