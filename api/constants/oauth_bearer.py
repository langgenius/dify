"""Stable OAuth bearer vocabulary shared across application layers."""

from __future__ import annotations

from enum import StrEnum


class Scope(StrEnum):
    """Catalog of bearer scopes recognised by the openapi surface.

    `FULL` is the catch-all carried by `dfoa_` account tokens — it satisfies
    any per-route scope requirement. `dfoe_` tokens carry the per-feature
    scopes (`APPS_RUN`, `APPS_READ_PERMITTED_EXTERNAL`).
    """

    FULL = "full"
    APPS_READ = "apps:read"
    APPS_READ_PERMITTED_EXTERNAL = "apps:read:permitted-external"
    APPS_RUN = "apps:run"
    WORKSPACE_READ = "workspace:read"
    WORKSPACE_WRITE = "workspace:write"


class SubjectType(StrEnum):
    # Annotation-only names are not members; they declare what `__new__` attaches.
    scopes: frozenset[Scope]
    # Whether the subject's token rows carry an `account_id`. A subject that does
    # not is keyed by its external issuer instead.
    bound_to_account: bool

    ACCOUNT = ("account", frozenset({Scope.FULL}), True)
    EXTERNAL_SSO = ("external_sso", frozenset({Scope.APPS_RUN, Scope.APPS_READ_PERMITTED_EXTERNAL}), False)

    def __new__(cls, value: str, scopes: frozenset[Scope], bound_to_account: bool) -> SubjectType:
        obj = str.__new__(cls, value)
        obj._value_ = value
        obj.scopes = scopes
        obj.bound_to_account = bound_to_account
        return obj


class TokenType(StrEnum):
    """Many token types may serve one subject; the prefix is the only thing a
    bearer string reveals, so it lives here and nowhere else.
    """

    prefix: str
    subject: SubjectType

    OAUTH_ACCOUNT = ("oauth_account", "dfoa_", SubjectType.ACCOUNT)
    OAUTH_EXTERNAL_SSO = ("oauth_external_sso", "dfoe_", SubjectType.EXTERNAL_SSO)

    def __new__(cls, value: str, prefix: str, subject: SubjectType) -> TokenType:
        obj = str.__new__(cls, value)
        obj._value_ = value
        obj.prefix = prefix
        obj.subject = subject
        return obj

    @classmethod
    def for_token(cls, token: str) -> TokenType | None:
        return next((token_type for token_type in cls if token.startswith(token_type.prefix)), None)


TOKEN_CACHE_KEY_FMT = "auth:token:{hash}"
