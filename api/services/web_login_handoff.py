"""Account login sessions for the personal portal and PKCE-bound Web App handoffs."""

import base64
import hashlib
import secrets
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Protocol
from urllib.parse import urlencode, urlsplit, urlunsplit

from pydantic import BaseModel, Field

from services.web_identity_service import WebIdentityError, WebIdentityService
from services.web_login_redirect import resolve_web_login_redirect
from services.web_passport_service import (
    WebPassportAccountExchangeDisabledError,
    WebPassportNotFoundError,
    WebPassportRepository,
    WebPassportTokenGateway,
    WebPassportUnauthorizedError,
)

HANDOFF_TTL_SECONDS = 60
S256_CHALLENGE_PATTERN = r"^[A-Za-z0-9_-]{43}$"


class WebLoginTarget(BaseModel):
    app_code: str = Field(min_length=1)
    redirect_url: str = Field(min_length=1)
    code_challenge: str = Field(pattern=S256_CHALLENGE_PATTERN, description="S256 PKCE challenge")


class _WebLoginProof(BaseModel):
    account_id: str
    expires_at: int
    login_expires_at: int
    code_challenge: str


class WebLoginGrant(_WebLoginProof):
    # In-flight App grants from older issuers have no discriminator.
    kind: Literal["app"] = "app"
    tenant_id: str
    app_id: str
    app_code: str


class WebPortalLoginGrant(_WebLoginProof):
    kind: Literal["portal"]


type WebLoginGrantRecord = WebLoginGrant | WebPortalLoginGrant


class WebLoginUnavailableError(Exception):
    pass


@dataclass(frozen=True)
class WebLoginSession:
    access_token: str
    expires_at: int


class WebLoginGrantStore(Protocol):
    """Store grants under code digests with a bounded TTL; consume must atomically get and delete."""

    def put(self, key: str, grant: WebLoginGrantRecord) -> None: ...

    def get(self, key: str) -> WebLoginGrantRecord | None: ...

    def consume(self, key: str) -> WebLoginGrantRecord | None: ...


class EndUserOnboardingStore(Protocol):
    def record_end_user_handoff(self, account_id: str, *, occurred_at: datetime) -> None:
        """Keep the earliest known End User event for the verified Account in one conditional write.

        A missing or ineligible Account, or an equal or earlier stored time, is a no-op.
        This does not activate the Account or require a workspace.
        """
        ...


class WebLoginHandoffService:
    def __init__(
        self,
        *,
        grants: WebLoginGrantStore,
        onboarding: EndUserOnboardingStore,
        apps: WebPassportRepository,
        identities: WebIdentityService,
        tokens: WebPassportTokenGateway,
        enabled: bool,
        app_web_url: str,
        console_web_url: str,
        now: Callable[[], datetime],
    ) -> None:
        self._grants = grants
        self._onboarding = onboarding
        self._apps = apps
        self._identities = identities
        self._tokens = tokens
        self._enabled = enabled
        self._app_web_url = app_web_url
        self._console_web_url = console_web_url
        self._now = now

    def validate_target(self, target: WebLoginTarget) -> str:
        if not self._enabled:
            raise WebPassportAccountExchangeDisabledError()
        redirect_url = resolve_web_login_redirect(
            target.redirect_url, app_web_url=self._app_web_url, console_web_url=self._console_web_url
        )
        if redirect_url is None or urlsplit(redirect_url).path.rsplit("/", 1)[-1] != target.app_code:
            raise ValueError("Invalid Web App login target.")
        return redirect_url

    def authorize(self, target: WebLoginTarget, access_token: str) -> str:
        """Return a PKCE callback for an admitted Console Account and an active, matching App."""
        redirect_url = self.validate_target(target)
        account_id, login_expires_at = self._console_identity(access_token)
        app = self._apps.get_active_web_app(target.app_code)
        if app is None:
            raise WebPassportNotFoundError()
        code = self._store_grant(
            WebLoginGrant(
                tenant_id=app.tenant_id,
                app_id=app.app_id,
                app_code=app.app_code,
                account_id=account_id,
                expires_at=self._grant_expiry(login_expires_at),
                login_expires_at=login_expires_at,
                code_challenge=target.code_challenge,
            ),
        )
        base = urlsplit(self._app_web_url or self._console_web_url)
        return urlunsplit(
            (
                base.scheme,
                base.netloc,
                f"{base.path.rstrip('/')}/webapp-signin",
                urlencode({"redirect_url": redirect_url, "login_code": code, "mode": "end_user"}),
                "",
            )
        )

    def personal_session(self, access_token: str) -> WebLoginSession:
        """Issue a personal portal session for a verified Console identity, then record its handoff."""
        if not self._enabled:
            raise WebPassportAccountExchangeDisabledError()
        account_id, expires_at = self._console_identity(access_token)
        session = self._issue_login_session(account_id=account_id, expires_at=expires_at)
        self._onboarding.record_end_user_handoff(account_id, occurred_at=self._now())
        return session

    def authorize_portal(self, *, access_token: str, code_challenge: str) -> str:
        """Issue a short-lived portal grant for a verified Console session and a validated S256 challenge."""
        if not self._enabled:
            raise WebPassportAccountExchangeDisabledError()
        account_id, login_expires_at = self._console_identity(access_token)
        return self._store_grant(
            WebPortalLoginGrant(
                kind="portal",
                account_id=account_id,
                expires_at=self._grant_expiry(login_expires_at),
                login_expires_at=login_expires_at,
                code_challenge=code_challenge,
            ),
        )

    def _store_grant(self, grant: WebLoginGrantRecord) -> str:
        """Record the handoff and return its opaque code only after the App or portal grant is stored by digest."""
        code = secrets.token_urlsafe(32)
        occurred_at = self._now()
        self._grants.put(self._key(code), grant)
        self._onboarding.record_end_user_handoff(grant.account_id, occurred_at=occurred_at)
        return code

    def _grant_expiry(self, login_expires_at: int) -> int:
        """Cap a grant by both its short TTL and the verified Console login's expiry."""
        return min(login_expires_at, int(self._now().timestamp()) + HANDOFF_TTL_SECONDS)

    def _console_identity(self, access_token: str) -> tuple[str, int]:
        """Return the verified Console Account ID and expiry, rejecting other token purposes."""
        try:
            claims = self._identities.resolve_login(self._tokens.verify(access_token))
        except WebIdentityError as exc:
            raise WebPassportUnauthorizedError("Account login required.") from exc
        if claims.token_source is not None or claims.account_id is None or claims.exp is None:
            raise WebPassportUnauthorizedError("Account login required.")
        return claims.account_id, claims.exp

    def redeem(self, *, app_code: str, code: str, code_verifier: str) -> WebLoginSession:
        """Consume a live App grant only after its proof and current App/tenant binding match."""
        if not self._enabled:
            raise WebPassportAccountExchangeDisabledError()
        key = self._key(code)
        grant = self._grants.get(key)
        if (
            not isinstance(grant, WebLoginGrant)
            or grant.app_code != app_code
            or not self._valid_proof(grant, code_verifier)
        ):
            raise ValueError("Invalid or expired Web App login code.")
        app = self._apps.get_active_web_app(app_code)
        if app is None or app.app_id != grant.app_id or app.tenant_id != grant.tenant_id:
            raise WebPassportNotFoundError()
        return self._consume_grant(key, grant)

    def redeem_portal(self, *, code: str, code_verifier: str) -> WebLoginSession:
        """Exchange a live portal code and its S256 verifier for a Web-only Account session.

        App grants and wrong proofs are rejected without consumption. A winning exchange
        still requires an active Account and cannot extend the original login's expiry.
        """
        if not self._enabled:
            raise WebPassportAccountExchangeDisabledError()
        key = self._key(code)
        grant = self._grants.get(key)
        if not isinstance(grant, WebPortalLoginGrant) or not self._valid_proof(grant, code_verifier):
            raise ValueError("Invalid or expired Web App login code.")
        return self._consume_grant(key, grant)

    def _valid_proof(self, grant: _WebLoginProof, code_verifier: str) -> bool:
        """Check the verifier and expiry without consuming the grant. The caller validates the verifier format."""
        challenge = (
            base64.urlsafe_b64encode(hashlib.sha256(code_verifier.encode("ascii")).digest()).rstrip(b"=").decode()
        )
        now = int(self._now().timestamp())
        return grant.expires_at > now and secrets.compare_digest(grant.code_challenge, challenge)

    def _consume_grant(self, key: str, grant: WebLoginGrantRecord) -> WebLoginSession:
        """Consume the checked grant atomically, recheck account admission, then mint its Webapp session."""
        # Failed proofs do not consume a valid grant; GETDEL admits only one successful exchange.
        if self._grants.consume(key) != grant:
            raise ValueError("Web App login code has already been consumed.")
        try:
            self._identities.require_account(grant.account_id)
        except WebIdentityError as exc:
            raise WebPassportUnauthorizedError("Account is unavailable.") from exc
        return self._issue_login_session(account_id=grant.account_id, expires_at=grant.login_expires_at)

    def _issue_login_session(self, *, account_id: str, expires_at: int) -> WebLoginSession:
        return WebLoginSession(
            access_token=self._tokens.issue(
                {
                    "sub": "Web API Account Login",
                    "token_source": "webapp_account_login",
                    "user_id": account_id,
                    "auth_type": "internal",
                    "exp": expires_at,
                }
            ),
            expires_at=expires_at,
        )

    @staticmethod
    def _key(code: str) -> str:
        return hashlib.sha256(code.encode()).hexdigest()
