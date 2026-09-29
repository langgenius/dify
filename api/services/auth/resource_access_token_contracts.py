"""Value objects, credential format helpers, and errors for workspace machine credentials."""

from dataclasses import dataclass
from datetime import datetime

from constants.resource_access_token import TOKEN_PREFIX, ResourceAccessTokenResourceType


@dataclass(frozen=True, slots=True)
class ResourceAccessTokenResource:
    type: ResourceAccessTokenResourceType
    id: str


@dataclass(frozen=True, slots=True)
class ResourceAccessTokenRow:
    token_id: str
    relation_id: str
    name: str
    track_id: str
    token: str | None  # Only creation exposes the secret.
    masked_token: str
    resource_type: ResourceAccessTokenResourceType
    resource_id: str
    resource_name: str
    created_at: datetime
    last_used_at: datetime | None  # None means the credential has never been used.


@dataclass(frozen=True, slots=True)
class ResourceAccessTokenCreateResult:
    token_id: str
    token: str
    rows: tuple[ResourceAccessTokenRow, ...]


@dataclass(frozen=True, slots=True)
class BoundResource:
    type: ResourceAccessTokenResourceType
    id: str
    exists: bool
    enabled: bool


@dataclass(frozen=True, slots=True)
class ResourceAccessTokenAccess:
    token_id: str
    tenant_id: str
    workspace_active: bool
    resources: tuple[BoundResource, ...]


@dataclass(frozen=True, slots=True)
class ResourceAccessTokenGrant:
    token_id: str
    tenant_id: str
    app_ids: frozenset[str]


class ResourceAccessTokenInputError(Exception):
    pass


class ResourceAccessTokenNotFoundError(Exception):
    pass


class ResourceAccessTokenForbiddenError(Exception):
    pass


class ResourceAccessTokenInvalidError(Exception):
    pass


def is_resource_access_token(token: str) -> bool:
    """Identify the credential format; authentication must still validate the token."""
    return token.startswith(TOKEN_PREFIX)


def mask_token(token: str) -> str:
    if len(token) <= 12:
        return token
    return f"{token[:8]}...{token[-4:]}"
