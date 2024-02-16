import pytest
from core.tools.entities.tool_entities import ApiProviderAuthType, ToolProviderCredentials
from core.tools.provider.api_tool_provider import ApiBasedToolProviderController

# Mocking the database provider object
class MockApiToolProvider:
    user_id = 1
    user = type('User', (object,), {'name': 'TestUser'})
    name = "TestApiProvider"
    description = "Test API Provider Description"
    icon = "TestIcon"

@pytest.mark.parametrize("auth_type, expected_fields", [
    (ApiProviderAuthType.NONE, ['auth_type']),
    (ApiProviderAuthType.API_KEY, ['auth_type', 'api_key_header', 'api_key_value']),
    (ApiProviderAuthType.OAUTH, ['auth_type', 'client_id', 'client_secret', 'authorization_url', 'token_url']),
])
def test_from_db_with_different_auth_types(auth_type, expected_fields):
    db_provider = MockApiToolProvider()
    controller = ApiBasedToolProviderController.from_db(db_provider, auth_type)

    # Verify that the credentials schema contains the expected fields for each auth type
    credentials_schema = controller.credentials_schema
    assert all(key in credentials_schema for key in expected_fields), f"Not all expected fields are present for auth type {auth_type}"

@pytest.mark.parametrize("auth_type", [
    (ApiProviderAuthType.OAUTH),
])
def test_oauth_credentials_schema(auth_type):
    db_provider = MockApiToolProvider()
    controller = ApiBasedToolProviderController.from_db(db_provider, auth_type)

    # Specific checks for OAuth credentials schema
    oauth_schema = controller.credentials_schema
    assert oauth_schema['client_id'].type == ToolProviderCredentials.CredentialsType.TEXT_INPUT
    assert oauth_schema['client_secret'].type == ToolProviderCredentials.CredentialsType.SECRET_INPUT
    assert oauth_schema['authorization_url'].required == True
    assert oauth_schema['token_url'].required == True
    # Add more detailed checks as needed, depending on the specifics of your OAuth implementation

def test_invalid_auth_type_raises_error():
    db_provider = MockApiToolProvider()
    with pytest.raises(ValueError):
        # Assuming 'INVALID_TYPE' is not a valid ApiProviderAuthType
        ApiBasedToolProviderController.from_db(db_provider, 'INVALID_TYPE')
