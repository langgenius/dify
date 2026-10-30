"""Consent-page use cases for the authorization-code flow of ``/openapi/v1``.

The client and its ``redirect_uri`` are verified before anything that could
produce a URL, so an unverified request never yields a redirect. Once they
are verified, other errors go back to the client by redirect (RFC 6749 §4.1.2.1).
"""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import timedelta
from enum import StrEnum
from typing import Final
from urllib.parse import urlencode, urlsplit, urlunsplit

from constants.oauth_bearer import OAuthScope
from machinery.context import RequestContext
from repositories.oauth_authorization_code_repository import AuthorizationCodeRecord, RedisAuthorizationCodeRepository
from services.oauth_clients import OAuthClientRegistry, ResolvedClient
from services.oauth_pkce import PkceMethod, is_valid_challenge
from services.oauth_redirect import is_loopback_only, is_valid_redirect_uri, redirect_host, redirect_uri_allowed
from services.oauth_resource import InvalidResourceError, resolve_resource
from services.oauth_token_contracts import GrantType

# The longest lifetime RFC 6749 §4.1.2 recommends.
AUTHORIZATION_CODE_TTL: Final = timedelta(minutes=10)


class AuthorizeErrorCode(StrEnum):
    INVALID_CLIENT = "invalid_client"
    INVALID_REDIRECT_URI = "invalid_redirect_uri"
    INVALID_REQUEST = "invalid_request"


class RedirectErrorCode(StrEnum):
    """Errors sent back to the client on its redirect (RFC 6749 §4.1.2.1, RFC 8707)."""

    INVALID_REQUEST = "invalid_request"
    ACCESS_DENIED = "access_denied"
    INVALID_TARGET = "invalid_target"
    INVALID_SCOPE = "invalid_scope"


class AuthorizeRequestError(Exception):
    def __init__(self, code: AuthorizeErrorCode) -> None:
        super().__init__(code.value)
        self.code = code


class RedirectParam(StrEnum):
    CODE = "code"
    ERROR = "error"
    STATE = "state"
    ISS = "iss"


@dataclass(frozen=True)
class ConsentClientView:
    client_id: str
    display_name: str
    logo_uri: str | None
    redirect_host: str
    localhost_only: bool
    scopes: tuple[OAuthScope, ...]


@dataclass(frozen=True)
class AuthorizeRequest:
    client_id: str
    redirect_uri: str
    code_challenge: str
    code_challenge_method: str
    resource: str | None
    scope: str | None
    state: str | None


def _has_valid_pkce(request: AuthorizeRequest) -> bool:
    try:
        PkceMethod(request.code_challenge_method)
    except ValueError:
        return False
    return is_valid_challenge(request.code_challenge)


def _redirect_with(redirect_uri: str, params: Mapping[RedirectParam, str]) -> str:
    """Append ``params`` to the registered URI, keeping its own query text unchanged."""
    parts = urlsplit(redirect_uri)
    added = urlencode({str(name): value for name, value in params.items()})
    query = f"{parts.query}&{added}" if parts.query else added
    return urlunsplit(parts._replace(query=query))


class OAuthAuthorizeService:
    def __init__(
        self,
        *,
        clients: OAuthClientRegistry,
        codes: RedisAuthorizationCodeRepository,
    ) -> None:
        self._clients = clients
        self._codes = codes

    def describe_client(self, client_id: str, redirect_uri: str, scope: str | None) -> ConsentClientView:
        """The page shows what approve would grant, so a scope approve would refuse is a bad request here."""
        client = self._verified_client(client_id, redirect_uri)
        try:
            scopes = OAuthScope.parse(scope)
        except ValueError:
            raise AuthorizeRequestError(AuthorizeErrorCode.INVALID_REQUEST) from None
        return ConsentClientView(
            client_id=client.client_id,
            display_name=client.display_name,
            logo_uri=client.logo_uri,
            redirect_host=redirect_host(redirect_uri),
            localhost_only=is_loopback_only(client.redirect_uris),
            scopes=OAuthScope.ordered(scopes),
        )

    def approve(self, context: RequestContext, request: AuthorizeRequest, *, issuer: str) -> str:
        client = self._verified_client(request.client_id, request.redirect_uri)
        if not _has_valid_pkce(request):
            return self._client_error(request, issuer=issuer, error=RedirectErrorCode.INVALID_REQUEST)
        try:
            resource = resolve_resource(request.resource, issuer=issuer)
        except InvalidResourceError:
            return self._client_error(request, issuer=issuer, error=RedirectErrorCode.INVALID_TARGET)
        try:
            scopes = OAuthScope.parse(request.scope)
        except ValueError:
            return self._client_error(request, issuer=issuer, error=RedirectErrorCode.INVALID_SCOPE)

        code = self._codes.save(
            AuthorizationCodeRecord(
                client_id=client.client_id,
                redirect_uri=request.redirect_uri,
                code_challenge=request.code_challenge,
                resource=resource,
                scopes=scopes,
                account_id=context.account_id,
                workspace_id=context.active_workspace_id,
            ),
            ttl=AUTHORIZATION_CODE_TTL,
        )
        return self._client_redirect(request, issuer=issuer, outcome={RedirectParam.CODE: code})

    def deny(self, request: AuthorizeRequest, *, issuer: str) -> str:
        self._verified_client(request.client_id, request.redirect_uri)
        return self._client_error(request, issuer=issuer, error=RedirectErrorCode.ACCESS_DENIED)

    def _verified_client(self, client_id: str, redirect_uri: str) -> ResolvedClient:
        client = self._clients.resolve(client_id)
        if client is None:
            raise AuthorizeRequestError(AuthorizeErrorCode.INVALID_CLIENT)
        if GrantType.AUTHORIZATION_CODE not in client.grant_types:
            raise AuthorizeRequestError(AuthorizeErrorCode.INVALID_CLIENT)
        if not is_valid_redirect_uri(redirect_uri):
            raise AuthorizeRequestError(AuthorizeErrorCode.INVALID_REDIRECT_URI)
        if not redirect_uri_allowed(redirect_uri, client.redirect_uris):
            raise AuthorizeRequestError(AuthorizeErrorCode.INVALID_REDIRECT_URI)
        return client

    @classmethod
    def _client_error(cls, request: AuthorizeRequest, *, issuer: str, error: RedirectErrorCode) -> str:
        return cls._client_redirect(request, issuer=issuer, outcome={RedirectParam.ERROR: error})

    @staticmethod
    def _client_redirect(request: AuthorizeRequest, *, issuer: str, outcome: Mapping[RedirectParam, str]) -> str:
        params = dict(outcome)
        if request.state is not None:
            params[RedirectParam.STATE] = request.state
        params[RedirectParam.ISS] = issuer
        return _redirect_with(request.redirect_uri, params)
