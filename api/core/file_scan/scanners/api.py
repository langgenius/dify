from collections.abc import Mapping
from typing import Any, ClassVar, override

from core.extension.api_based_extension_requestor import APIBasedExtensionRequestor
from core.file_scan.base import FileScanner, ScannerConfigError, ScannerError
from core.file_scan.entities import ScanProblem, ScanProviderType, ScanTarget, ScanVerdict
from models.api_based_extension import APIBasedExtensionPoint


class ApiExtensionScanner(FileScanner):
    """A workspace's own scanner, reached through an API-based extension ("Custom Endpoint").

    The endpoint receives the ``file.malware_scan`` point with file metadata and a short-lived
    signed download URL, and answers ``{"verdict": "clean" | "infected" | "unscannable", ...}``.
    """

    provider_type: ClassVar[ScanProviderType] = ScanProviderType.API
    credential_fields: ClassVar[tuple[str, ...]] = ()

    @classmethod
    @override
    def validate_settings(cls, credentials: Mapping[str, str], config: Mapping[str, Any]) -> None:
        if not config.get("api_based_extension_id"):
            raise ScannerConfigError("api_based_extension_id is required")

    @override
    def _scan(self, target: ScanTarget, *, external_id: str | None) -> ScanVerdict:
        endpoint = self.credentials.get("api_endpoint")
        if not endpoint:
            raise ScannerError(ScanProblem.AUTH, "the selected API extension no longer exists")
        if target.download_url is None:
            raise ScannerError(ScanProblem.INVALID_RESPONSE, "this file cannot be offered for download")
        params = {
            "scan_id": target.scan_id,
            "file": {
                "name": target.file_name,
                "size": target.size,
                "mime_type": target.mime_type,
                "hash": target.file_hash,
                "download_url": target.download_url(),
            },
        }
        try:
            body = APIBasedExtensionRequestor(endpoint, self.credentials.get("api_key", "")).request(
                APIBasedExtensionPoint.FILE_MALWARE_SCAN, params
            )
        except ValueError as error:
            raise ScannerError(_problem_from_requestor_error(str(error)), str(error)[:200]) from error

        if not isinstance(body, dict):
            raise ScannerError(ScanProblem.INVALID_RESPONSE, "response is not a JSON object")
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
        # The API extension was already verified with ``ping`` when it was saved.
        if not self.credentials.get("api_endpoint"):
            raise ScannerError(ScanProblem.AUTH, "the selected API extension no longer exists")


def _problem_from_requestor_error(message: str) -> ScanProblem:
    """``APIBasedExtensionRequestor`` reports every failure as ``ValueError`` text."""
    if "timeout" in message:
        return ScanProblem.TIMEOUT
    if "connection error" in message:
        return ScanProblem.NETWORK
    if "status_code: 401" in message or "status_code: 403" in message:
        return ScanProblem.AUTH
    if "status_code: 429" in message or "status_code: 402" in message:
        return ScanProblem.QUOTA
    if "status_code: 5" in message:
        return ScanProblem.SERVER_ERROR
    return ScanProblem.INVALID_RESPONSE
