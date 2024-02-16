import pytest
from core.tools.entities.tool_entities import (ApiProviderAuthType,
                                               ToolProviderCredentials)

from api.core.tools.provider.api_tool_provider import \
    ApiBasedToolProviderController


@pytest.mark.parametrize(
    "auth_type, expected_keys",
    [
        (ApiProviderAuthType.API_KEY, ["api_key_header", "api_key_value"]),
        (
            ApiProviderAuthType.OAUTH,
            ["client_id", "client_secret", "authorization_url", "token_url"],
        ),
        (ApiProviderAuthType.NONE, ["auth_type"]),
    ],
)
def test_get_credentials_schema(auth_type, expected_keys):
    """
    Validates that the correct keys are present in the credentials schema
    for different authentication types.

    Parameters:
    - auth_type: The type of authentication (API_KEY, OAUTH, NONE) being tested.
    - expected_keys: The keys expected to be present in the schema for the given auth_type.
    """
    schema = ApiBasedToolProviderController.get_credentials_schema(auth_type)
    for key in expected_keys:
        assert (
            key in schema
        ), f"Expected {key} to be in the credentials schema for auth_type {auth_type}"


# Test for credentials schema generation for API Key authentication
def test_get_credentials_schema_api_key():
    """
    Specifically tests the credentials schema generation for API Key authentication,
    verifying the presence and types of 'api_key_header' and 'api_key_value'.
    """
    schema = ApiBasedToolProviderController.get_credentials_schema(
        ApiProviderAuthType.API_KEY
    )
    assert "api_key_header" in schema, "'api_key_header' not in schema for API Key auth"
    assert "api_key_value" in schema, "'api_key_value' not in schema for API Key auth"
    assert (
        schema["api_key_header"].type
        == ToolProviderCredentials.CredentialsType.TEXT_INPUT
    ), "'api_key_header' type mismatch for API Key auth"
    assert (
        schema["api_key_value"].type
        == ToolProviderCredentials.CredentialsType.SECRET_INPUT
    ), "'api_key_value' type mismatch for API Key auth"


# Test for credentials schema generation for OAuth authentication
def test_get_credentials_schema_oauth():
    """
    Specifically tests the credentials schema generation for OAuth authentication,
    verifying the presence and types of 'client_id', 'client_secret', 'authorization_url', and 'token_url'.
    """
    schema = ApiBasedToolProviderController.get_credentials_schema(
        ApiProviderAuthType.OAUTH
    )
    assert "client_id" in schema, "'client_id' not in schema for OAuth auth"
    assert "client_secret" in schema, "'client_secret' not in schema for OAuth auth"
    assert (
        "authorization_url" in schema
    ), "'authorization_url' not in schema for OAuth auth"
    assert "token_url" in schema, "'token_url' not in schema for OAuth auth"
    assert (
        schema["client_id"].type == ToolProviderCredentials.CredentialsType.TEXT_INPUT
    ), "'client_id' type mismatch for OAuth auth"
    assert (
        schema["client_secret"].type
        == ToolProviderCredentials.CredentialsType.SECRET_INPUT
    ), "'client_secret' type mismatch for OAuth auth"
