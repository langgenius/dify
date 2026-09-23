"""Application service for OAuth authorization-server use cases."""

from typing import Protocol

from machinery.context import RequestContext
from services.entities.oauth_server_entities import (
    OAuthAuthorizationCode,
    OAuthGrantType,
    OAuthProviderAccount,
    OAuthProviderAccountRecord,
    OAuthProviderAccountStatus,
    OAuthProviderAppPresentation,
    OAuthProviderAppRecord,
    OAuthTokenSet,
)


class OAuthServerClientNotFoundError(Exception):
    """Raised when an OAuth client identifier is unknown."""


class OAuthServerRequestError(Exception):
    """Raised when an OAuth request violates the authorization-server contract."""


class OAuthServerUnauthorizedError(Exception):
    """Raised when OAuth credentials cannot resolve an authorized account."""


OAUTH_AUTHORIZATION_CODE_EXPIRES_IN = 60 * 10  # 10 minutes
OAUTH_ACCESS_TOKEN_EXPIRES_IN = 60 * 60 * 12  # 12 hours
OAUTH_REFRESH_TOKEN_EXPIRES_IN = 60 * 60 * 24 * 30  # 30 days


class OAuthServerRepository(Protocol):
    def get_provider_app_by_client_id(self, client_id: str) -> OAuthProviderAppRecord | None: ...

    def get_account_by_id(self, account_id: str) -> OAuthProviderAccountRecord | None: ...


class OAuthServerTokenRepository(Protocol):
    def issue_authorization_code(self, client_id: str, account_id: str) -> str: ...

    def exchange_authorization_code(self, client_id: str, code: str) -> tuple[str, str]: ...

    def refresh_access_token(self, client_id: str, refresh_token: str) -> tuple[str, str]: ...

    def resolve_account_id(self, client_id: str, access_token: str) -> str | None: ...


class OAuthServerService:
    def __init__(
        self,
        *,
        repository: OAuthServerRepository,
        tokens: OAuthServerTokenRepository,
        access_token_expires_in: int,
    ) -> None:
        self._repository = repository
        self._tokens = tokens
        self._access_token_expires_in = access_token_expires_in

    def get_provider(self, *, client_id: str, redirect_uri: str) -> OAuthProviderAppPresentation:
        provider_app = self._require_provider_app(client_id)
        self._validate_redirect_uri(provider_app, redirect_uri)
        return OAuthProviderAppPresentation(
            app_icon=provider_app.app_icon,
            app_label=provider_app.app_label,
            scope=provider_app.scope,
            auto_authorize=provider_app.auto_authorize,
        )

    def authorize(self, context: RequestContext, *, client_id: str) -> OAuthAuthorizationCode:
        return self.issue_authorization_code(client_id=client_id, account_id=context.account_id)

    def issue_authorization_code(self, *, client_id: str, account_id: str) -> OAuthAuthorizationCode:
        provider_app = self._require_provider_app(client_id)
        code = self._tokens.issue_authorization_code(provider_app.client_id, account_id)
        return OAuthAuthorizationCode(code=code)

    def exchange_token(
        self,
        *,
        client_id: str,
        grant_type: str,
        code: str | None,
        client_secret: str | None,
        redirect_uri: str | None,
        refresh_token: str | None,
    ) -> OAuthTokenSet:
        provider_app = self._require_provider_app(client_id)
        try:
            parsed_grant_type = OAuthGrantType(grant_type)
        except ValueError as exc:
            raise OAuthServerRequestError("invalid grant_type") from exc

        match parsed_grant_type:
            case OAuthGrantType.AUTHORIZATION_CODE:
                if not code:
                    raise OAuthServerRequestError("code is required")
                if client_secret != provider_app.client_secret:
                    raise OAuthServerRequestError("client_secret is invalid")
                if redirect_uri is None:
                    raise OAuthServerRequestError("redirect_uri is invalid")
                self._validate_redirect_uri(provider_app, redirect_uri)
                access_token, issued_refresh_token = self._tokens.exchange_authorization_code(
                    provider_app.client_id,
                    code,
                )
            case OAuthGrantType.REFRESH_TOKEN:
                if not refresh_token:
                    raise OAuthServerRequestError("refresh_token is required")
                access_token, issued_refresh_token = self._tokens.refresh_access_token(
                    provider_app.client_id,
                    refresh_token,
                )

        return OAuthTokenSet(
            access_token=access_token,
            token_type="Bearer",
            expires_in=self._access_token_expires_in,
            refresh_token=issued_refresh_token,
        )

    def get_account(self, *, client_id: str, access_token: str | None) -> OAuthProviderAccount:
        provider_app = self._require_provider_app(client_id)
        if access_token is None:
            raise OAuthServerUnauthorizedError("access_token is required")
        account_id = self._tokens.resolve_account_id(provider_app.client_id, access_token)
        if account_id is None:
            raise OAuthServerUnauthorizedError("access_token or client_id is invalid")
        account = self._repository.get_account_by_id(account_id)
        if account is None:
            raise OAuthServerUnauthorizedError("access_token or client_id is invalid")
        if account.status != OAuthProviderAccountStatus.ACTIVE:
            if account.status == OAuthProviderAccountStatus.BANNED:
                raise OAuthServerUnauthorizedError("Account is banned.")
            raise OAuthServerUnauthorizedError("Account is not active.")
        return OAuthProviderAccount(
            id=account.id,
            name=account.name,
            email=account.email,
            avatar=account.avatar,
            interface_language=account.interface_language,
            timezone=account.timezone,
        )

    def _require_provider_app(self, client_id: str) -> OAuthProviderAppRecord:
        provider_app = self._repository.get_provider_app_by_client_id(client_id)
        if provider_app is None:
            raise OAuthServerClientNotFoundError("client_id is invalid")
        return provider_app

    @staticmethod
    def _validate_redirect_uri(provider_app: OAuthProviderAppRecord, redirect_uri: str) -> None:
        if redirect_uri not in provider_app.redirect_uris:
            raise OAuthServerRequestError("redirect_uri is invalid")
