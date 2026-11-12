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

DEFAULT_ENDPOINT = "https://api.cloudmersive.com"

# The advanced endpoint rejects executables, scripts, macros and more by default. This module
# only answers "is it malware", so everything except the password check is allowed explicitly;
# password-protected files stay rejected because the scanner cannot look inside them.
_ALLOW_HEADERS = (
    "allowExecutables",
    "allowInvalidFiles",
    "allowScripts",
    "allowMacros",
    "allowXmlExternalEntities",
    "allowInsecureDeserialization",
    "allowHtml",
    "allowUnsafeArchives",
    "allowOleEmbeddedObject",
    "allowUnwantedAction",
)


class CloudmersiveScanner(FileScanner):
    """Cloudmersive Virus Scan API (``POST /virus/scan/file/advanced``, synchronous)."""

    provider_type: ClassVar[ScanProviderType] = ScanProviderType.CLOUDMERSIVE
    credential_fields: ClassVar[tuple[str, ...]] = ("api_key",)
    destination_fields: ClassVar[tuple[str, ...]] = ("endpoint",)

    @classmethod
    @override
    def validate_settings(cls, credentials: Mapping[str, str], config: Mapping[str, Any]) -> None:
        if not credentials.get("api_key"):
            raise ScannerConfigError("api_key is required")
        endpoint = config.get("endpoint")
        if endpoint and not str(endpoint).startswith("https://"):
            raise ScannerConfigError("endpoint must be an https URL")

    @override
    def _scan(self, target: ScanTarget, *, external_id: str | None) -> ScanVerdict:
        endpoint = str(self.config.get("endpoint") or DEFAULT_ENDPOINT).rstrip("/")
        headers = {"Apikey": self.credentials["api_key"]}
        headers.update(dict.fromkeys(_ALLOW_HEADERS, "true"))
        response = http_request(
            "POST",
            f"{endpoint}/virus/scan/file/advanced",
            timeout=self.request_timeout,
            headers=headers,
            files={"inputFile": (target.file_name, target.load(), target.mime_type or "application/octet-stream")},
        )
        if response.status_code == 413:
            return ScanVerdict.unscannable(ScanProblem.TOO_LARGE)
        raise_for_provider_status(response)
        body = json_object(response)

        viruses = body.get("FoundViruses") or []
        if not isinstance(viruses, list):
            raise ScannerError(ScanProblem.INVALID_RESPONSE, "FoundViruses is not a list")
        threats = [str(virus.get("VirusName") or "unknown") for virus in viruses if isinstance(virus, dict)]
        if threats:
            return ScanVerdict.infected(threats, engine="Cloudmersive")
        if body.get("CleanResult") is True:
            return ScanVerdict.clean(engine="Cloudmersive")
        if body.get("ContainsPasswordProtectedFile") is True:
            return ScanVerdict.unscannable(ScanProblem.ENCRYPTED)
        if "CleanResult" not in body:
            raise ScannerError(ScanProblem.INVALID_RESPONSE, "CleanResult is missing")
        flags = sorted(key for key, value in body.items() if key.startswith("Contains") and value is True)
        return ScanVerdict.unscannable(ScanProblem.UNSUPPORTED, message=", ".join(flags) or None)
