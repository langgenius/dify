from collections.abc import Callable
from dataclasses import dataclass, field
from enum import StrEnum


class ScanProviderType(StrEnum):
    CLAMAV = "clamav"
    CLOUDMERSIVE = "cloudmersive"
    SCANII = "scanii"
    METADEFENDER = "metadefender"
    API = "api"


class ScanStatus(StrEnum):
    CLEAN = "clean"
    INFECTED = "infected"
    UNSCANNABLE = "unscannable"
    """The scanner answered, but cannot give a verdict for this file (encrypted, too large, ...)."""
    UNAVAILABLE = "unavailable"
    """The scanner could not be used at all (network, credentials, quota, ...)."""


class ScanProblem(StrEnum):
    AUTH = "auth"
    QUOTA = "quota"
    TIMEOUT = "timeout"
    NETWORK = "network"
    SERVER_ERROR = "server_error"
    INVALID_RESPONSE = "invalid_response"
    PENDING = "pending"
    """The scanner accepted the file and is still working; ask again with ``external_id``."""
    TOO_LARGE = "too_large"
    ENCRYPTED = "encrypted"
    UNSUPPORTED = "unsupported"


RETRYABLE_PROBLEMS = frozenset(
    {ScanProblem.TIMEOUT, ScanProblem.NETWORK, ScanProblem.SERVER_ERROR, ScanProblem.PENDING}
)
"""Transient failures. Credential and quota failures are never retried: they need an administrator."""

MAX_THREATS = 20
MAX_THREAT_LENGTH = 200
MAX_MESSAGE_LENGTH = 500


@dataclass(frozen=True)
class ScanTarget:
    """One file to scan. Content is read lazily so that cached verdicts cost no storage read."""

    scan_id: str
    file_name: str
    size: int
    mime_type: str
    file_hash: str
    load: Callable[[], bytes]


@dataclass(frozen=True)
class ScanVerdict:
    status: ScanStatus
    problem: ScanProblem | None = None
    threats: tuple[str, ...] = field(default_factory=tuple)
    engine: str | None = None
    message: str | None = None
    external_id: str | None = None
    size_limit: int | None = None

    def __post_init__(self) -> None:
        # Scanner output is untrusted text that ends up in the database and the console.
        threats = tuple(str(threat)[:MAX_THREAT_LENGTH] for threat in self.threats[:MAX_THREATS])
        object.__setattr__(self, "threats", threats)
        if self.message is not None:
            object.__setattr__(self, "message", str(self.message)[:MAX_MESSAGE_LENGTH])
        if self.engine is not None:
            object.__setattr__(self, "engine", str(self.engine)[:MAX_THREAT_LENGTH])

    @property
    def retryable(self) -> bool:
        return self.status is ScanStatus.UNAVAILABLE and self.problem in RETRYABLE_PROBLEMS

    @classmethod
    def clean(cls, *, engine: str | None = None, external_id: str | None = None) -> "ScanVerdict":
        return cls(status=ScanStatus.CLEAN, engine=engine, external_id=external_id)

    @classmethod
    def infected(
        cls, threats: list[str] | tuple[str, ...], *, engine: str | None = None, external_id: str | None = None
    ) -> "ScanVerdict":
        return cls(status=ScanStatus.INFECTED, threats=tuple(threats), engine=engine, external_id=external_id)

    @classmethod
    def unscannable(
        cls,
        problem: ScanProblem,
        *,
        message: str | None = None,
        size_limit: int | None = None,
        external_id: str | None = None,
    ) -> "ScanVerdict":
        return cls(
            status=ScanStatus.UNSCANNABLE,
            problem=problem,
            message=message,
            size_limit=size_limit,
            external_id=external_id,
        )

    @classmethod
    def unavailable(
        cls, problem: ScanProblem, *, message: str | None = None, external_id: str | None = None
    ) -> "ScanVerdict":
        return cls(status=ScanStatus.UNAVAILABLE, problem=problem, message=message, external_id=external_id)
