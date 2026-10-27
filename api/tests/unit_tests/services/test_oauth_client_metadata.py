import pytest

from services.oauth_client_metadata import (
    MAX_CLIENT_NAME_LENGTH,
    MAX_LOGO_URI_LENGTH,
    MAX_REDIRECT_HOST_LENGTH,
    MAX_REDIRECT_URI_LENGTH,
    MAX_REDIRECT_URIS,
    InvalidClientMetadataError,
    RegistrationErrorCode,
    client_display_name,
    known_grant_types,
    optional_string,
    string_list,
    supported_grant_types,
    validated_logo_uri,
    validated_redirect_uris,
)
from services.oauth_token_contracts import GrantType

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

    assert caught.value.code is RegistrationErrorCode.INVALID_REDIRECT_URI


def test_optional_string_accepts_absent_and_within_limit() -> None:
    assert optional_string({}, "client_name", max_length=MAX_CLIENT_NAME_LENGTH) is None
    assert optional_string({"client_name": "ok"}, "client_name", max_length=MAX_CLIENT_NAME_LENGTH) == "ok"


@pytest.mark.parametrize("value", [5, ["a"], "n" * (MAX_CLIENT_NAME_LENGTH + 1)])
def test_optional_string_rejects_wrong_type_or_length(value: object) -> None:
    with pytest.raises(InvalidClientMetadataError) as caught:
        optional_string({"client_name": value}, "client_name", max_length=MAX_CLIENT_NAME_LENGTH)

    assert caught.value.code is RegistrationErrorCode.INVALID_CLIENT_METADATA


def test_string_list_uses_the_requested_code() -> None:
    assert string_list({}, "grant_types", code=RegistrationErrorCode.INVALID_CLIENT_METADATA) is None
    with pytest.raises(InvalidClientMetadataError) as caught:
        string_list({"grant_types": [1]}, "grant_types", code=RegistrationErrorCode.INVALID_REDIRECT_URI)
    assert caught.value.code is RegistrationErrorCode.INVALID_REDIRECT_URI


def test_logo_uri_rules() -> None:
    assert validated_logo_uri({}) is None
    assert validated_logo_uri({"logo_uri": "https://agent.example/l.png"}) == "https://agent.example/l.png"
    for bad in ("http://agent.example/l.png", "https://agent.example/" + "a" * MAX_LOGO_URI_LENGTH):
        with pytest.raises(InvalidClientMetadataError):
            validated_logo_uri({"logo_uri": bad})


FUTURE_GRANT = "urn:future:grant"


def test_known_grant_types_keep_order_and_drop_repeats_and_unknown_values() -> None:
    values = ["refresh_token", FUTURE_GRANT, "authorization_code", "refresh_token", GrantType.DEVICE_CODE.value]

    assert known_grant_types(values) == (GrantType.REFRESH_TOKEN, GrantType.AUTHORIZATION_CODE)


def test_known_grant_types_read_against_a_wider_allowed_set() -> None:
    values = [GrantType.DEVICE_CODE.value, FUTURE_GRANT, "authorization_code"]

    assert known_grant_types(values, allowed=GrantType) == (GrantType.DEVICE_CODE, GrantType.AUTHORIZATION_CODE)


def test_supported_grant_types_accept_registrable_grants() -> None:
    values = ["authorization_code", "refresh_token", "authorization_code"]

    assert supported_grant_types(values) == (GrantType.AUTHORIZATION_CODE, GrantType.REFRESH_TOKEN)


@pytest.mark.parametrize("unsupported", [FUTURE_GRANT, GrantType.DEVICE_CODE.value, ""])
def test_supported_grant_types_reject_any_other_value(unsupported: str) -> None:
    with pytest.raises(InvalidClientMetadataError) as caught:
        supported_grant_types(["authorization_code", unsupported])
    assert caught.value.code is RegistrationErrorCode.INVALID_CLIENT_METADATA


@pytest.mark.parametrize(
    ("client_name", "expected"),
    [
        ("Agent", "Agent"),
        ("  Agent  ", "Agent"),
        (None, "agent.example"),
        ("", "agent.example"),
        ("   ", "agent.example"),
    ],
)
def test_client_display_name_falls_back_to_the_host(client_name: str | None, expected: str) -> None:
    assert client_display_name(client_name, fallback="agent.example") == expected
