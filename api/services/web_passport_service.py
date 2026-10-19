"""Application service for issuing passports used by deployed web applications."""

from collections.abc import Callable, Mapping
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Any, Protocol

from services.entities.passport_entities import (
    EndUserRecord,
    WebAppLoginClaims,
    WebAppRecord,
    WebPassportEndUserResolution,
    WebPassportRequest,
    WebPassportResult,
)
from services.web_identity_service import WebIdentityError, WebIdentityService


class WebAppAuthType(StrEnum):
    PUBLIC = "public"
    INTERNAL = "internal"
    EXTERNAL = "external"


class WebPassportNotFoundError(Exception):
    pass


class WebPassportUnauthorizedError(Exception):
    pass


class WebPassportAuthenticationRequiredError(Exception):
    pass


class WebPassportAccessDeniedError(Exception):
    pass


class WebPassportRepository(Protocol):
    def get_active_web_app(self, app_code: str) -> WebAppRecord | None: ...

    def is_web_app_active(self, app: WebAppRecord) -> bool: ...

    def resolve_standard_end_user(self, app: WebAppRecord, session_id: str | None) -> WebPassportEndUserResolution: ...

    def resolve_account_end_user(self, app: WebAppRecord, account_id: str) -> WebPassportEndUserResolution: ...

    def restore_guest_end_user(self, app: WebAppRecord, end_user_id: str) -> WebPassportEndUserResolution: ...

    def resolve_authenticated_end_user(
        self,
        app: WebAppRecord,
        *,
        end_user_id: str | None,
        session_id: str | None,
    ) -> WebPassportEndUserResolution: ...


class WebPassportAuthGateway(Protocol):
    def is_webapp_auth_enabled(self) -> bool: ...

    def get_app_auth_type(self, app_id: str) -> WebAppAuthType: ...

    def is_account_allowed(self, app_id: str, account_id: str) -> bool: ...


class WebPassportTokenGateway(Protocol):
    def verify(self, token: str) -> Mapping[str, Any]: ...

    def issue(self, payload: Mapping[str, Any]) -> str: ...


class WebPassportService:
    def __init__(
        self,
        *,
        passports: WebPassportRepository,
        auth: WebPassportAuthGateway,
        tokens: WebPassportTokenGateway,
        identities: WebIdentityService,
        now: Callable[[], datetime],
        access_token_expire_minutes: int,
    ) -> None:
        self._passports = passports
        self._auth = auth
        self._tokens = tokens
        self._identities = identities
        self._now = now
        self._access_token_expire_minutes = access_token_expire_minutes

    def issue(self, request: WebPassportRequest) -> WebPassportResult:
        app = self._passports.get_active_web_app(request.app_code)
        if app is None:
            raise WebPassportNotFoundError()

        login_claims = self._decode_login_token(request.access_token)
        auth_type = WebAppAuthType.PUBLIC
        if self._auth.is_webapp_auth_enabled():
            auth_type = self._auth.get_app_auth_type(app.app_id)
            if auth_type != WebAppAuthType.PUBLIC:
                if login_claims is None:
                    raise WebPassportAuthenticationRequiredError("Web app authentication required.")
                self._require_active_web_app(app)
                if login_claims.account_id is None:
                    return self._exchange_enterprise_token(app, login_claims, auth_type)

        if login_claims is not None and login_claims.account_id is not None:
            if auth_type == WebAppAuthType.EXTERNAL:
                raise WebPassportAuthenticationRequiredError("Please login as external user.")
            if auth_type == WebAppAuthType.INTERNAL and not self._auth.is_account_allowed(
                app.app_id, login_claims.account_id
            ):
                raise WebPassportAccessDeniedError("Account cannot access this web app.")
            return self._exchange_account_token(app, login_claims)

        end_user = self._resolve_guest(app, request)
        token = self._tokens.issue(
            {
                "iss": app.app_id,
                "sub": "Web API Passport",
                "app_id": app.app_id,
                "app_code": app.app_code,
                "end_user_id": end_user.id,
            }
        )
        return WebPassportResult(access_token=token)

    def _decode_login_token(self, token: str | None) -> WebAppLoginClaims | None:
        if not token:
            return None

        try:
            return self._identities.resolve_login(self._tokens.verify(token))
        except WebIdentityError as exc:
            raise WebPassportUnauthorizedError(str(exc)) from exc

    def _exchange_account_token(self, app: WebAppRecord, claims: WebAppLoginClaims) -> WebPassportResult:
        assert claims.account_id is not None
        assert claims.exp is not None
        resolution = self._passports.resolve_account_end_user(app, claims.account_id)
        self._require_active_resolution(resolution)
        if resolution.end_user is None:
            raise WebPassportNotFoundError()
        now = self._now()
        expires_at = min(claims.exp, int((now + timedelta(minutes=self._access_token_expire_minutes)).timestamp()))
        return WebPassportResult(
            access_token=self._tokens.issue(
                {
                    "iss": app.app_id,
                    "sub": "Web API Passport",
                    "app_id": app.app_id,
                    "app_code": app.app_code,
                    "end_user_id": resolution.end_user.id,
                    "token_source": "webapp_account",
                    "auth_type": WebAppAuthType.INTERNAL.value,
                    "granted_at": int(now.timestamp()),
                    "exp": expires_at,
                }
            )
        )

    def _resolve_guest(self, app: WebAppRecord, request: WebPassportRequest) -> EndUserRecord:
        if request.guest_passport:
            decoded = self._tokens.verify(request.guest_passport)
            if decoded.get("token_source") in {"webapp_account", "webapp"}:
                # Logging out or making an enterprise App public must not convert its
                # authenticated user's existing resources into anonymous resources.
                return self._resolve_standard_user(app, None)
            if (
                decoded.get("sub") != "Web API Passport"
                or decoded.get("token_source") is not None
                or decoded.get("app_id") != app.app_id
                or decoded.get("app_code") != app.app_code
                or not isinstance(decoded.get("end_user_id"), str)
            ):
                raise WebPassportUnauthorizedError("Invalid guest Passport.")
            resolution = self._passports.restore_guest_end_user(app, decoded["end_user_id"])
            self._require_active_resolution(resolution)
            if resolution.end_user is None:
                raise WebPassportUnauthorizedError("Guest session is unavailable.")
            return resolution.end_user
        # Session IDs appear in Builder logs and are not bearer credentials. Keep accepting
        # the legacy query parameter, but only a verified Passport can restore an identity.
        return self._resolve_standard_user(app, None)

    def _resolve_standard_user(self, app: WebAppRecord, session_id: str | None) -> EndUserRecord:
        resolution = self._passports.resolve_standard_end_user(app, session_id)
        self._require_active_resolution(resolution)
        if resolution.end_user is None:
            raise WebPassportNotFoundError()
        return resolution.end_user

    def _exchange_enterprise_token(
        self,
        app: WebAppRecord,
        claims: WebAppLoginClaims,
        auth_type: WebAppAuthType,
    ) -> WebPassportResult:
        user_auth_type = claims.auth_type
        if not user_auth_type:
            raise WebPassportUnauthorizedError("Missing auth_type in the token.")

        if auth_type == WebAppAuthType.EXTERNAL and user_auth_type != WebAppAuthType.EXTERNAL:
            raise WebPassportAuthenticationRequiredError("Please login as external user.")
        if auth_type == WebAppAuthType.INTERNAL and user_auth_type != WebAppAuthType.INTERNAL:
            raise WebPassportAuthenticationRequiredError("Please login as internal user.")

        resolution = self._passports.resolve_authenticated_end_user(
            app,
            end_user_id=claims.end_user_id,
            session_id=claims.session_id,
        )
        self._require_active_resolution(resolution)
        if resolution.end_user is None:
            if not claims.session_id:
                raise WebPassportNotFoundError("Missing session_id for existing web user.")
            raise WebPassportNotFoundError()
        end_user = resolution.end_user

        now = self._now()
        expires_at = int((now + timedelta(minutes=self._access_token_expire_minutes)).timestamp())
        if claims.exp:
            expires_at = int(claims.exp)

        token = self._tokens.issue(
            {
                "iss": app.site_id,
                "sub": "Web API Passport",
                "app_id": app.app_id,
                "app_code": app.app_code,
                "user_id": claims.user_id,
                "end_user_id": end_user.id,
                "auth_type": user_auth_type,
                "granted_at": int(now.timestamp()),
                "token_source": "webapp",
                "exp": expires_at,
            }
        )
        return WebPassportResult(access_token=token)

    def _require_active_web_app(self, app: WebAppRecord) -> None:
        if not self._passports.is_web_app_active(app):
            raise WebPassportNotFoundError()

    @staticmethod
    def _require_active_resolution(resolution: WebPassportEndUserResolution) -> None:
        if not resolution.app_active:
            raise WebPassportNotFoundError()
