"""Framework-neutral contracts for Console account OAuth sign-in."""

from dataclasses import dataclass

from services.entities.account_entities import AccountSessionTokens as _AccountSessionTokens
from services.entities.account_login_entities import LoginMode


@dataclass(frozen=True, slots=True)
class OAuthAuthorizationRequest:
    invite_token: str | None = None
    timezone: str | None = None
    language: str | None = None
    redirect_url: str | None = None
    mode: LoginMode = LoginMode.CONSOLE
    state: str | None = None


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
    mode: LoginMode = LoginMode.CONSOLE


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
    mode: LoginMode = LoginMode.CONSOLE


@dataclass(frozen=True, slots=True)
class OAuthSignInResult:
    tokens: _AccountSessionTokens
    oauth_new_user: bool


@dataclass(frozen=True, slots=True)
class OAuthInvitationResult:
    tokens: _AccountSessionTokens
    invite_token: str


type OAuthCallbackResult = OAuthSignInResult | OAuthInvitationResult
