from collections.abc import Mapping
from typing import Any, ClassVar, override

from core.file_scan.base import (
    FileScanner,
    ScannerConfigError,
    ScannerError,
    http_request,
    json_object,
    raise_for_provider_status,
)
from core.file_scan.entities import ScanProblem, ScanProviderType, ScanTarget, ScanVerdict

SCANII_REGIONS = ("us1", "eu1", "eu2", "ap1", "ap2", "ca1")

# Scanii reports every enabled detection engine through ``findings``. Only malware findings block
# a file here; an account that also enabled image or language detection must not have documents
# rejected for those.
_MALWARE_PREFIXES = ("av.", "content.malicious.")


class ScaniiScanner(FileScanner):
    """Scanii v2.2 (``POST /v2.2/files``, synchronous, HTTP Basic with key and secret)."""

    provider_type: ClassVar[ScanProviderType] = ScanProviderType.SCANII
    credential_fields: ClassVar[tuple[str, ...]] = ("api_key", "api_secret")

    @classmethod
    @override
    def validate_settings(cls, credentials: Mapping[str, str], config: Mapping[str, Any]) -> None:
        if not credentials.get("api_key") or not credentials.get("api_secret"):
            raise ScannerConfigError("api_key and api_secret are required")
        if config.get("region") not in SCANII_REGIONS:
            raise ScannerConfigError(f"region must be one of {', '.join(SCANII_REGIONS)}")

    def _base_url(self) -> str:
        return f"https://api-{self.config['region']}.scanii.com/v2.2"

    def _auth(self) -> tuple[str, str]:
        return (self.credentials["api_key"], self.credentials["api_secret"])

    @override
    def _scan(self, target: ScanTarget, *, external_id: str | None) -> ScanVerdict:
        response = http_request(
            "POST",
            f"{self._base_url()}/files",
            timeout=self.request_timeout,
            auth=self._auth(),
            files={"file": (target.file_name, target.load(), target.mime_type or "application/octet-stream")},
        )
        if response.status_code == 413:
            return ScanVerdict.unscannable(ScanProblem.TOO_LARGE)
        raise_for_provider_status(response)
        body = json_object(response)
        findings = body.get("findings")
        if not isinstance(findings, list):
            raise ScannerError(ScanProblem.INVALID_RESPONSE, "findings is missing")
        resource_id = str(body["id"]) if body.get("id") else None
        threats = [str(finding) for finding in findings if str(finding).startswith(_MALWARE_PREFIXES)]
        if threats:
            return ScanVerdict.infected(threats, engine="Scanii", external_id=resource_id)
        return ScanVerdict.clean(engine="Scanii", external_id=resource_id)
