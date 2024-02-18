from unittest.mock import Mock

import pytest
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_bundle import ApiBasedToolBundle
from core.tools.entities.tool_entities import ToolParameter
from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.tool.api_tool import ApiTool


# Fixture for API Tool with mocked api_bundle
@pytest.fixture
def api_tool():
    # Creating real ToolParameter instances with all required fields
    tool_parameter = ToolParameter(
        name="required_param",
        required=False,
        type=ToolParameter.ToolParameterType.STRING,
        form=ToolParameter.ToolParameterForm.LLM,
        llm_description="Description",
        label=I18nObject(
            en_US="Required Param", zh_Hans="必需参数"
        ),  # I18nObject for label
        human_description=I18nObject(
            en_US="Human readable description for Required Param", zh_Hans="必需参数的人类可读描述"
        ),  # I18nObject for human_description
    )

    tool_parameter2 = ToolParameter(
        name="required_param2",
        required=False,
        type=ToolParameter.ToolParameterType.STRING,
        form=ToolParameter.ToolParameterForm.LLM,
        llm_description="Description2",
        label=I18nObject(
            en_US="Required Param 2", zh_Hans="必需参数2"
        ),  # I18nObject for label
        human_description=I18nObject(
            en_US="Human readable description for Required Param 2",
            zh_Hans="必需参数2的人类可读描述",
        ),  # I18nObject for human_description
    )

    # Creating a real ApiBasedToolBundle instance
    api_bundle = ApiBasedToolBundle(
        server_url="https://example.com",
        method="GET",
        author="John Doe",
        parameters=[tool_parameter, tool_parameter2],
        openapi={"operation": "test_api_tools_openapi"},
        operation_id="test_api_tools",
    )

    # Creating the ApiTool instance with the real api_bundle
    tool = ApiTool(api_bundle=api_bundle)

    return tool


@pytest.mark.parametrize(
    "credentials, expected_headers",
    [
        (
            {
                "auth_type": "api_key",
                "api_key_header": "X-API-Key",
                "api_key_value": "12345",
            },
            {"X-API-Key": "12345"},
        ),
        (
            {"auth_type": "oauth", "access_token": "token123"},
            {"Authorization": "Bearer token123"},
        ),
    ],
)
def test_assembling_request_with_auth(credentials, expected_headers, api_tool):
    """
    Test assembling request with different authentication methods.

    Parameters:
    - credentials: Dictionary containing the authentication credentials.
    - expected_headers: Expected headers in the request.
    """
    print(api_tool)
    api_tool.runtime = Mock(credentials=credentials)
    print(api_tool)
    headers = api_tool.assembling_request({})
    assert (
        headers == expected_headers
    ), "Headers do not match expected values for given auth method."


def test_assembling_request_missing_auth_type(api_tool):
    """
    Test error handling when 'auth_type' is missing in credentials.
    """
    api_tool.runtime = Mock(credentials={})
    with pytest.raises(
        ToolProviderCredentialValidationError, match="Missing auth_type"
    ):
        api_tool.assembling_request({})


def test_assembling_request_unsupported_auth_type(api_tool):
    """
    Test error handling when an unsupported 'auth_type' is provided.
    """
    api_tool.runtime = Mock(credentials={"auth_type": "unsupported"})
    with pytest.raises(
        ToolProviderCredentialValidationError, match="Unsupported auth_type"
    ):
        api_tool.assembling_request({})


def test_assembling_request_missing_api_key_value(api_tool):
    """
    Test error handling when the API key value is missing for API Key authentication.
    """
    api_tool.runtime = Mock(
        credentials={"auth_type": "api_key", "api_key_header": "X-API-Key"}
    )
    with pytest.raises(
        ToolProviderCredentialValidationError, match="Missing api_key_value"
    ):
        api_tool.assembling_request({})


def test_assembling_request_missing_oauth_access_token(api_tool):
    """
    Test error handling when the access token is missing for OAuth authentication.
    """
    api_tool.runtime = Mock(credentials={"auth_type": "oauth"})
    with pytest.raises(
        ToolProviderCredentialValidationError, match="Missing access_token"
    ):
        api_tool.assembling_request({})


def test_assembling_request_with_required_parameters(api_tool):
    """
    Test assembling request with required parameters.
    """
    api_tool.runtime = Mock(
        credentials={
            "auth_type": "api_key",
            "api_key_header": "X-API-Key",
            "api_key_value": "12345",
        }
    )
    parameters = {"required_param": "value"}
    headers = api_tool.assembling_request(parameters)
    assert "X-API-Key" in headers, "API Key header missing."
    assert (
        api_tool.api_bundle.parameters[0].name in parameters
    ), "Required parameter missing in the request."
