from collections.abc import Callable

import pytest

from services.oauth_metadata import (
    authorization_server_metadata,
    protected_resource_metadata,
    protected_resource_metadata_url,
)

ORIGIN = "https://req.example.com"
ConfigOverrides = Callable[..., None]


@pytest.fixture(autouse=True)
def _defaults(config_overrides: ConfigOverrides) -> None:
    config_overrides(
        CONSOLE_API_URL=None,
        CONSOLE_WEB_URL=None,
        ENABLE_OAUTH_BEARER=True,
        ENABLE_OAUTH_AUTHORIZATION_CODE=True,
        ENABLE_OAUTH_DCR=True,
        ENABLE_OAUTH_CIMD=True,
    )


def test_authorization_server_document_full() -> None:
    assert authorization_server_metadata(ORIGIN) == {
        "issuer": "https://req.example.com/openapi/v1",
        "authorization_endpoint": "https://req.example.com/account/oauth/authorize",
        "token_endpoint": "https://req.example.com/openapi/v1/oauth/token",
        "revocation_endpoint": "https://req.example.com/openapi/v1/oauth/revoke",
        "device_authorization_endpoint": "https://req.example.com/openapi/v1/oauth/device/code",
        "registration_endpoint": "https://req.example.com/openapi/v1/oauth/register",
        "grant_types_supported": [
            "authorization_code",
            "refresh_token",
            "urn:ietf:params:oauth:grant-type:device_code",
        ],
        "response_types_supported": ["code"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none", "client_secret_basic", "client_secret_post"],
        "revocation_endpoint_auth_methods_supported": ["none", "client_secret_basic", "client_secret_post"],
        "client_id_metadata_document_supported": True,
        "authorization_response_iss_parameter_supported": True,
    }


def test_configured_urls_win_and_trailing_slashes_are_dropped(config_overrides: ConfigOverrides) -> None:
    config_overrides(CONSOLE_API_URL="https://api.example.com/", CONSOLE_WEB_URL="https://web.example.com/")
    doc = authorization_server_metadata(ORIGIN)
    assert doc["issuer"] == "https://api.example.com/openapi/v1"
    assert doc["token_endpoint"] == "https://api.example.com/openapi/v1/oauth/token"
    assert doc["authorization_endpoint"] == "https://web.example.com/account/oauth/authorize"
    assert protected_resource_metadata_url(ORIGIN) == (
        "https://api.example.com/.well-known/oauth-protected-resource/openapi/v1"
    )


def test_request_origin_trailing_slash_is_dropped() -> None:
    doc = authorization_server_metadata(ORIGIN + "/")
    assert doc["authorization_endpoint"] == "https://req.example.com/account/oauth/authorize"
    assert doc["issuer"] == "https://req.example.com/openapi/v1"


def test_dcr_off_drops_registration_endpoint(config_overrides: ConfigOverrides) -> None:
    config_overrides(ENABLE_OAUTH_DCR=False)
    assert "registration_endpoint" not in authorization_server_metadata(ORIGIN)


def test_cimd_off_is_false(config_overrides: ConfigOverrides) -> None:
    config_overrides(ENABLE_OAUTH_CIMD=False)
    assert authorization_server_metadata(ORIGIN)["client_id_metadata_document_supported"] is False


def test_authorization_code_off_gives_the_reduced_document(config_overrides: ConfigOverrides) -> None:
    config_overrides(ENABLE_OAUTH_AUTHORIZATION_CODE=False)
    doc = authorization_server_metadata(ORIGIN)
    assert "authorization_endpoint" not in doc
    assert "registration_endpoint" not in doc
    assert doc["grant_types_supported"] == ["urn:ietf:params:oauth:grant-type:device_code"]
    assert doc["client_id_metadata_document_supported"] is False
    assert doc["device_authorization_endpoint"] == "https://req.example.com/openapi/v1/oauth/device/code"
    # RFC 8414 requires response_types_supported even with no authorization endpoint; none are supported then.
    assert doc["response_types_supported"] == []
    assert "authorization_response_iss_parameter_supported" not in doc


def test_protected_resource_document() -> None:
    assert protected_resource_metadata(ORIGIN) == {
        "resource": "https://req.example.com/openapi/v1",
        "authorization_servers": ["https://req.example.com/openapi/v1"],
        "bearer_methods_supported": ["header"],
    }


def test_protected_resource_metadata_url() -> None:
    assert protected_resource_metadata_url(ORIGIN + "/") == (
        "https://req.example.com/.well-known/oauth-protected-resource/openapi/v1"
    )
