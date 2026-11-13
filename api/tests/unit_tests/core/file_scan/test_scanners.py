import socket
import threading
from collections.abc import Iterator
from types import ModuleType
from typing import override

import httpx
import pytest

from core.file_scan import base as base_module
from core.file_scan.base import ScannerConfigError, ScannerError, eicar_test_content
from core.file_scan.entities import ScanProblem, ScanStatus, ScanTarget, ScanVerdict
from core.file_scan.scanners import api as api_module
from core.file_scan.scanners.api import CustomEndpointScanner
from core.file_scan.scanners.clamav import ClamAVScanner
from core.file_scan.scanners.cloudmersive import CloudmersiveScanner
from core.file_scan.scanners.metadefender import MetaDefenderScanner
from core.file_scan.scanners.scanii import ScaniiScanner


def _target(content: bytes = b"hello", name: str = "report.docx") -> ScanTarget:
    return ScanTarget(
        scan_id="scan-1",
        file_name=name,
        size=len(content),
        mime_type="application/octet-stream",
        file_hash="hash",
        load=lambda: content,
    )


class _Http:
    """Scripted replacement for the SSRF-proxied request function."""

    def __init__(self, *responses: httpx.Response | Exception) -> None:
        self._responses = list(responses)
        self.calls: list[tuple[str, str, dict[str, object]]] = []

    def __call__(self, method: str, url: str, **kwargs: object) -> httpx.Response:
        self.calls.append((method, url, kwargs))
        response = self._responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def _use_http(monkeypatch: pytest.MonkeyPatch, module: ModuleType, *responses: httpx.Response | Exception) -> _Http:
    http = _Http(*responses)
    monkeypatch.setattr(module, "http_request", http)
    return http


# --- shared behaviour


def test_scan_never_raises_and_reports_unexpected_failures_as_unavailable() -> None:
    class Broken(CloudmersiveScanner):
        @override
        def _scan(self, target: ScanTarget, *, external_id: str | None) -> ScanVerdict:
            raise RuntimeError(f"boom {target.file_name} {external_id}")

    verdict = Broken({"api_key": "k"}, {}).scan(_target())

    assert verdict.status is ScanStatus.UNAVAILABLE
    assert verdict.problem is ScanProblem.INVALID_RESPONSE


def test_verdict_truncates_untrusted_scanner_text() -> None:
    verdict = ScanVerdict.infected(["x" * 500] * 50, engine="e" * 500)

    assert len(verdict.threats) == 20
    assert all(len(threat) == 200 for threat in verdict.threats)
    assert verdict.engine is not None
    assert len(verdict.engine) == 200


@pytest.mark.parametrize(
    ("status", "problem"),
    [
        (401, ScanProblem.AUTH),
        (403, ScanProblem.AUTH),
        (402, ScanProblem.QUOTA),
        (429, ScanProblem.QUOTA),
        (503, ScanProblem.SERVER_ERROR),
        (400, ScanProblem.INVALID_RESPONSE),
    ],
)
def test_provider_status_mapping(status: int, problem: ScanProblem) -> None:
    with pytest.raises(ScannerError) as error:
        base_module.raise_for_provider_status(httpx.Response(status))

    assert error.value.problem is problem


def test_http_request_maps_transport_failures(monkeypatch: pytest.MonkeyPatch) -> None:
    def timeout(*_args: object, **_kwargs: object) -> httpx.Response:
        raise httpx.ReadTimeout("slow")

    monkeypatch.setattr(base_module.ssrf_proxy, "make_request", timeout)
    with pytest.raises(ScannerError) as error:
        base_module.http_request("GET", "https://scanner.example", timeout=5)
    assert error.value.problem is ScanProblem.TIMEOUT

    def refused(*_args: object, **_kwargs: object) -> httpx.Response:
        raise httpx.ConnectError("refused")

    monkeypatch.setattr(base_module.ssrf_proxy, "make_request", refused)
    with pytest.raises(ScannerError) as error:
        base_module.http_request("GET", "https://scanner.example", timeout=5)
    assert error.value.problem is ScanProblem.NETWORK


def test_request_timeout_defaults_to_five_minutes_and_follows_the_deployment_setting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from core.file_scan.scanners import cloudmersive as cloudmersive_module
    from core.file_scan.scanners import scanii as scanii_module

    cloud = _use_http(
        monkeypatch,
        cloudmersive_module,
        httpx.Response(200, json={"CleanResult": True}),
        httpx.Response(200, json={"CleanResult": True}),
    )
    CloudmersiveScanner({"api_key": "k"}, {}).scan(_target())
    CloudmersiveScanner({"api_key": "k"}, {"timeout": 900}).scan(_target())
    assert [call[2]["timeout"] for call in cloud.calls] == [300.0, 900.0]

    scanii = _use_http(monkeypatch, scanii_module, httpx.Response(201, json={"findings": []}))
    ScaniiScanner({"api_key": "k", "api_secret": "s"}, {"region": "us1", "timeout": 120}).scan(_target())
    assert scanii.calls[0][2]["timeout"] == 120.0


# --- Cloudmersive


def _cloudmersive(monkeypatch: pytest.MonkeyPatch, *responses: httpx.Response) -> tuple[CloudmersiveScanner, _Http]:
    from core.file_scan.scanners import cloudmersive as module

    return CloudmersiveScanner({"api_key": "secret"}, {}), _use_http(monkeypatch, module, *responses)


def test_cloudmersive_clean_sends_key_and_allows_non_malware_content(monkeypatch: pytest.MonkeyPatch) -> None:
    scanner, http = _cloudmersive(monkeypatch, httpx.Response(200, json={"CleanResult": True}))

    verdict = scanner.scan(_target())

    assert verdict.status is ScanStatus.CLEAN
    method, url, kwargs = http.calls[0]
    assert (method, url) == ("POST", "https://api.cloudmersive.com/virus/scan/file/advanced")
    headers = kwargs["headers"]
    assert isinstance(headers, dict)
    assert headers["Apikey"] == "secret"
    assert headers["allowMacros"] == "true"
    assert "allowPasswordProtectedFiles" not in headers
    files = kwargs["files"]
    assert isinstance(files, dict)
    assert files["inputFile"][0] == "report.docx"


def test_cloudmersive_infected_password_protected_and_other_rejections(monkeypatch: pytest.MonkeyPatch) -> None:
    scanner, _ = _cloudmersive(
        monkeypatch,
        httpx.Response(
            200, json={"CleanResult": False, "FoundViruses": [{"FileName": "a", "VirusName": "Win.Trojan.X"}]}
        ),
        httpx.Response(200, json={"CleanResult": False, "ContainsPasswordProtectedFile": True}),
        httpx.Response(200, json={"CleanResult": False, "ContainsInvalidFile": True}),
        httpx.Response(413),
        httpx.Response(401),
        httpx.Response(200, json={}),
    )

    infected = scanner.scan(_target())
    assert infected.status is ScanStatus.INFECTED
    assert infected.threats == ("Win.Trojan.X",)
    encrypted = scanner.scan(_target())
    assert (encrypted.status, encrypted.problem) == (ScanStatus.UNSCANNABLE, ScanProblem.ENCRYPTED)
    unsupported = scanner.scan(_target())
    assert (unsupported.status, unsupported.problem) == (ScanStatus.UNSCANNABLE, ScanProblem.UNSUPPORTED)
    too_large = scanner.scan(_target())
    assert (too_large.status, too_large.problem) == (ScanStatus.UNSCANNABLE, ScanProblem.TOO_LARGE)
    auth = scanner.scan(_target())
    assert (auth.status, auth.problem) == (ScanStatus.UNAVAILABLE, ScanProblem.AUTH)
    malformed = scanner.scan(_target())
    assert (malformed.status, malformed.problem) == (ScanStatus.UNAVAILABLE, ScanProblem.INVALID_RESPONSE)


def test_cloudmersive_settings_validation() -> None:
    with pytest.raises(ScannerConfigError):
        CloudmersiveScanner.validate_settings({}, {})
    with pytest.raises(ScannerConfigError):
        CloudmersiveScanner.validate_settings({"api_key": "k"}, {"endpoint": "http://insecure.example"})
    CloudmersiveScanner.validate_settings({"api_key": "k"}, {"endpoint": "https://private.example"})


# --- Scanii


def test_scanii_uses_region_and_basic_auth_and_only_blocks_malware_findings(monkeypatch: pytest.MonkeyPatch) -> None:
    from core.file_scan.scanners import scanii as module

    http = _use_http(
        monkeypatch,
        module,
        httpx.Response(201, json={"id": "r1", "findings": []}),
        httpx.Response(201, json={"id": "r2", "findings": ["av.win.trojan.agent-1", "content.image.nsfw.nudity"]}),
        httpx.Response(201, json={"id": "r3", "findings": ["content.en.language.nsfw"]}),
        httpx.Response(429),
        httpx.Response(201, json={"id": "r4"}),
    )
    scanner = ScaniiScanner({"api_key": "key", "api_secret": "secret"}, {"region": "eu1"})

    clean = scanner.scan(_target())
    assert (clean.status, clean.external_id) == (ScanStatus.CLEAN, "r1")
    assert http.calls[0][1] == "https://api-eu1.scanii.com/v2.2/files"
    assert http.calls[0][2]["auth"] == ("key", "secret")

    infected = scanner.scan(_target())
    assert infected.status is ScanStatus.INFECTED
    assert infected.threats == ("av.win.trojan.agent-1",)
    assert scanner.scan(_target()).status is ScanStatus.CLEAN
    assert scanner.scan(_target()).problem is ScanProblem.QUOTA
    assert scanner.scan(_target()).problem is ScanProblem.INVALID_RESPONSE


def test_scanii_settings_validation() -> None:
    with pytest.raises(ScannerConfigError):
        ScaniiScanner.validate_settings({"api_key": "k"}, {"region": "us1"})
    with pytest.raises(ScannerConfigError):
        ScaniiScanner.validate_settings({"api_key": "k", "api_secret": "s"}, {"region": "mars"})
    ScaniiScanner.validate_settings({"api_key": "k", "api_secret": "s"}, {"region": "us1"})


# --- MetaDefender


def _metadefender(
    monkeypatch: pytest.MonkeyPatch, *responses: httpx.Response, wait: float = 50.0
) -> tuple[MetaDefenderScanner, _Http]:
    from core.file_scan.scanners import metadefender as module

    http = _use_http(monkeypatch, module, *responses)
    now = [0.0]

    def sleep(seconds: float) -> None:
        now[0] += seconds

    scanner = MetaDefenderScanner(
        {"api_key": "secret"}, {"private_processing": True}, wait_seconds=wait, sleep=sleep, clock=lambda: now[0]
    )
    return scanner, http


def _result(code: int, **extra: object) -> httpx.Response:
    return httpx.Response(200, json={"scan_results": {"scan_all_result_i": code, **extra}})


def test_metadefender_uploads_then_polls_until_the_verdict(monkeypatch: pytest.MonkeyPatch) -> None:
    scanner, http = _metadefender(
        monkeypatch,
        httpx.Response(200, json={"data_id": "d1"}),
        _result(255),
        _result(254),
        _result(
            1, scan_details={"A": {"threat_found": "EICAR"}, "B": {"threat_found": ""}, "C": {"threat_found": "EICAR"}}
        ),
    )

    verdict = scanner.scan(_target(name="报告.docx"))

    assert verdict.status is ScanStatus.INFECTED
    assert verdict.threats == ("EICAR",)
    assert verdict.external_id == "d1"
    upload = http.calls[0]
    assert upload[:2] == ("POST", "https://api.metadefender.com/v4/file")
    headers = upload[2]["headers"]
    assert isinstance(headers, dict)
    assert headers["apikey"] == "secret"
    assert headers["privateprocessing"] == "1"
    assert headers["filename"].isascii()
    assert [call[1] for call in http.calls[1:]] == ["https://api.metadefender.com/v4/file/d1"] * 3


def test_metadefender_reports_pending_with_the_data_id_and_resumes_without_uploading(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    scanner, http = _metadefender(
        monkeypatch, httpx.Response(200, json={"data_id": "d1"}), _result(255), _result(255), wait=3.0
    )

    pending = scanner.scan(_target())

    assert (pending.status, pending.problem, pending.external_id) == (
        ScanStatus.UNAVAILABLE,
        ScanProblem.PENDING,
        "d1",
    )
    assert pending.retryable

    scanner, http = _metadefender(monkeypatch, _result(0))
    resumed = scanner.scan(_target(), external_id="d1")
    assert resumed.status is ScanStatus.CLEAN
    assert [call[0] for call in http.calls] == ["GET"]


@pytest.mark.parametrize(
    ("code", "status", "problem"),
    [
        (0, ScanStatus.CLEAN, None),
        (7, ScanStatus.CLEAN, None),
        (2, ScanStatus.INFECTED, None),
        (12, ScanStatus.UNSCANNABLE, ScanProblem.ENCRYPTED),
        (15, ScanStatus.UNSCANNABLE, ScanProblem.ENCRYPTED),
        (23, ScanStatus.UNSCANNABLE, ScanProblem.UNSUPPORTED),
        (253, ScanStatus.UNAVAILABLE, ScanProblem.QUOTA),
        (3, ScanStatus.UNAVAILABLE, ScanProblem.SERVER_ERROR),
    ],
)
def test_metadefender_result_codes(
    monkeypatch: pytest.MonkeyPatch, code: int, status: ScanStatus, problem: ScanProblem | None
) -> None:
    scanner, _ = _metadefender(monkeypatch, _result(code, scan_all_result_a="description"))

    verdict = scanner.scan(_target(), external_id="d1")

    assert (verdict.status, verdict.problem) == (status, problem)


def test_metadefender_upload_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    scanner, _ = _metadefender(
        monkeypatch,
        httpx.Response(400, json={"error": {"code": 400144}}),
        httpx.Response(400, json={"error": {"code": 400143}}),
        httpx.Response(401, json={"error": {"code": 401006}}),
        httpx.Response(429),
    )

    assert scanner.scan(_target()).problem is ScanProblem.TOO_LARGE
    assert scanner.scan(_target()).problem is ScanProblem.AUTH
    assert scanner.scan(_target()).problem is ScanProblem.AUTH
    assert scanner.scan(_target()).problem is ScanProblem.QUOTA


def test_metadefender_check_only_looks_up_the_key(monkeypatch: pytest.MonkeyPatch) -> None:
    scanner, http = _metadefender(monkeypatch, httpx.Response(200, json={}), httpx.Response(401))

    scanner.check()
    assert http.calls[0][:2] == ("GET", "https://api.metadefender.com/v4/apikey/")
    with pytest.raises(ScannerError) as error:
        scanner.check()
    assert error.value.problem is ScanProblem.AUTH


# --- ClamAV


class _FakeClamd:
    """A clamd that understands PING and INSTREAM and flags the EICAR test file."""

    def __init__(self, *, max_stream: int = 1024 * 1024) -> None:
        self._max_stream = max_stream
        self._server = socket.create_server(("127.0.0.1", 0))
        self.port = self._server.getsockname()[1]
        self._thread = threading.Thread(target=self._serve, daemon=True)
        self._thread.start()

    def close(self) -> None:
        self._server.close()

    def _serve(self) -> None:
        while True:
            try:
                connection, _ = self._server.accept()
            except OSError:
                return
            with connection:
                reader = connection.makefile("rb")
                command = b""
                while not command.endswith(b"\0"):
                    command += reader.read(1)
                if command == b"zPING\0":
                    connection.sendall(b"PONG\0")
                    continue
                body = b""
                too_large = False
                while True:
                    size = int.from_bytes(reader.read(4), "big")
                    if size == 0:
                        break
                    body += reader.read(size)
                    if len(body) > self._max_stream:
                        too_large = True
                if too_large:
                    connection.sendall(b"INSTREAM size limit exceeded. ERROR\0")
                elif body == eicar_test_content():
                    connection.sendall(b"stream: Eicar-Signature FOUND\0")
                else:
                    connection.sendall(b"stream: OK\0")


@pytest.fixture
def clamd() -> Iterator[_FakeClamd]:
    server = _FakeClamd(max_stream=200_000)
    yield server
    server.close()


def test_clamav_instream_verdicts_and_connectivity_check(clamd: _FakeClamd) -> None:
    scanner = ClamAVScanner({}, {"host": "127.0.0.1", "port": clamd.port, "timeout": 5})

    assert scanner.scan(_target(b"plain text")).status is ScanStatus.CLEAN
    infected = scanner.scan(_target(eicar_test_content()))
    assert (infected.status, infected.threats) == (ScanStatus.INFECTED, ("Eicar-Signature",))
    large = scanner.scan(_target(b"x" * 300_000))
    assert (large.status, large.problem) == (ScanStatus.UNSCANNABLE, ScanProblem.TOO_LARGE)
    scanner.check()


def test_clamav_unreachable_is_a_network_problem() -> None:
    with socket.create_server(("127.0.0.1", 0)) as server:
        port = server.getsockname()[1]
    verdict = ClamAVScanner({}, {"host": "127.0.0.1", "port": port, "timeout": 2}).scan(_target())

    assert (verdict.status, verdict.problem) == (ScanStatus.UNAVAILABLE, ScanProblem.NETWORK)
    with pytest.raises(ScannerConfigError):
        ClamAVScanner.validate_settings({}, {"host": ""})


# --- Custom endpoint


def _custom(
    monkeypatch: pytest.MonkeyPatch, *responses: httpx.Response | Exception
) -> tuple[CustomEndpointScanner, _Http]:
    http = _use_http(monkeypatch, api_module, *responses)
    scanner = CustomEndpointScanner({"api_key": "key"}, {"endpoint": "https://scanner.example/scan", "timeout": 30})
    return scanner, http


def test_custom_endpoint_receives_the_file_content_and_metadata(monkeypatch: pytest.MonkeyPatch) -> None:
    scanner, http = _custom(
        monkeypatch, httpx.Response(200, json={"verdict": "infected", "threats": ["Evil.A"], "engine": "Mine 1.0"})
    )

    verdict = scanner.scan(_target(b"hello"))

    assert (verdict.status, verdict.threats, verdict.engine) == (ScanStatus.INFECTED, ("Evil.A",), "Mine 1.0")
    method, url, kwargs = http.calls[0]
    assert (method, url) == ("POST", "https://scanner.example/scan")
    assert kwargs["headers"] == {"Authorization": "Bearer key"}
    assert kwargs["timeout"] == 30.0
    assert kwargs["data"] == {
        "scan_id": "scan-1",
        "file_name": "report.docx",
        "file_size": "5",
        "mime_type": "application/octet-stream",
        "file_hash": "hash",
    }
    assert kwargs["files"] == {"file": ("report.docx", b"hello", "application/octet-stream")}


@pytest.mark.parametrize(
    ("response", "status", "problem"),
    [
        (httpx.Response(200, json={"verdict": "clean"}), ScanStatus.CLEAN, None),
        (httpx.Response(200, json={"verdict": "infected"}), ScanStatus.INFECTED, None),
        (
            httpx.Response(200, json={"verdict": "unscannable", "message": "zip bomb"}),
            ScanStatus.UNSCANNABLE,
            ScanProblem.UNSUPPORTED,
        ),
        (httpx.Response(200, json={"verdict": "maybe"}), ScanStatus.UNAVAILABLE, ScanProblem.INVALID_RESPONSE),
        (httpx.Response(200, json=["clean"]), ScanStatus.UNAVAILABLE, ScanProblem.INVALID_RESPONSE),
        (httpx.Response(200, text="ok"), ScanStatus.UNAVAILABLE, ScanProblem.INVALID_RESPONSE),
        (httpx.Response(401), ScanStatus.UNAVAILABLE, ScanProblem.AUTH),
        (httpx.Response(429), ScanStatus.UNAVAILABLE, ScanProblem.QUOTA),
        (httpx.Response(413), ScanStatus.UNSCANNABLE, ScanProblem.TOO_LARGE),
        (httpx.Response(502), ScanStatus.UNAVAILABLE, ScanProblem.SERVER_ERROR),
        (ScannerError(ScanProblem.TIMEOUT, "request timed out"), ScanStatus.UNAVAILABLE, ScanProblem.TIMEOUT),
    ],
)
def test_custom_endpoint_verdicts_and_failures(
    monkeypatch: pytest.MonkeyPatch,
    response: httpx.Response | Exception,
    status: ScanStatus,
    problem: ScanProblem | None,
) -> None:
    scanner, _ = _custom(monkeypatch, response)

    verdict = scanner.scan(_target())

    assert (verdict.status, verdict.problem) == (status, problem)
    if status is ScanStatus.INFECTED:
        assert verdict.threats == ("unknown",)


def test_custom_endpoint_check_needs_a_well_formed_answer_but_not_a_particular_verdict(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    scanner, http = _custom(
        monkeypatch,
        httpx.Response(200, json={"verdict": "clean"}),
        httpx.Response(200, json={"verdict": "unscannable"}),
        httpx.Response(401),
        httpx.Response(200, json={"result": "pong"}),
    )

    scanner.check()
    scanner.check()
    with pytest.raises(ScannerError) as error:
        scanner.check()
    assert error.value.problem is ScanProblem.AUTH
    with pytest.raises(ScannerError) as error:
        scanner.check()
    assert error.value.problem is ScanProblem.INVALID_RESPONSE
    assert all(call[2]["data"]["scan_id"] == "connectivity-check" for call in http.calls)  # type: ignore[index]


@pytest.mark.parametrize(
    ("credentials", "config"),
    [
        ({"api_key": "k"}, {}),
        ({"api_key": "k"}, {"endpoint": "scanner.example/scan"}),
        ({"api_key": "k"}, {"endpoint": "ftp://scanner.example/scan"}),
        ({"api_key": "k"}, {"endpoint": "https://user:pass@scanner.example/scan"}),
        ({"api_key": "k"}, {"endpoint": "https://scanner.example/" + "a" * 600}),
        ({}, {"endpoint": "https://scanner.example/scan"}),
    ],
)
def test_custom_endpoint_settings_validation(credentials: dict[str, str], config: dict[str, str]) -> None:
    with pytest.raises(ScannerConfigError):
        CustomEndpointScanner.validate_settings(credentials, config)


def test_custom_endpoint_accepts_http_and_https_addresses() -> None:
    CustomEndpointScanner.validate_settings({"api_key": "k"}, {"endpoint": "https://scanner.example/scan"})
    CustomEndpointScanner.validate_settings({"api_key": "k"}, {"endpoint": "http://scanner.internal:8080/scan"})
