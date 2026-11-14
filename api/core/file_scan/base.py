import logging
from abc import ABC, abstractmethod
from collections.abc import Mapping
from typing import Any, ClassVar

import httpx

from core.file_scan.entities import ScanProblem, ScanProviderType, ScanStatus, ScanTarget, ScanVerdict
from core.helper import ssrf_proxy

logger = logging.getLogger(__name__)

EICAR_TEST_FILE_NAME = "eicar-test.txt"
CLEAN_TEST_FILE_NAME = "clean-test.txt"
CLEAN_TEST_CONTENT = b"Dify file scan connectivity check.\n"
DEFAULT_REQUEST_TIMEOUT_SECONDS = 300.0


def eicar_test_content() -> bytes:
    """The standard harmless antivirus test string.

    It is assembled at runtime so that this source file does not itself trip antivirus tools.
    """
    return ("X5O!P%@AP[4\\PZX54(P^)7CC)7}" + "$EICAR-STANDARD-ANTIVIRUS-" + "TEST-FILE!$H+H*").encode("ascii")


class ScannerError(Exception):
    """A scanner could not produce a verdict. Converted into an ``unavailable`` verdict by ``FileScanner.scan``."""

    def __init__(self, problem: ScanProblem, message: str = "", *, external_id: str | None = None) -> None:
        super().__init__(message or problem.value)
        self.problem = problem
        self.external_id = external_id


class ScannerConfigError(ValueError):
    """The provider settings entered in the console are invalid."""


class FileScanner(ABC):
    """One malware-scanning backend.

    Implementations only translate between a ``ScanTarget`` and their wire format. They never
    touch the database and never raise from ``scan``: every failure becomes a verdict, so that a
    scanner problem can stop one file without breaking the caller's batch.
    """

    provider_type: ClassVar[ScanProviderType]
    credential_fields: ClassVar[tuple[str, ...]] = ()
    """Names of secret settings. They are stored encrypted and never returned to the console."""
    destination_fields: ClassVar[tuple[str, ...]] = ()
    """Names of settings that decide where the credentials are sent.

    Changing one of them requires entering the credentials again; otherwise an administrator who
    cannot read a stored key could point the scanner at their own server and collect it.
    """

    def __init__(self, credentials: Mapping[str, str], config: Mapping[str, Any]) -> None:
        self.credentials = credentials
        self.config = config

    @property
    def request_timeout(self) -> float:
        """Seconds one request to the scanner may take (``FILE_SCAN_REQUEST_TIMEOUT_SECONDS``)."""
        return float(self.config.get("timeout") or DEFAULT_REQUEST_TIMEOUT_SECONDS)

    @classmethod
    @abstractmethod
    def validate_settings(cls, credentials: Mapping[str, str], config: Mapping[str, Any]) -> None:
        """Raise ``ScannerConfigError`` when required settings are missing or malformed."""

    @abstractmethod
    def _scan(self, target: ScanTarget, *, external_id: str | None) -> ScanVerdict:
        """Scan one file. May raise ``ScannerError``."""

    def scan(self, target: ScanTarget, *, external_id: str | None = None) -> ScanVerdict:
        """Scan one file and always return a verdict.

        ``external_id`` resumes a scan a previous attempt already submitted (asynchronous scanners).
        """
        try:
            return self._scan(target, external_id=external_id)
        except ScannerError as error:
            return ScanVerdict.unavailable(error.problem, message=str(error), external_id=error.external_id)
        except Exception as error:
            logger.exception("File scanner %s failed unexpectedly", self.provider_type)
            return ScanVerdict.unavailable(ScanProblem.INVALID_RESPONSE, message=type(error).__name__)

    def check(self) -> None:
        """Verify the provider works. Raises ``ScannerError`` with a readable message otherwise.

        The default sends the EICAR test file and a clean file and expects the matching verdicts.
        """
        samples = (
            (EICAR_TEST_FILE_NAME, eicar_test_content(), ScanStatus.INFECTED),
            (CLEAN_TEST_FILE_NAME, CLEAN_TEST_CONTENT, ScanStatus.CLEAN),
        )
        for name, content, expected in samples:
            verdict = self.scan(
                ScanTarget(
                    scan_id="connectivity-check",
                    file_name=name,
                    size=len(content),
                    mime_type="text/plain",
                    file_hash="",
                    load=lambda content=content: content,
                )
            )
            if verdict.status is ScanStatus.UNAVAILABLE:
                raise ScannerError(verdict.problem or ScanProblem.INVALID_RESPONSE, verdict.message or "")
            if verdict.status is not expected:
                raise ScannerError(
                    ScanProblem.INVALID_RESPONSE,
                    f"expected {expected.value} for {name}, got {verdict.status.value}",
                )


def http_request(method: str, url: str, *, timeout: float, **kwargs: Any) -> httpx.Response:
    """Send one request through the SSRF proxy and map transport failures to ``ScannerError``."""
    try:
        return ssrf_proxy.make_request(
            method,
            url,
            max_retries=0,
            timeout=httpx.Timeout(timeout, connect=10.0),
            follow_redirects=False,
            **kwargs,
        )
    except httpx.TimeoutException as error:
        raise ScannerError(ScanProblem.TIMEOUT, "request timed out") from error
    except httpx.RequestError as error:
        raise ScannerError(ScanProblem.NETWORK, type(error).__name__) from error
    except Exception as error:
        # ssrf_proxy raises ToolSSRFError (blocked destination) and ValueError (bad options).
        raise ScannerError(ScanProblem.NETWORK, str(error)[:200]) from error


def raise_for_provider_status(response: httpx.Response) -> None:
    """Map the HTTP statuses scanning vendors share to a ``ScannerError``; 2xx passes."""
    status = response.status_code
    if 200 <= status < 300:
        return
    detail = f"HTTP {status}"
    if status in (401, 403):
        raise ScannerError(ScanProblem.AUTH, detail)
    if status in (402, 429):
        raise ScannerError(ScanProblem.QUOTA, detail)
    if status >= 500:
        raise ScannerError(ScanProblem.SERVER_ERROR, detail)
    raise ScannerError(ScanProblem.INVALID_RESPONSE, detail)


def json_object(response: httpx.Response) -> dict[str, Any]:
    try:
        body = response.json()
    except ValueError as error:
        raise ScannerError(ScanProblem.INVALID_RESPONSE, "response is not JSON") from error
    if not isinstance(body, dict):
        raise ScannerError(ScanProblem.INVALID_RESPONSE, "response is not a JSON object")
    return body
