[CmdletBinding()]
param(
    [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $OutputPath) {
    $OutputPath = Join-Path $projectRoot "Borotalk-VPS-Installer.run"
}
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("borotalk-vps-bundle-" + [guid]::NewGuid().ToString("N"))
$stagingRoot = Join-Path $temporaryRoot "source"
$archivePath = Join-Path $temporaryRoot "source.tar.gz"

try {
    New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
    $files = @(
        git -C $projectRoot ls-files --cached --others --exclude-standard |
            Where-Object { $_ -notlike "docs/releases/*" }
    )
    if ($LASTEXITCODE -ne 0 -or $files.Count -eq 0) {
        throw "Could not read the repository file list."
    }

    foreach ($relativePath in $files) {
        if (-not $relativePath) {
            continue
        }
        $sourcePath = Join-Path $projectRoot $relativePath
        if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
            continue
        }
        $targetPath = Join-Path $stagingRoot $relativePath
        $targetDirectory = Split-Path -Parent $targetPath
        New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null
        Copy-Item -LiteralPath $sourcePath -Destination $targetPath
    }

    tar -czf $archivePath -C $stagingRoot .
    if ($LASTEXITCODE -ne 0) {
        throw "Could not build the tar.gz archive."
    }
    $archiveListing = @(tar -tzf $archivePath)
    if ($LASTEXITCODE -ne 0) {
        throw "Could not verify the tar.gz archive."
    }
    foreach ($requiredFile in @(
        "./INSTALL_VPS.sh",
        "./app/main.py",
        "./deploy/docker/docker-compose.prod.yml"
    )) {
        if ($requiredFile -notin $archiveListing) {
            throw "Required bundle file is missing: $requiredFile"
        }
    }
    if ("./.env" -in $archiveListing) {
        throw "Refusing to include .env in the VPS bundle."
    }

    $header = @'
#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this file with sudo: sudo bash Borotalk-VPS-Installer.run" >&2
  exit 1
fi

install_dir="${BOROTALK_INSTALL_DIR:-/opt/borotalk}"
bundle_mode="${1:-install}"

if [ "${bundle_mode}" = "--check" ]; then
  [ -f "${install_dir}/INSTALL_VPS.sh" ] || {
    echo "Borotalk is not installed in ${install_dir}." >&2
    exit 1
  }
  exec bash "${install_dir}/INSTALL_VPS.sh" --check
fi

if [ "${bundle_mode}" != "install" ] && [ "${bundle_mode}" != "--update" ]; then
  echo "Usage: sudo bash Borotalk-VPS-Installer.run [--check|--update]" >&2
  exit 1
fi

has_existing_install=0
if [ -e "${install_dir}" ] && [ -n "$(find "${install_dir}" -mindepth 1 -print -quit 2>/dev/null)" ]; then
  has_existing_install=1
  if [ "${bundle_mode}" != "--update" ]; then
    echo "${install_dir} already exists. To check or update it, run:" >&2
    echo "sudo bash Borotalk-VPS-Installer.run --check" >&2
    echo "sudo bash Borotalk-VPS-Installer.run --update" >&2
    exit 1
  fi
  [ -f "${install_dir}/.borotalk-bundled-source" ] || {
    echo "${install_dir} was not installed from a self-contained Borotalk bundle." >&2
    echo "Use: sudo bash ${install_dir}/INSTALL_VPS.sh --update" >&2
    exit 1
  }
fi

mkdir -p "${install_dir}"
archive_line="$(awk '/^__BOROTALK_ARCHIVE_BELOW__$/ {print NR + 1; exit}' "$0")"
if [ -z "${archive_line}" ]; then
  echo "The embedded archive was not found." >&2
  exit 1
fi
tail -n +"${archive_line}" "$0" | tar -xzf - -C "${install_dir}"
touch "${install_dir}/.borotalk-bundled-source"

if [ "${has_existing_install}" = "1" ]; then
  cd "${install_dir}"
  SKIP_GIT_SYNC=1 bash deploy/scripts/deploy-stack.sh production
  exec bash "${install_dir}/INSTALL_VPS.sh" --check
fi

BOROTALK_USE_EXISTING_SOURCE=1 BOROTALK_INSTALL_DIR="${install_dir}" \
  bash "${install_dir}/INSTALL_VPS.sh"
exit 0
__BOROTALK_ARCHIVE_BELOW__
'@
    $header = $header.Replace("`r`n", "`n")
    if (-not $header.EndsWith("`n")) {
        $header += "`n"
    }

    $outputDirectory = Split-Path -Parent $resolvedOutput
    New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
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
        try {
            $archiveStream.CopyTo($outputStream)
        }
        finally {
            $archiveStream.Dispose()
        }
    }
    finally {
        $outputStream.Dispose()
    }

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
