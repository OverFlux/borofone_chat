from pathlib import Path
import inspect

import uvicorn

ROOT = Path(__file__).resolve().parents[1]


def test_one_click_launchers_are_present_and_delegate_to_powershell():
    start = (ROOT / "START_BOROTALK.bat").read_text(encoding="utf-8")
    stop = (ROOT / "STOP_BOROTALK.bat").read_text(encoding="utf-8")

    assert "Start-Borotalk.ps1" in start
    assert "Start-Borotalk.ps1" in stop
    assert "-Stop" in stop


def test_radmin_launcher_prepares_complete_local_stack():
    launcher = (ROOT / "scripts" / "Start-Borotalk.ps1").read_text(encoding="utf-8-sig")

    required_fragments = (
        "Get-RadminIPv4",
        "Test-NativeCommand",
        "PauseOnError",
        "launcher-error.log",
        '"up", "-d"',
        "-m alembic upgrade head",
        "Ensure-Certificate",
        "Ensure-FirewallRule",
        '"26.0.0.0/8"',
        "Ensure-Invite",
        "BOROTALK_SHARE",
        "Borotalk-cert.crt",
        "Borotalk-connect.borotalk",
        "certificate_sha256",
        "schema_version = 1",
        "run_https.py",
        "0.0.0.0",
        "server.pid",
        'https://localhost:$Port/',
        "curl.exe",
        "Stop-ProcessTree",
    )
    for fragment in required_fragments:
        assert fragment in launcher

    friend_bundle = launcher[launcher.index("function Write-FriendBundle"):launcher.index("function Start-BorotalkServer")]
    assert "cert.crt" in friend_bundle
    assert "certificate.RawData" in friend_bundle
    assert "SHA256" in friend_bundle
    assert "$Url.TrimEnd" in friend_bundle
    assert "voice.pfx" not in friend_bundle
    assert "key.pem" not in friend_bundle


def test_certificate_script_creates_ip_san_and_exportable_server_certificate():
    certificate_script = (ROOT / "scripts" / "generate_ssl.ps1").read_text(encoding="utf-8-sig")

    assert "IPAddress=$IpAddress" in certificate_script
    assert "1.3.6.1.5.5.7.3.1" in certificate_script
    assert "-KeyExportPolicy Exportable" in certificate_script
    assert "-Force:$Force" in certificate_script


def test_https_runner_only_passes_supported_uvicorn_options():
    runner = (ROOT / "run_https.py").read_text(encoding="utf-8")
    run_parameters = inspect.signature(uvicorn.run).parameters

    assert "limit_concurrency" in run_parameters
    assert "limit_max_requests" in run_parameters
    assert "http_max_header_size" not in runner
    assert "max_request_body_size" not in runner
