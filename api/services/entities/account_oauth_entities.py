"""Framework-neutral contracts for Console account OAuth sign-in."""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class OAuthAuthorizationRequest:
    invite_token: str | None = None
    timezone: str | None = None
    language: str | None = None
    redirect_url: str | None = None


@dataclass(frozen=True, slots=True)
class OAuthIdentity:
    id: str
    name: str
    email: str


@dataclass(frozen=True, slots=True)
class OAuthCallbackCommand:
    provider: str
    code: str
    invite_token: str | None
    timezone: str | None
    language: str | None
    browser_language: str | None
    ip_address: str


@dataclass(frozen=True, slots=True)
class OAuthInvitation:
    account_id: str
    account_email: str
    account_status: str


@dataclass(frozen=True, slots=True)
class OAuthAccountRegistration:
    email: str
    name: str
    language: str
    timezone: str | None
    ip_address: str


@dataclass(frozen=True, slots=True)
class AccountSessionTokens:
    access_token: str
    refresh_token: str
    csrf_token: str


@dataclass(frozen=True, slots=True)
class OAuthSignInResult:
    tokens: AccountSessionTokens
    oauth_new_user: bool


@dataclass(frozen=True, slots=True)
class OAuthInvitationResult:
    tokens: AccountSessionTokens
    invite_token: str


type OAuthCallbackResult = OAuthSignInResult | OAuthInvitationResult
