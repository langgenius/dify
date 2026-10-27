import pytest

from services.oauth_client_metadata import (
    MAX_CLIENT_NAME_LENGTH,
    MAX_LOGO_URI_LENGTH,
    MAX_REDIRECT_HOST_LENGTH,
    MAX_REDIRECT_URI_LENGTH,
    MAX_REDIRECT_URIS,
    InvalidClientMetadataError,
    MetadataErrorKind,
    optional_string,
    string_list,
    validated_logo_uri,
    validated_redirect_uris,
)
from services.oauth_client_registration import RegistrationErrorCode

GOOD = "https://agent.example/cb"


def test_redirect_uris_are_returned_as_a_tuple() -> None:
    assert validated_redirect_uris({"redirect_uris": [GOOD, "http://127.0.0.1/cb"]}) == (GOOD, "http://127.0.0.1/cb")


@pytest.mark.parametrize(
    "value",
    [
        None,
        [],
        GOOD,
        [7],
        ["http://agent.example/cb"],
        ["javascript:alert(1)"],
        [GOOD + "x" * MAX_REDIRECT_URI_LENGTH],
        ["https://" + "a" * (MAX_REDIRECT_HOST_LENGTH + 1) + "/cb"],
        [f"https://agent.example/{i}" for i in range(MAX_REDIRECT_URIS + 1)],
    ],
)
def test_bad_redirect_uris_raise_the_redirect_kind(value: object) -> None:
    with pytest.raises(InvalidClientMetadataError) as caught:
        validated_redirect_uris({"redirect_uris": value})

    assert caught.value.kind is MetadataErrorKind.INVALID_REDIRECT_URI


def test_optional_string_accepts_absent_and_within_limit() -> None:
    assert optional_string({}, "client_name", max_length=MAX_CLIENT_NAME_LENGTH) is None
    assert optional_string({"client_name": "ok"}, "client_name", max_length=MAX_CLIENT_NAME_LENGTH) == "ok"


@pytest.mark.parametrize("value", [5, ["a"], "n" * (MAX_CLIENT_NAME_LENGTH + 1)])
def test_optional_string_rejects_wrong_type_or_length(value: object) -> None:
    with pytest.raises(InvalidClientMetadataError) as caught:
        optional_string({"client_name": value}, "client_name", max_length=MAX_CLIENT_NAME_LENGTH)

    assert caught.value.kind is MetadataErrorKind.INVALID_CLIENT_METADATA


def test_string_list_uses_the_requested_kind() -> None:
    assert string_list({}, "grant_types", kind=MetadataErrorKind.INVALID_CLIENT_METADATA) is None
    with pytest.raises(InvalidClientMetadataError) as caught:
        string_list({"grant_types": [1]}, "grant_types", kind=MetadataErrorKind.INVALID_REDIRECT_URI)
    assert caught.value.kind is MetadataErrorKind.INVALID_REDIRECT_URI


def test_logo_uri_rules() -> None:
    assert validated_logo_uri({}) is None
    assert validated_logo_uri({"logo_uri": "https://agent.example/l.png"}) == "https://agent.example/l.png"
    for bad in ("http://agent.example/l.png", "https://agent.example/" + "a" * MAX_LOGO_URI_LENGTH):
        with pytest.raises(InvalidClientMetadataError):
            validated_logo_uri({"logo_uri": bad})


@pytest.mark.parametrize("kind", list(MetadataErrorKind))
def test_every_metadata_error_kind_is_a_registration_error_code(kind: MetadataErrorKind) -> None:
    assert RegistrationErrorCode(kind.value)
