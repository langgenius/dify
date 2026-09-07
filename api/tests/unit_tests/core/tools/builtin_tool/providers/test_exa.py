import pytest
from unittest.mock import MagicMock, patch
from core.tools.builtin_tool.providers.exa.exa import ExaProvider
from core.tools.builtin_tool.providers.exa.tools.search import ExaSearchTool
from core.tools.builtin_tool.providers.exa.tools.get_contents import ExaGetContentsTool
from core.tools.entities.tool_entities import ToolRuntime, ToolInvokeMessage
from core.tools.errors import ToolProviderCredentialValidationError, ToolInvokeError


def test_exa_provider_credential_validation():
    provider = ExaProvider()
    with pytest.raises(ToolProviderCredentialValidationError):
        provider._validate_credentials(user_id="u1", credentials={})


@patch("httpx.Client.post")
def test_exa_search_tool_invoke(mock_post):
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "results": [
            {"title": "Dify AI", "url": "https://dify.ai", "text": "Open source LLM app platform"}
        ]
    }
    mock_post.return_value = mock_response

    tool = ExaSearchTool()
    tool.runtime = MagicMock(spec=ToolRuntime)
    tool.runtime.credentials = {"api_key": "test-exa-key"}

    messages = list(
        tool._invoke(
            session=MagicMock(),
            user_id="u1",
            tool_parameters={"query": "Dify LLM", "num_results": 3},
        )
    )

    assert len(messages) >= 1
    assert any("Dify AI" in (msg.message or "") for msg in messages)


@patch("httpx.Client.post")
def test_exa_get_contents_tool_invoke(mock_post):
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "results": [
            {"title": "Example", "url": "https://example.com", "text": "Clean parsed content"}
        ]
    }
    mock_post.return_value = mock_response

    tool = ExaGetContentsTool()
    tool.runtime = MagicMock(spec=ToolRuntime)
    tool.runtime.credentials = {"api_key": "test-exa-key"}

    messages = list(
        tool._invoke(
            session=MagicMock(),
            user_id="u1",
            tool_parameters={"urls": "https://example.com"},
        )
    )

    assert len(messages) >= 1
    assert any("Clean parsed content" in (msg.message or "") for msg in messages)
