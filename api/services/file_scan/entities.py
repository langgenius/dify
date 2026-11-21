from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from models.file_scan import FileScanFallbackAction

SCOPE_DATASET = "dataset"
SCOPE_KNOWLEDGE_FS_SPACE = "knowledge_fs_space"


@dataclass(frozen=True)
class ScanScope:
    """The product resource whose settings decide whether a file is scanned."""

    type: str
    id: str


@dataclass(frozen=True)
class ScanPolicy:
    enabled: bool = False
    provider_id: str | None = None
    on_unavailable: FileScanFallbackAction = FileScanFallbackAction.BLOCK
    on_unscannable: FileScanFallbackAction = FileScanFallbackAction.BLOCK


class ScanErrorCode(StrEnum):
    MALWARE_DETECTED = "file_scan_malware_detected"
    UNSCANNABLE = "file_scan_unscannable"
    UNAVAILABLE = "file_scan_unavailable"
    PENDING = "file_scan_pending"
    """The scanner is still working on the file; the caller may ask again."""
    PROVIDER_AUTH_FAILED = "file_scan_provider_auth_failed"
    PROVIDER_QUOTA_EXCEEDED = "file_scan_provider_quota_exceeded"
    PROVIDER_MISSING = "file_scan_provider_missing"
    FILE_MISSING = "file_scan_file_missing"


@dataclass(frozen=True)
class ScanOutcome:
    """What the caller must do with one file. ``allowed`` is the only field it has to read."""

    allowed: bool
    status: str
    """``disabled`` when the scope does not scan, otherwise the verdict status."""
    code: ScanErrorCode | None = None
    file_name: str = ""
    provider_name: str | None = None
    provider_type: str | None = None
    problem: str | None = None
    threats: tuple[str, ...] = field(default_factory=tuple)
    size_limit: int | None = None
    record_id: str | None = None
    unscanned: bool = False
    """True when the file is allowed although no clean verdict exists (policy says ``allow``)."""

    @property
    def retryable(self) -> bool:
        """Whether asking again later can change the outcome without re-uploading the file."""
        return self.code in {
            ScanErrorCode.UNAVAILABLE,
            ScanErrorCode.PENDING,
            ScanErrorCode.PROVIDER_AUTH_FAILED,
            ScanErrorCode.PROVIDER_QUOTA_EXCEEDED,
            ScanErrorCode.PROVIDER_MISSING,
        }

    def to_error(self) -> dict[str, Any]:
        """Structured reason for API responses; clients build the localized sentence from it."""
        return {
            "code": self.code.value if self.code else None,
            "file_name": self.file_name,
            "provider_name": self.provider_name,
            "provider_type": self.provider_type,
            "problem": self.problem,
            "threats": list(self.threats),
            "size_limit": self.size_limit,
            "retryable": self.retryable,
        }

    def describe(self) -> str:
        """One English sentence naming the file, the reason and the next step."""
        name = f'"{self.file_name}"' if self.file_name else "The file"
        provider = f' "{self.provider_name}"' if self.provider_name else ""
        match self.code:
            case ScanErrorCode.MALWARE_DETECTED:
                threats = ", ".join(self.threats) or "malware"
                return f"{name} was blocked by the malware scan: {threats} detected. The original file was deleted."
            case ScanErrorCode.UNSCANNABLE:
                if self.problem == "encrypted":
                    return (
                        f"{name} could not be scanned for malware because it is encrypted or password-protected. "
                        "Remove the password and upload it again."
                    )
                if self.problem == "too_large":
                    limit = f" ({self.size_limit} bytes)" if self.size_limit else ""
                    return (
                        f"{name} could not be scanned for malware because it exceeds the scanner's size limit{limit}."
                    )
                return f"{name} could not be scanned for malware because the scanner does not support this file."
            case ScanErrorCode.PROVIDER_AUTH_FAILED:
                return (
                    f"{name} was not processed: the credentials of the malware scanner{provider} are invalid. "
                    "Ask a workspace administrator to update them, then retry."
                )
            case ScanErrorCode.PROVIDER_QUOTA_EXCEEDED:
                return (
                    f"{name} was not processed: the malware scanner{provider} has run out of quota. "
                    "Ask a workspace administrator, then retry."
                )
            case ScanErrorCode.PROVIDER_MISSING:
                return (
                    f"{name} was not processed: the malware scanner selected for this knowledge base is no longer "
                    "available. Choose another scanner in the knowledge base settings, then retry."
                )
            case ScanErrorCode.PENDING:
                return f"{name} is still being scanned for malware. Retry in a moment."
            case ScanErrorCode.FILE_MISSING:
                return f"{name} was not processed: the uploaded file no longer exists."
            case ScanErrorCode.UNAVAILABLE:
                return (
                    f"{name} was not processed: the malware scanner{provider} is temporarily unavailable. Retry later."
                )
            case _:
                return f"{name} passed the malware scan."
