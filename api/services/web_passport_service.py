"""Application service for issuing passports used by deployed web applications."""

from collections.abc import Callable, Mapping
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Any, Protocol

from pydantic import ValidationError

from services.entities.passport_entities import (
    EndUserRecord,
    WebAppLoginClaims,
    WebAppRecord,
    WebPassportEndUserResolution,
    WebPassportRequest,
    WebPassportResult,
)


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


class WebPassportRepository(Protocol):
    def get_active_web_app(self, app_code: str) -> WebAppRecord | None: ...

    def is_web_app_active(self, app: WebAppRecord) -> bool: ...

    def resolve_standard_end_user(self, app: WebAppRecord, session_id: str | None) -> WebPassportEndUserResolution: ...

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
        now: Callable[[], datetime],
        access_token_expire_minutes: int,
    ) -> None:
        self._passports = passports
        self._auth = auth
        self._tokens = tokens
        self._now = now
        self._access_token_expire_minutes = access_token_expire_minutes

    def issue(self, request: WebPassportRequest) -> WebPassportResult:
        app = self._passports.get_active_web_app(request.app_code)
        if app is None:
            raise WebPassportNotFoundError()

        login_claims: WebAppLoginClaims | None = None
        if self._auth.is_webapp_auth_enabled():
            login_claims = self._decode_login_token(request.access_token)
            auth_type = self._auth.get_app_auth_type(app.app_id)
            if auth_type != WebAppAuthType.PUBLIC:
                if login_claims is None:
                    raise WebPassportAuthenticationRequiredError("Web app authentication required.")
                self._require_active_web_app(app)
                return self._exchange_enterprise_token(app, login_claims, auth_type)

        end_user = self._resolve_standard_user(app, request.user_session_id)
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

        decoded = self._tokens.verify(token)
        try:
            claims = WebAppLoginClaims.model_validate(decoded)
        except ValidationError as exc:
            raise WebPassportUnauthorizedError("Invalid web app login token.") from exc

        if claims.token_source != "webapp_login_token":
            raise WebPassportUnauthorizedError("Invalid token source. Expected 'webapp_login_token'.")
        return claims

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
            expires_at = claims.exp

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
