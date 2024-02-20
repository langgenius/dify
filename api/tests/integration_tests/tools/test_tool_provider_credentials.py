import pytest

from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import (
    ApiProviderAuthType,
    ApiProviderSchemaType,
    ToolCredentialsOption,
    ToolProviderType,
    ToolRuntimeVariablePool,
    ToolRuntimeVariableType,
)
from core.tools.provider.tool_provider import ToolProviderCredentials


@pytest.mark.parametrize("enum_class, valid_value, expected_enum", [
    (ToolProviderType, "built-in", ToolProviderType.BUILT_IN),
    (ApiProviderSchemaType, "swagger", ApiProviderSchemaType.SWAGGER),
    (ApiProviderAuthType, "oauth", ApiProviderAuthType.OAUTH),
])
def test_enum_value_of(enum_class, valid_value, expected_enum):
    assert enum_class.value_of(valid_value) == expected_enum, f"{enum_class.__name__}.value_of did not return the expected enum for {valid_value}"

@pytest.mark.parametrize("enum_class, invalid_value", [
    (ToolProviderType, "non-existent"),
    (ApiProviderSchemaType, "invalid"),
    (ApiProviderAuthType, "unknown"),
])
def test_enum_value_of_invalid(enum_class, invalid_value):
    with pytest.raises(ValueError):
        enum_class.value_of(invalid_value)


# Test for I18nObject.to_dict()
def test_i18n_object_to_dict():
    i18n = I18nObject(en_US="English", zh_Hans="Chinese")
    expected = {"en_US": "English", "zh_Hans": "Chinese"}
    assert (
        i18n.to_dict() == expected
    ), "I18nObject to_dict does not match expected dictionary"

    i18n_no_zh = I18nObject(en_US="English")
    expected_no_zh = {"en_US": "English", "zh_Hans": "English"}
    assert (
        i18n_no_zh.to_dict() == expected_no_zh
    ), "I18nObject to_dict does not handle missing zh_Hans correctly"


# Test for ToolProviderCredentials.to_dict()
def test_tool_provider_credentials_to_dict():
    option = ToolCredentialsOption(
        value="option1", label=I18nObject(en_US="Option 1", zh_Hans="选项 1")
    )
    credentials = ToolProviderCredentials(
        name="api_key",
        type=ToolProviderCredentials.CredentialsType.SECRET_INPUT,
        required=True,
        default="123",
        options=[option],
        label=I18nObject(en_US="API Key", zh_Hans="API 密钥"),
        help=I18nObject(en_US="Your API key", zh_Hans="你的API密钥"),
        url="http://example.com",
        placeholder=I18nObject(en_US="Enter API key", zh_Hans="输入API密钥"),
    )

    expected = {
        "name": "api_key",
        "type": "secret-input",
        "required": True,
        "default": "123",
        "options": [option.dict()],
        "label": {"en_US": "API Key", "zh_Hans": "API 密钥"},
        "help": {"en_US": "Your API key", "zh_Hans": "你的API密钥"},
        "url": "http://example.com",
        "placeholder": {"en_US": "Enter API key", "zh_Hans": "输入API密钥"},
    }

    assert (
        credentials.to_dict() == expected
    ), "ToolProviderCredentials to_dict does not match expected dictionary"


def test_tool_runtime_variable_pool():
    # Setup initial pool with a text variable
    initial_pool = [
        {"type": ToolRuntimeVariableType.TEXT.value, "name": "var1", "position": 0, "tool_name": "tool1", "value": "initial value"}
    ]
    variable_pool = ToolRuntimeVariablePool(conversation_id="conv1", user_id="user1", tenant_id="tenant1", pool=initial_pool)

    # Test setting a new text variable
    variable_pool.set_text("tool1", "var2", "new text")
    assert any(v for v in variable_pool.pool if v.name == "var2" and v.value == "new text"), "Failed to set new text variable"

    # Test updating an existing text variable
    variable_pool.set_text("tool1", "var1", "updated value")
    assert any(v for v in variable_pool.pool if v.name == "var1" and v.value == "updated value"), "Failed to update existing text variable"

    # Test setting an image variable
    variable_pool.set_file("tool1", "path/to/image", "image1")
    assert any(v for v in variable_pool.pool if v.name == "image1" and v.value == "path/to/image"), "Failed to set image variable"


