import pytest
from pydantic import ValidationError

from api.core.tools.entities.common_entities import I18nObject
from api.core.tools.entities.tool_entities import ToolProviderCredentials, ToolCredentialsOption

def test_tool_provider_credentials_creation():
    """Test the successful creation of a ToolProviderCredentials instance."""
    label = I18nObject(en_US="Test Label")
    credentials = ToolProviderCredentials(
        name="api_key",
        type=ToolProviderCredentials.CredentialsType.SECRET_INPUT,
        required=True,
        default="defaultKey",
        label=label,
        help=None,
        url="http://example.com",
        placeholder=None
    )

    assert credentials.name == "api_key"
    assert credentials.type == ToolProviderCredentials.CredentialsType.SECRET_INPUT
    assert credentials.required is True
    assert credentials.default == "defaultKey"
    assert credentials.label == label
    assert credentials.url == "http://example.com"

def test_credentials_type_value_of():
    """Test the value_of method for valid and invalid inputs."""
    assert ToolProviderCredentials.CredentialsType.value_of("secret-input") == ToolProviderCredentials.CredentialsType.SECRET_INPUT

    with pytest.raises(ValueError) as exc_info:
        ToolProviderCredentials.CredentialsType.value_of("invalid-type")
    assert "Invalid credentials type" in str(exc_info.value)

def test_tool_provider_credentials_to_dict():
    """Test the to_dict method for correct serialization."""
    label = I18nObject(en_US="Test Label")
    credentials = ToolProviderCredentials(
        name="api_key",
        type=ToolProviderCredentials.CredentialsType.TEXT_INPUT,
        required=False,
        default="defaultValue",
        label=label,
        url="http://example.com",
    )

    expected_dict = {
        'name': "api_key",
        'type': "text-input",
        'required': False,
        'default': "defaultValue",
        'options': None,
        'label': label.to_dict(),
        'help': None,
        'url': "http://example.com",
        'placeholder': None,
    }

    assert credentials.to_dict() == expected_dict

def test_tool_provider_credentials_validation():
    """Test validation for required fields and custom validators."""
    # Test missing required name field
    with pytest.raises(ValidationError) as exc_info:
        ToolProviderCredentials(type=ToolProviderCredentials.CredentialsType.TEXT_INPUT)
    assert 'field required' in str(exc_info.value)

    # Placeholder for testing the URL validator with invalid URL
    # with pytest.raises(ValidationError) as exc_info:
    #     ToolProviderCredentials(name="api_key", type=ToolProviderCredentials.CredentialsType.TEXT_INPUT, url="invalid-url")
    # assert 'invalid URL format' in str(exc_info.value)

# Add more tests as needed to cover edge cases, other field validations, and error conditions.
