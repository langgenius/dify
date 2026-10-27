"""Client metadata checks shared by dynamic registration (RFC 7591) and metadata documents (CIMD)."""

from collections.abc import Iterable, Mapping, Sequence
from enum import StrEnum

from services.oauth_redirect import is_valid_logo_uri, is_valid_redirect_uri, redirect_host
from services.oauth_token_contracts import GrantType

MAX_REDIRECT_URIS = 10
MAX_REDIRECT_URI_LENGTH = 2048
MAX_CLIENT_NAME_LENGTH = 255
MAX_REDIRECT_HOST_LENGTH = 253
MAX_LOGO_URI_LENGTH = 1024
DEFAULT_GRANT_TYPES = (GrantType.AUTHORIZATION_CODE, GrantType.REFRESH_TOKEN)
CODE_RESPONSE_TYPE = "code"


class RegistrationErrorCode(StrEnum):
    """RFC 7591 client registration error codes."""

    INVALID_REDIRECT_URI = "invalid_redirect_uri"
    INVALID_CLIENT_METADATA = "invalid_client_metadata"


class InvalidClientMetadataError(Exception):
    def __init__(self, code: RegistrationErrorCode, description: str) -> None:
        super().__init__(description)
        self.code = code
        self.description = description


def invalid_metadata(description: str) -> InvalidClientMetadataError:
    return InvalidClientMetadataError(RegistrationErrorCode.INVALID_CLIENT_METADATA, description)


def _invalid_redirect_uri(description: str = "redirect_uris holds an invalid URI") -> InvalidClientMetadataError:
    return InvalidClientMetadataError(RegistrationErrorCode.INVALID_REDIRECT_URI, description)


def optional_string(metadata: Mapping[str, object], field: str, *, max_length: int) -> str | None:
    value = metadata.get(field)
    if value is None:
        return None
    if not isinstance(value, str):
        raise invalid_metadata(f"{field} must be a string")
    if len(value) > max_length:
        raise invalid_metadata(f"{field} is too long")
    return value


def string_list(metadata: Mapping[str, object], field: str, *, code: RegistrationErrorCode) -> list[str] | None:
    value = metadata.get(field)
    if value is None:
        return None
    if not isinstance(value, list):
        raise InvalidClientMetadataError(code, f"{field} must be an array of strings")
    if not all(isinstance(item, str) for item in value):
        raise InvalidClientMetadataError(code, f"{field} must be an array of strings")
    return value


def known_grant_types(
    values: Iterable[str], *, allowed: Iterable[GrantType] = DEFAULT_GRANT_TYPES
) -> tuple[GrantType, ...]:
    """The allowed grants named in ``values``, in order and without repeats; any other value is dropped."""
    by_value = {grant.value: grant for grant in allowed}
    return tuple(dict.fromkeys(by_value[value] for value in values if value in by_value))


def supported_grant_types(values: Sequence[str]) -> tuple[GrantType, ...]:
    """Like ``known_grant_types``, but a value that is not a registrable grant is invalid metadata."""
    grants = known_grant_types(values)
    if len(grants) < len(set(values)):
        raise invalid_metadata("grant_types holds an unsupported grant")
    return grants


def client_display_name(client_name: str | None, *, fallback: str) -> str:
    return (client_name or "").strip() or fallback


def validated_redirect_uris(metadata: Mapping[str, object]) -> tuple[str, ...]:
    uris = string_list(metadata, "redirect_uris", code=RegistrationErrorCode.INVALID_REDIRECT_URI)
    if not uris:
        raise _invalid_redirect_uri("redirect_uris is required")
    if len(uris) > MAX_REDIRECT_URIS:
        raise _invalid_redirect_uri("too many redirect_uris")
    for uri in uris:
        if len(uri) > MAX_REDIRECT_URI_LENGTH:
            raise _invalid_redirect_uri()
        if not is_valid_redirect_uri(uri):
            raise _invalid_redirect_uri()
        if len(redirect_host(uri)) > MAX_REDIRECT_HOST_LENGTH:
            raise _invalid_redirect_uri()
    return tuple(uris)


def validated_logo_uri(metadata: Mapping[str, object]) -> str | None:
    logo_uri = optional_string(metadata, "logo_uri", max_length=MAX_LOGO_URI_LENGTH)
    if logo_uri is None:
        return None
    if not is_valid_logo_uri(logo_uri):
        raise invalid_metadata("logo_uri must be an https URL")
    return logo_uri
