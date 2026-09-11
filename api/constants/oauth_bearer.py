"""Stable OAuth bearer vocabulary shared across application layers."""

from dataclasses import dataclass
from enum import StrEnum


class SubjectType(StrEnum):
    ACCOUNT = "account"
    EXTERNAL_SSO = "external_sso"


class TokenType(StrEnum):
    OAUTH_ACCOUNT = "oauth_account"
    OAUTH_EXTERNAL_SSO = "oauth_external_sso"


class Scope(StrEnum):
    """Bearer scopes recognized by the OpenAPI surface."""

    FULL = "full"
    APPS_READ = "apps:read"
    APPS_READ_PERMITTED_EXTERNAL = "apps:read:permitted-external"
    APPS_RUN = "apps:run"
    WORKSPACE_READ = "workspace:read"
    WORKSPACE_WRITE = "workspace:write"


@dataclass(frozen=True, slots=True)
class MintProfile:
    subject_type: SubjectType
    prefix: str
    scopes: frozenset[Scope]


MINTABLE_PROFILES: dict[SubjectType, MintProfile] = {
    SubjectType.ACCOUNT: MintProfile(
        subject_type=SubjectType.ACCOUNT,
        prefix="dfoa_",
        scopes=frozenset({Scope.FULL}),
    ),
    SubjectType.EXTERNAL_SSO: MintProfile(
        subject_type=SubjectType.EXTERNAL_SSO,
        prefix="dfoe_",
        scopes=frozenset({Scope.APPS_RUN, Scope.APPS_READ_PERMITTED_EXTERNAL}),
    ),
}


TOKEN_CACHE_KEY_FMT = "auth:token:{hash}"
