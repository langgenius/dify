"""Primitive-independent identifiers, scopes, email, and time values."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import override


@dataclass(frozen=True, slots=True)
class _Identifier:
    """Non-empty string identifier with explicit primitive serialization."""

    value: str

    def __post_init__(self) -> None:
        if not isinstance(self.value, str) or not self.value.strip():
            raise ValueError(f"{type(self).__name__} must not be blank")
        object.__setattr__(self, "value", self.value.strip())

    @override
    def __str__(self) -> str:
        return self.value

    def to_primitive(self) -> str:
        return self.value


class AccountId(_Identifier):
    """Identifier of an Account record."""


class ContactId(_Identifier):
    """Identifier of a canonical Contact."""


class PlatformEntryId(_Identifier):
    """Identifier of one Platform allow-list entry."""


class WorkspaceId(_Identifier):
    """Identifier of the workspace that owns or resolves a Contact."""


@dataclass(frozen=True, slots=True)
class NormalizedEmail:
    """Case-insensitive canonical email used for identity comparisons."""

    value: str

    def __post_init__(self) -> None:
        if not isinstance(self.value, str):
            raise ValueError("value must be a valid email")
        normalized = self.value.strip().casefold()
        local, separator, domain = normalized.partition("@")
        if not separator or not local or not domain or " " in normalized or "@" in domain:
            raise ValueError("value must be a valid email")
        object.__setattr__(self, "value", normalized)

    @override
    def __str__(self) -> str:
        return self.value

    def to_primitive(self) -> str:
        return self.value


@dataclass(frozen=True, slots=True)
class DeploymentScope:
    """Deployment-wide owner scope used by EE Organization contacts."""

    def to_primitive(self) -> dict[str, str]:
        return {"kind": "deployment"}


@dataclass(frozen=True, slots=True)
class WorkspaceScope:
    """Owner scope for workspace-owned contacts and directory operations."""

    workspace_id: WorkspaceId

    def to_primitive(self) -> dict[str, str]:
        return {"kind": "workspace", "workspace_id": self.workspace_id.to_primitive()}


type DirectoryScope = DeploymentScope | WorkspaceScope


@dataclass(frozen=True, slots=True)
class UtcTimestamp:
    """Timezone-aware timestamp normalized to UTC at construction."""

    value: datetime

    def __post_init__(self) -> None:
        if not isinstance(self.value, datetime) or self.value.tzinfo is None or self.value.utcoffset() is None:
            raise ValueError("value must be a timezone-aware datetime")
        object.__setattr__(self, "value", self.value.astimezone(UTC))

    @classmethod
    def now(cls) -> UtcTimestamp:
        return cls(datetime.now(UTC))

    def to_primitive(self) -> str:
        return self.value.isoformat().replace("+00:00", "Z")
