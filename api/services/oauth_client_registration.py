"""Dynamic client registration (RFC 7591) for the /openapi/v1 OAuth server."""

import secrets
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Protocol

from enums.oauth_client import OAuthClientKind, TokenEndpointAuthMethod
from libs.oauth_bearer import sha256_hex
from services.oauth_client_metadata import (
    CODE_RESPONSE_TYPE,
    DEFAULT_GRANT_TYPES,
    MAX_CLIENT_NAME_LENGTH,
    InvalidClientMetadataError,
    RegistrationErrorCode,
    client_display_name,
    invalid_metadata,
    optional_string,
    string_list,
    supported_grant_types,
    validated_logo_uri,
    validated_redirect_uris,
)
from services.oauth_redirect import redirect_host
from services.oauth_token_contracts import GrantType

CLIENT_ID_PREFIX = "dcr_"
CLIENT_ID_BYTES = 16
CLIENT_SECRET_BYTES = 32


class RegistrationError(Exception):
    def __init__(self, code: RegistrationErrorCode, description: str) -> None:
        super().__init__(description)
        self.code = code
        self.description = description


@dataclass(frozen=True)
class RegisteredClient:
    client_id: str
    client_secret: str | None
    client_id_issued_at: int
    client_name: str
    redirect_uris: tuple[str, ...]
    grant_types: tuple[GrantType, ...]
    token_endpoint_auth_method: TokenEndpointAuthMethod
    logo_uri: str | None


class ClientCreator(Protocol):
    def create(
        self,
        *,
        client_id: str,
        kind: OAuthClientKind,
        display_name: str,
        redirect_uris: Sequence[str],
        grant_types: Sequence[GrantType],
        client_secret_hash: str | None = None,
        logo_uri: str | None = None,
    ) -> None: ...


def _grant_types(metadata: Mapping[str, object]) -> tuple[GrantType, ...]:
    values = string_list(metadata, "grant_types", code=RegistrationErrorCode.INVALID_CLIENT_METADATA)
    if values is None:
        return DEFAULT_GRANT_TYPES
    grants = supported_grant_types(values)
    if GrantType.AUTHORIZATION_CODE not in grants:
        raise invalid_metadata("grant_types must include authorization_code")
    return grants


def _check_response_types(metadata: Mapping[str, object]) -> None:
    values = string_list(metadata, "response_types", code=RegistrationErrorCode.INVALID_CLIENT_METADATA)
    if values is None:
        return
    if values != [CODE_RESPONSE_TYPE]:
        raise invalid_metadata("response_types must be [code]")


def _auth_method(metadata: Mapping[str, object]) -> TokenEndpointAuthMethod:
    value = metadata.get("token_endpoint_auth_method")
    if value is None:
        return TokenEndpointAuthMethod.NONE
    try:
        return TokenEndpointAuthMethod(value)
    except ValueError:
        raise invalid_metadata("token_endpoint_auth_method is not supported") from None


class OAuthClientRegistrationService:
    def __init__(self, *, clients: ClientCreator) -> None:
        self._clients = clients

    def register(self, metadata: Mapping[str, object]) -> RegisteredClient:
        try:
            redirect_uris = validated_redirect_uris(metadata)
            client_name = optional_string(metadata, "client_name", max_length=MAX_CLIENT_NAME_LENGTH)
            logo_uri = validated_logo_uri(metadata)
            grant_types = _grant_types(metadata)
            _check_response_types(metadata)
            auth_method = _auth_method(metadata)
        except InvalidClientMetadataError as error:
            raise RegistrationError(error.code, error.description) from None

        display_name = client_display_name(client_name, fallback=redirect_host(redirect_uris[0]))
        client_id = CLIENT_ID_PREFIX + secrets.token_urlsafe(CLIENT_ID_BYTES)
        kind = auth_method.kind
        client_secret = secrets.token_urlsafe(CLIENT_SECRET_BYTES) if kind == OAuthClientKind.CONFIDENTIAL else None
        self._clients.create(
            client_id=client_id,
            kind=kind,
            display_name=display_name,
            redirect_uris=redirect_uris,
            grant_types=grant_types,
            client_secret_hash=None if client_secret is None else sha256_hex(client_secret),
            logo_uri=logo_uri,
        )
        return RegisteredClient(
            client_id=client_id,
            client_secret=client_secret,
            client_id_issued_at=int(time.time()),
            client_name=display_name,
            redirect_uris=redirect_uris,
            grant_types=grant_types,
            token_endpoint_auth_method=auth_method,
            logo_uri=logo_uri,
        )
