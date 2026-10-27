"""Dynamic client registration (RFC 7591) for the /openapi/v1 OAuth server."""

import secrets
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from enums.oauth_client import OAuthClientKind, TokenEndpointAuthMethod
from libs.oauth_bearer import sha256_hex
from models.oauth import OpenAPIOAuthClient
from services.oauth_redirect import is_valid_logo_uri, is_valid_redirect_uri, redirect_host
from services.oauth_token_contracts import GrantType

MAX_REDIRECT_URIS = 10
MAX_REDIRECT_URI_LENGTH = 2048
MAX_CLIENT_NAME_LENGTH = 255
MAX_REDIRECT_HOST_LENGTH = 253
MAX_LOGO_URI_LENGTH = 1024
CLIENT_ID_PREFIX = "dcr_"
CLIENT_ID_BYTES = 16
CLIENT_SECRET_BYTES = 32
CODE_RESPONSE_TYPE = "code"
DEFAULT_GRANT_TYPES = (GrantType.AUTHORIZATION_CODE, GrantType.REFRESH_TOKEN)


class RegistrationErrorCode(StrEnum):
    INVALID_REDIRECT_URI = "invalid_redirect_uri"
    INVALID_CLIENT_METADATA = "invalid_client_metadata"


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
    ) -> OpenAPIOAuthClient: ...


def _invalid_metadata(description: str) -> RegistrationError:
    return RegistrationError(RegistrationErrorCode.INVALID_CLIENT_METADATA, description)


def _invalid_redirect_uri() -> RegistrationError:
    return RegistrationError(RegistrationErrorCode.INVALID_REDIRECT_URI, "redirect_uris holds an invalid URI")


def optional_string(metadata: Mapping[str, object], field: str, *, max_length: int) -> str | None:
    value = metadata.get(field)
    if value is None:
        return None
    if not isinstance(value, str):
        raise _invalid_metadata(f"{field} must be a string")
    if len(value) > max_length:
        raise _invalid_metadata(f"{field} is too long")
    return value


def string_list(metadata: Mapping[str, object], field: str, *, error: RegistrationErrorCode) -> list[str] | None:
    value = metadata.get(field)
    if value is None:
        return None
    if not isinstance(value, list):
        raise RegistrationError(error, f"{field} must be an array of strings")
    if not all(isinstance(item, str) for item in value):
        raise RegistrationError(error, f"{field} must be an array of strings")
    return value


def validated_redirect_uris(metadata: Mapping[str, object]) -> tuple[str, ...]:
    uris = string_list(metadata, "redirect_uris", error=RegistrationErrorCode.INVALID_REDIRECT_URI)
    if not uris:
        raise RegistrationError(RegistrationErrorCode.INVALID_REDIRECT_URI, "redirect_uris is required")
    if len(uris) > MAX_REDIRECT_URIS:
        raise RegistrationError(RegistrationErrorCode.INVALID_REDIRECT_URI, "too many redirect_uris")
    for uri in uris:
        if len(uri) > MAX_REDIRECT_URI_LENGTH:
            raise _invalid_redirect_uri()
        if not is_valid_redirect_uri(uri):
            raise _invalid_redirect_uri()
        if len(redirect_host(uri)) > MAX_REDIRECT_HOST_LENGTH:
            raise _invalid_redirect_uri()
    return tuple(uris)


def _grant_types(metadata: Mapping[str, object]) -> tuple[GrantType, ...]:
    values = string_list(metadata, "grant_types", error=RegistrationErrorCode.INVALID_CLIENT_METADATA)
    if values is None:
        return DEFAULT_GRANT_TYPES
    allowed = {grant.value: grant for grant in DEFAULT_GRANT_TYPES}
    if not all(value in allowed for value in values):
        raise _invalid_metadata("grant_types holds an unsupported grant")
    grants = tuple(dict.fromkeys(allowed[value] for value in values))
    if GrantType.AUTHORIZATION_CODE not in grants:
        raise _invalid_metadata("grant_types must include authorization_code")
    return grants


def _check_response_types(metadata: Mapping[str, object]) -> None:
    values = string_list(metadata, "response_types", error=RegistrationErrorCode.INVALID_CLIENT_METADATA)
    if values is None:
        return
    if values != [CODE_RESPONSE_TYPE]:
        raise _invalid_metadata("response_types must be [code]")


def _auth_method(metadata: Mapping[str, object]) -> TokenEndpointAuthMethod:
    value = metadata.get("token_endpoint_auth_method")
    if value is None:
        return TokenEndpointAuthMethod.NONE
    try:
        return TokenEndpointAuthMethod(value)
    except ValueError:
        raise _invalid_metadata("token_endpoint_auth_method is not supported") from None


def validated_logo_uri(metadata: Mapping[str, object]) -> str | None:
    logo_uri = optional_string(metadata, "logo_uri", max_length=MAX_LOGO_URI_LENGTH)
    if logo_uri is None:
        return None
    if not is_valid_logo_uri(logo_uri):
        raise _invalid_metadata("logo_uri must be an https URL")
    return logo_uri


class OAuthClientRegistrationService:
    def __init__(self, *, clients: ClientCreator) -> None:
        self._clients = clients

    def register(self, metadata: Mapping[str, object]) -> RegisteredClient:
        redirect_uris = validated_redirect_uris(metadata)
        client_name = optional_string(metadata, "client_name", max_length=MAX_CLIENT_NAME_LENGTH)
        logo_uri = validated_logo_uri(metadata)
        grant_types = _grant_types(metadata)
        _check_response_types(metadata)
        auth_method = _auth_method(metadata)

        display_name = (client_name or "").strip() or redirect_host(redirect_uris[0])
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
