"""Grant handlers registered into ``OAuthTokenService``."""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import NoReturn, Protocol

from models.account import AccountStatus
from repositories.oauth_authorization_code_repository import AuthorizationCodeRecord, RedisAuthorizationCodeRepository
from repositories.oauth_refresh_token_repository import RefreshTokenRecord, SQLAlchemyOAuthRefreshTokenRepository
from services.entities.account_entities import AccountSnapshot
from services.oauth_client_auth import authenticate_client
from services.oauth_clients import OAuthClientRegistry, ResolvedClient
from services.oauth_device_application_service import (
    DeviceWorkspaceQuery,
    OAuthDeviceAccountQuery,
    OAuthDeviceTokenIssuer,
    build_account_poll_payload,
)
from services.oauth_device_contracts import (
    AccessDeniedError,
    AuthorizationPendingError,
    ClientMismatchError,
    ExpiredTokenError,
    OAuthDeviceError,
    PollPayload,
    PollTooFastError,
    PresentedRefreshToken,
    RefreshTokenIssue,
    RefreshTokenRejectedError,
    RefreshTokenReusedError,
    default_device_label,
)
from services.oauth_grant_revoker import GrantRevoker
from services.oauth_pkce import verify_pkce
from services.oauth_resource import InvalidResourceError, openapi_issuer_url, resolve_resource
from services.oauth_token_contracts import (
    GrantType,
    OAuthTokenSettings,
    TokenEndpointError,
    TokenErrorCode,
    TokenGrantResult,
    TokenRequest,
)
from services.oauth_token_service import GrantHandler

_DEVICE_ERROR_TO_TOKEN_ERROR: Mapping[type[OAuthDeviceError], TokenErrorCode] = {
    PollTooFastError: TokenErrorCode.SLOW_DOWN,
    AuthorizationPendingError: TokenErrorCode.AUTHORIZATION_PENDING,
    AccessDeniedError: TokenErrorCode.ACCESS_DENIED,
    ExpiredTokenError: TokenErrorCode.EXPIRED_TOKEN,
    ClientMismatchError: TokenErrorCode.INVALID_CLIENT,
}


class DeviceGrantPoller(Protocol):
    def poll_device_grant(self, *, client_id: str, device_code: str, poll_ip: str) -> PollPayload: ...


class DeviceCodeGrantHandler:
    def __init__(self, device: DeviceGrantPoller) -> None:
        self._device = device

    def __call__(self, request: TokenRequest) -> TokenGrantResult:
        if not request.client_id or not request.device_code:
            raise TokenEndpointError(TokenErrorCode.INVALID_REQUEST)
        try:
            payload = self._device.poll_device_grant(
                client_id=request.client_id,
                device_code=request.device_code,
                poll_ip=request.poll_ip,
            )
        except OAuthDeviceError as error:
            code = _DEVICE_ERROR_TO_TOKEN_ERROR.get(type(error))
            if code is None:
                raise
            raise TokenEndpointError(code) from error
        return TokenGrantResult(payload=payload)


def _active_account(accounts: OAuthDeviceAccountQuery, account_id: str) -> AccountSnapshot:
    account = accounts.get(account_id)
    if account is None:
        raise TokenEndpointError(TokenErrorCode.INVALID_GRANT)
    if account.status != AccountStatus.ACTIVE:
        raise TokenEndpointError(TokenErrorCode.INVALID_GRANT)
    return account


@dataclass(frozen=True)
class _BrowserLoginMinter:
    """Mints the access token, with a refresh token when asked, for the authorization-code and refresh grants."""

    workspaces: DeviceWorkspaceQuery
    tokens: OAuthDeviceTokenIssuer
    settings: OAuthTokenSettings

    def mint(
        self,
        account: AccountSnapshot,
        *,
        workspace_id: str,
        client_id: str,
        device_label: str,
        refresh: RefreshTokenIssue | None,
    ) -> TokenGrantResult:
        workspaces = tuple(self.workspaces.list_for_device_flow(account.id))
        mint = self.tokens.issue_account_token(
            account=account,
            workspace_id=workspace_id,
            client_id=client_id,
            device_label=device_label,
            lifetime=self.settings.auth_code_access_token_lifetime,
            refresh=refresh,
        )
        return TokenGrantResult(
            payload=build_account_poll_payload(account, workspace_id, workspaces, mint),
            refresh_token=mint.refresh_token,
        )


class AuthorizationCodeGrantHandler:
    """Client authentication runs first, so a request that fails it never burns the code."""

    def __init__(
        self,
        *,
        clients: OAuthClientRegistry,
        codes: RedisAuthorizationCodeRepository,
        accounts: OAuthDeviceAccountQuery,
        workspaces: DeviceWorkspaceQuery,
        tokens: OAuthDeviceTokenIssuer,
        settings: OAuthTokenSettings,
    ) -> None:
        self._clients = clients
        self._codes = codes
        self._accounts = accounts
        self._settings = settings
        self._minter = _BrowserLoginMinter(workspaces=workspaces, tokens=tokens, settings=settings)

    def __call__(self, request: TokenRequest) -> TokenGrantResult:
        client = authenticate_client(
            self._clients,
            client_id=request.client_id,
            client_secret=request.client_secret,
            source_ip=request.poll_ip,
        )
        if GrantType.AUTHORIZATION_CODE not in client.grant_types:
            raise TokenEndpointError(TokenErrorCode.UNAUTHORIZED_CLIENT)
        record = self._redeem(client, request)

        account = _active_account(self._accounts, record.account_id)
        # A client not registered for the refresh grant could never spend one.
        refresh = (
            RefreshTokenIssue(lifetime=self._settings.refresh_token_lifetime)
            if GrantType.REFRESH_TOKEN in client.grant_types
            else None
        )
        return self._minter.mint(
            account,
            workspace_id=record.workspace_id,
            client_id=client.storage_client_id,
            device_label=default_device_label(client.display_name),
            refresh=refresh,
        )

    def _redeem(self, client: ResolvedClient, request: TokenRequest) -> AuthorizationCodeRecord:
        if not request.code:
            raise TokenEndpointError(TokenErrorCode.INVALID_GRANT)
        record = self._codes.consume(request.code)
        if record is None:
            raise TokenEndpointError(TokenErrorCode.INVALID_GRANT)
        if record.client_id != client.client_id:
            raise TokenEndpointError(TokenErrorCode.INVALID_GRANT)
        if request.redirect_uri != record.redirect_uri:
            raise TokenEndpointError(TokenErrorCode.INVALID_GRANT)
        try:
            resource = resolve_resource(request.resource, issuer=openapi_issuer_url(request.request_origin))
        except InvalidResourceError:
            raise TokenEndpointError(TokenErrorCode.INVALID_TARGET) from None
        if resource != record.resource:
            raise TokenEndpointError(TokenErrorCode.INVALID_GRANT)
        if request.code_verifier is None:
            raise TokenEndpointError(TokenErrorCode.INVALID_GRANT)
        if not verify_pkce(request.code_verifier, record.code_challenge):
            raise TokenEndpointError(TokenErrorCode.INVALID_GRANT)
        return record


class RefreshTokenGrantHandler:
    """Rotates a refresh token, with a replay grace for a lost response or two refreshes racing.

    The token is read without a lock to find its grant; ``rotate_token`` then
    re-checks and spends it under the account lock, the same lock revocation
    and the session cap take, so a revoked grant never comes back.
    """

    def __init__(
        self,
        *,
        clients: OAuthClientRegistry,
        refresh: SQLAlchemyOAuthRefreshTokenRepository,
        accounts: OAuthDeviceAccountQuery,
        workspaces: DeviceWorkspaceQuery,
        tokens: OAuthDeviceTokenIssuer,
        revoke: GrantRevoker,
        settings: OAuthTokenSettings,
    ) -> None:
        self._clients = clients
        self._refresh = refresh
        self._accounts = accounts
        self._revoke = revoke
        self._settings = settings
        self._minter = _BrowserLoginMinter(workspaces=workspaces, tokens=tokens, settings=settings)

    def __call__(self, request: TokenRequest) -> TokenGrantResult:
        client = authenticate_client(
            self._clients,
            client_id=request.client_id,
            client_secret=request.client_secret,
            source_ip=request.poll_ip,
        )
        if GrantType.REFRESH_TOKEN not in client.grant_types:
            raise TokenEndpointError(TokenErrorCode.UNAUTHORIZED_CLIENT)
        record = self._find(client, request)
        account = _active_account(self._accounts, record.account_id)
        # The access token is keyed by the account's current email; a changed one names another grant.
        # Such a grant, like one without a workspace, can never refresh again, so it frees its session slot.
        if account.email != record.subject_email:
            self._end_dead_grant(record)
        if record.workspace_id is None:
            self._end_dead_grant(record)

        presented = PresentedRefreshToken(
            id=record.id,
            family_id=record.family_id,
            reuse_grace=self._settings.refresh_reuse_grace,
        )
        try:
            return self._minter.mint(
                account,
                workspace_id=record.workspace_id,
                client_id=record.client_id,
                device_label=record.device_label,
                refresh=RefreshTokenIssue(lifetime=self._settings.refresh_token_lifetime, presented=presented),
            )
        except RefreshTokenReusedError:
            self._revoke.revoke_grant(record.grant_key)
            raise TokenEndpointError(TokenErrorCode.INVALID_GRANT) from None
        except RefreshTokenRejectedError:
            raise TokenEndpointError(TokenErrorCode.INVALID_GRANT) from None

    def _end_dead_grant(self, record: RefreshTokenRecord) -> NoReturn:
        self._revoke.revoke_grant(record.grant_key)
        raise TokenEndpointError(TokenErrorCode.INVALID_GRANT)

    def _find(self, client: ResolvedClient, request: TokenRequest) -> RefreshTokenRecord:
        if not request.refresh_token:
            raise TokenEndpointError(TokenErrorCode.INVALID_GRANT)
        record = self._refresh.find(request.refresh_token)
        if record is None:
            raise TokenEndpointError(TokenErrorCode.INVALID_GRANT)
        if record.client_id != client.storage_client_id:
            raise TokenEndpointError(TokenErrorCode.INVALID_GRANT)
        return record


def build_grant_handlers(
    *,
    device: DeviceGrantPoller,
    clients: OAuthClientRegistry,
    codes: RedisAuthorizationCodeRepository,
    refresh: SQLAlchemyOAuthRefreshTokenRepository,
    accounts: OAuthDeviceAccountQuery,
    workspaces: DeviceWorkspaceQuery,
    tokens: OAuthDeviceTokenIssuer,
    revoke: GrantRevoker,
    settings: OAuthTokenSettings,
) -> Mapping[GrantType, GrantHandler]:
    handlers: dict[GrantType, GrantHandler] = {GrantType.DEVICE_CODE: DeviceCodeGrantHandler(device)}
    if settings.authorization_code_enabled:
        handlers[GrantType.AUTHORIZATION_CODE] = AuthorizationCodeGrantHandler(
            clients=clients,
            codes=codes,
            accounts=accounts,
            workspaces=workspaces,
            tokens=tokens,
            settings=settings,
        )
        handlers[GrantType.REFRESH_TOKEN] = RefreshTokenGrantHandler(
            clients=clients,
            refresh=refresh,
            accounts=accounts,
            workspaces=workspaces,
            tokens=tokens,
            revoke=revoke,
            settings=settings,
        )
    return handlers
