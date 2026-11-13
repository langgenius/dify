from collections.abc import Mapping
from typing import Any, ClassVar, override
from urllib.parse import urlsplit

from core.file_scan.base import (
    CLEAN_TEST_CONTENT,
    CLEAN_TEST_FILE_NAME,
    FileScanner,
    ScannerConfigError,
    ScannerError,
    http_request,
    json_object,
    raise_for_provider_status,
)
from core.file_scan.entities import ScanProblem, ScanProviderType, ScanStatus, ScanTarget, ScanVerdict

MAX_ENDPOINT_LENGTH = 512


class CustomEndpointScanner(FileScanner):
    """A workspace's own scanning service.

    The endpoint receives one ``multipart/form-data`` POST per file, authenticated with
    ``Authorization: Bearer <api key>``:

    - ``file``: the file content, with its name and media type;
    - ``scan_id``, ``file_name``, ``file_size``, ``mime_type``, ``file_hash``: text fields.

    It answers within ``FILE_SCAN_REQUEST_TIMEOUT_SECONDS`` with HTTP 200 and JSON
    ``{"verdict": "clean" | "infected" | "unscannable"}``, optionally with ``threats`` (list of
    names), ``engine`` and ``message``. 401/403 mean the key is wrong, 402/429 that quota is
    exhausted, 413 that the file is too large, and 5xx that the service is temporarily unavailable.
    """

    provider_type: ClassVar[ScanProviderType] = ScanProviderType.API
    credential_fields: ClassVar[tuple[str, ...]] = ("api_key",)
    destination_fields: ClassVar[tuple[str, ...]] = ("endpoint",)

    @classmethod
    @override
    def validate_settings(cls, credentials: Mapping[str, str], config: Mapping[str, Any]) -> None:
        endpoint = config.get("endpoint")
        if not isinstance(endpoint, str) or not endpoint or len(endpoint) > MAX_ENDPOINT_LENGTH:
            raise ScannerConfigError("endpoint is required")
        parts = urlsplit(endpoint)
        if parts.scheme not in ("http", "https") or not parts.netloc:
            raise ScannerConfigError("endpoint must be an http or https URL")
        if parts.username or parts.password:
            raise ScannerConfigError("endpoint must not contain credentials; use the API key")
        if not credentials.get("api_key"):
            raise ScannerConfigError("api_key is required")

    @override
    def _scan(self, target: ScanTarget, *, external_id: str | None) -> ScanVerdict:
        response = http_request(
            "POST",
            str(self.config["endpoint"]),
            timeout=self.request_timeout,
            headers={"Authorization": f"Bearer {self.credentials['api_key']}"},
            data={
                "scan_id": target.scan_id,
                "file_name": target.file_name,
                "file_size": str(target.size),
                "mime_type": target.mime_type,
                "file_hash": target.file_hash,
            },
            files={"file": (target.file_name, target.load(), target.mime_type or "application/octet-stream")},
        )
        if response.status_code == 413:
            return ScanVerdict.unscannable(ScanProblem.TOO_LARGE)
        raise_for_provider_status(response)
        body = json_object(response)

        verdict = body.get("verdict")
        engine = str(body["engine"]) if body.get("engine") else None
        message = str(body["message"]) if body.get("message") else None
        if verdict == "clean":
            return ScanVerdict.clean(engine=engine)
        if verdict == "infected":
            threats = body.get("threats")
            names = [str(threat) for threat in threats] if isinstance(threats, list) else []
            return ScanVerdict.infected(names or ["unknown"], engine=engine)
        if verdict == "unscannable":
            return ScanVerdict.unscannable(ScanProblem.UNSUPPORTED, message=message)
        raise ScannerError(ScanProblem.INVALID_RESPONSE, "verdict must be clean, infected or unscannable")

    @override
    def check(self) -> None:
        """Send one harmless file and require a well-formed answer.

        Unlike the built-in vendors, a custom service is not required to recognise the EICAR test
        file: it may implement any policy. The check proves the address, the key and the protocol.
        """
        verdict = self.scan(
            ScanTarget(
                scan_id="connectivity-check",
                file_name=CLEAN_TEST_FILE_NAME,
                size=len(CLEAN_TEST_CONTENT),
                mime_type="text/plain",
                file_hash="",
                load=lambda: CLEAN_TEST_CONTENT,
            )
        )
        if verdict.status is ScanStatus.UNAVAILABLE:
            raise ScannerError(verdict.problem or ScanProblem.INVALID_RESPONSE, verdict.message or "")
