"""Types, errors and ports shared by the knowledge-agent modules.

Nothing here touches the database or Redis, so every other module of the package (and the MCP
tool surface) can import it without pulling the services in.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, NamedTuple, Protocol, overload

from enums.account import TenantAccountRole

AUDIT_GRANT_CREATED = "knowledge_agent.grant_created"
AUDIT_GRANT_REVOKED = "knowledge_agent.grant_revoked"


class KnowledgeAgentAccessError(Exception):
    """A client-visible failure of a Console call (consent page, connection management)."""

    def __init__(self, status: int, code: str, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details or {}


class KnowledgeAgentUrls(NamedTuple):
    """Public URLs; the MCP resource and the token endpoints live on the API host."""

    issuer: str
    resource: str
    authorize: str
    token: str
    register: str
    revocation: str


@dataclass(frozen=True, slots=True)
class KnowledgeAgentPrincipal:
    """An authenticated connection: the member it acts as and the knowledge bases chosen for it."""

    account_id: str
    tenant_id: str
    grant_id: str
    token_id: str
    kind: str
    client_name: str
    control_space_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class KnowledgeAgentAuthFailure:
    """Why a bearer was refused, as the HTTP status and error code the MCP endpoint answers with."""

    status: int
    error: str


class KnowledgeAgentSpacePort(Protocol):
    """The member's current view of the workspace's knowledge bases."""

    def readable(self, *, tenant_id: str, account_id: str, control_space_ids: Iterable[str]) -> set[str]:
        """Active knowledge bases among the ids the member may read now."""
        ...

    def blocked(self, *, tenant_id: str, control_space_ids: Iterable[str] | None = None) -> set[str]:
        """Knowledge bases whose managers turned personal agents off."""
        ...


class KnowledgeAgentRedis(Protocol):
    """The Redis commands the package uses: authorization codes, rate counters, the token cache."""

    def get(self, name: str, /) -> Any: ...

    def set(self, name: str, value: str, /, *, ex: int, nx: bool) -> Any: ...

    def setex(self, name: str, time: int, value: str, /) -> Any: ...

    def delete(self, *names: str | bytes) -> int: ...

    def incr(self, name: str, /) -> int: ...

    def expire(self, name: str, time: int, /) -> Any: ...

    def ttl(self, name: str, /) -> int: ...


ClientMetadataFetcher = Callable[[str], tuple[int, bytes]]
Clock = Callable[[], datetime]


def utcnow() -> datetime:
    """The default clock of the knowledge-agent services."""
    return datetime.now(UTC)


@overload
def aware(value: datetime) -> datetime: ...


@overload
def aware(value: datetime | None) -> datetime | None: ...


def aware(value: datetime | None) -> datetime | None:
    """Dialects without zone-aware DATETIME (MySQL, SQLite) return naive values stored in UTC."""
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def is_workspace_admin(role: str | None) -> bool:
    """Whether a workspace role (as the Console passes it) may manage other members' connections."""
    return role is not None and TenantAccountRole.is_privileged_role(TenantAccountRole(role))
