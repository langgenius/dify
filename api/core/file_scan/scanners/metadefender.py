import time
from collections.abc import Callable, Mapping
from typing import Any, ClassVar, override
from urllib.parse import quote

import httpx

from core.file_scan.base import (
    FileScanner,
    ScannerConfigError,
    ScannerError,
    http_request,
    json_object,
    raise_for_provider_status,
)
from core.file_scan.entities import ScanProblem, ScanProviderType, ScanTarget, ScanVerdict

BASE_URL = "https://api.metadefender.com/v4"
POLL_INTERVAL_SECONDS = 2.0
DEFAULT_WAIT_SECONDS = 50.0
POLL_REQUEST_TIMEOUT_SECONDS = 30.0

# ``scan_results.scan_all_result_i`` codes, from OPSWAT's "Description on scan result codes".
_CLEAN = frozenset({0, 7})
_INFECTED = frozenset({1, 2, 8, 26, 27, 28})
_ENCRYPTED = frozenset({12, 15})
_UNSUPPORTED = frozenset({9, 13, 14, 16, 23})
_IN_PROGRESS = frozenset({254, 255})

_FILE_TOO_LARGE_CODE = 400144
_PRIVATE_SCAN_NOT_ENABLED_CODE = 400143


class MetaDefenderScanner(FileScanner):
    """OPSWAT MetaDefender Cloud v4: upload with ``POST /file``, then poll ``GET /file/{data_id}``."""

    provider_type: ClassVar[ScanProviderType] = ScanProviderType.METADEFENDER
    credential_fields: ClassVar[tuple[str, ...]] = ("api_key",)

    def __init__(
        self,
        credentials: Mapping[str, str],
        config: Mapping[str, Any],
        *,
        wait_seconds: float = DEFAULT_WAIT_SECONDS,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        super().__init__(credentials, config)
        self._wait_seconds = wait_seconds
        self._sleep = sleep
        self._clock = clock

    @classmethod
    @override
    def validate_settings(cls, credentials: Mapping[str, str], config: Mapping[str, Any]) -> None:
        if not credentials.get("api_key"):
            raise ScannerConfigError("api_key is required")
        if not isinstance(config.get("private_processing", False), bool):
            raise ScannerConfigError("private_processing must be a boolean")

    def _headers(self) -> dict[str, str]:
        return {"apikey": self.credentials["api_key"]}

    @override
    def _scan(self, target: ScanTarget, *, external_id: str | None) -> ScanVerdict:
        data_id = external_id or self._upload(target)
        if isinstance(data_id, ScanVerdict):
            return data_id
        deadline = self._clock() + self._wait_seconds
        while True:
            verdict = self._result(data_id)
            if verdict is not None:
                return verdict
            if self._clock() + POLL_INTERVAL_SECONDS > deadline:
                raise ScannerError(ScanProblem.PENDING, "scan is still running", external_id=data_id)
            self._sleep(POLL_INTERVAL_SECONDS)

    def _upload(self, target: ScanTarget) -> str | ScanVerdict:
        headers = self._headers()
        headers["Content-Type"] = "application/octet-stream"
        headers["filename"] = quote(target.file_name)
        if self.config.get("private_processing"):
            headers["privateprocessing"] = "1"
        response = http_request(
            "POST", f"{BASE_URL}/file", timeout=self.request_timeout, headers=headers, content=target.load()
        )
        if response.status_code == 400:
            code = _error_code(response)
            if code == _FILE_TOO_LARGE_CODE:
                return ScanVerdict.unscannable(ScanProblem.TOO_LARGE)
            if code == _PRIVATE_SCAN_NOT_ENABLED_CODE:
                raise ScannerError(ScanProblem.AUTH, "private scanning is not enabled for this API key")
        raise_for_provider_status(response)
        data_id = json_object(response).get("data_id")
        if not isinstance(data_id, str) or not data_id:
            raise ScannerError(ScanProblem.INVALID_RESPONSE, "data_id is missing")
        return data_id

    def _result(self, data_id: str) -> ScanVerdict | None:
        """Return the verdict, or ``None`` while MetaDefender is still scanning."""
        response = http_request(
            "GET",
            f"{BASE_URL}/file/{quote(data_id, safe='')}",
            timeout=POLL_REQUEST_TIMEOUT_SECONDS,
            headers=self._headers(),
        )
        try:
            raise_for_provider_status(response)
        except ScannerError as error:
            raise ScannerError(error.problem, str(error), external_id=data_id) from error
        body = json_object(response)
        results = body.get("scan_results")
        if not isinstance(results, dict):
            return None
        code = results.get("scan_all_result_i")
        if not isinstance(code, int) or code in _IN_PROGRESS:
            return None
        description = str(results.get("scan_all_result_a") or code)
        engine = "MetaDefender Cloud"
        if code in _CLEAN:
            return ScanVerdict.clean(engine=engine, external_id=data_id)
        if code in _INFECTED:
            return ScanVerdict.infected(_threats(results) or [description], engine=engine, external_id=data_id)
        if code in _ENCRYPTED:
            return ScanVerdict.unscannable(ScanProblem.ENCRYPTED, message=description, external_id=data_id)
        if code in _UNSUPPORTED:
            return ScanVerdict.unscannable(ScanProblem.UNSUPPORTED, message=description, external_id=data_id)
        if code == 253:
            raise ScannerError(ScanProblem.QUOTA, description)
        # Failed, aborted, canceled, not scanned: submit the file again on the next attempt.
        raise ScannerError(ScanProblem.SERVER_ERROR, description)

    @override
    def check(self) -> None:
        # Uploading test files would spend the workspace's daily scan quota; the key lookup does not.
        raise_for_provider_status(http_request("GET", f"{BASE_URL}/apikey/", headers=self._headers(), timeout=20.0))


def _error_code(response: httpx.Response) -> int | None:
    try:
        body = response.json()
    except ValueError:
        return None
    error = body.get("error") if isinstance(body, dict) else None
    code = error.get("code") if isinstance(error, dict) else None
    return code if isinstance(code, int) else None


def _threats(results: Mapping[str, Any]) -> list[str]:
    details = results.get("scan_details")
    if not isinstance(details, dict):
        return []
    threats: list[str] = []
    for detail in details.values():
        name = detail.get("threat_found") if isinstance(detail, dict) else None
        if name and str(name) not in threats:
            threats.append(str(name))
    return threats
