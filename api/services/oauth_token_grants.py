"""Grant handlers registered into ``OAuthTokenService``."""

from collections.abc import Mapping
from typing import Protocol

from repositories.oauth_authorization_code_repository import AuthorizationCodeRecord, RedisAuthorizationCodeRepository
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
    default_device_label,
)
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
        self._workspaces = workspaces
        self._tokens = tokens
        self._settings = settings

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

        account = self._accounts.get(record.account_id)
        if account is None:
            raise TokenEndpointError(TokenErrorCode.INVALID_GRANT)
        workspaces = tuple(self._workspaces.list_for_device_flow(account.id))
        mint = self._tokens.issue_account_token(
            account=account,
            workspace_id=record.workspace_id,
            client_id=client.storage_client_id,
            device_label=default_device_label(client.display_name),
            lifetime=self._settings.auth_code_access_token_lifetime,
        )
        return TokenGrantResult(payload=build_account_poll_payload(account, record.workspace_id, workspaces, mint))

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


def build_grant_handlers(
    *,
    device: DeviceGrantPoller,
    clients: OAuthClientRegistry,
    codes: RedisAuthorizationCodeRepository,
    accounts: OAuthDeviceAccountQuery,
    workspaces: DeviceWorkspaceQuery,
    tokens: OAuthDeviceTokenIssuer,
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
    return handlers
