from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

import pytest
import requests

from core.app.entities.app_invoke_entities import InvokeFrom
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.builtin_tool.providers.perplexity.tools.perplexity_search import (
    PERPLEXITY_SEARCH_URL,
    PerplexitySearchTool,
    _build_payload,
)
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolEntity, ToolIdentity, ToolInvokeMessage
from core.tools.errors import ToolInvokeError


def _make_tool(api_key: str | None = "test-key") -> PerplexitySearchTool:
    entity = ToolEntity(
        identity=ToolIdentity(
            author="Perplexity",
            name="perplexity_search",
            label=I18nObject(en_US="Perplexity Search"),
            provider="perplexity",
        ),
        parameters=[],
    )
    credentials: dict[str, Any] = {}
    if api_key is not None:
        credentials["perplexity_api_key"] = api_key
    runtime = ToolRuntime(tenant_id="t1", credentials=credentials, invoke_from=InvokeFrom.DEBUGGER)
    return PerplexitySearchTool(provider="perplexity", entity=entity, runtime=runtime)


def _mock_response(payload: dict[str, Any], status: int = 200) -> MagicMock:
    response = MagicMock(spec=requests.Response)
    response.status_code = status
    response.json.return_value = payload
    if status >= 400:
        response.raise_for_status.side_effect = requests.HTTPError(f"HTTP {status}")
    else:
        response.raise_for_status.return_value = None
    return response


def test_build_payload_defaults_and_overrides():
    payload = _build_payload({"query": "hello"})
    assert payload == {"query": "hello", "max_results": 5}

    payload = _build_payload(
        {
            "query": "hello",
            "max_results": "12",
            "search_recency_filter": "week",
            "search_after_date_filter": "1/1/2025",
            "search_before_date_filter": "12/31/2025",
        }
    )
    assert payload["max_results"] == 12
    assert payload["search_recency_filter"] == "week"
    assert payload["search_after_date_filter"] == "1/1/2025"
    assert payload["search_before_date_filter"] == "12/31/2025"


def test_build_payload_domain_filter_supports_string_and_list():
    payload = _build_payload({"query": "x", "search_domain_filter": "nytimes.com, -pinterest.com"})
    assert payload["search_domain_filter"] == ["nytimes.com", "-pinterest.com"]

    payload = _build_payload({"query": "x", "search_domain_filter": ["arxiv.org", "  ", "nature.com"]})
    assert payload["search_domain_filter"] == ["arxiv.org", "nature.com"]

    payload = _build_payload({"query": "x", "search_domain_filter": ""})
    assert "search_domain_filter" not in payload


def test_invoke_returns_messages_for_results():
    tool = _make_tool()
    api_payload = {
        "id": "abc",
        "results": [
            {"title": "T1", "url": "https://example.com/1", "snippet": "s1", "date": "2025-01-01"},
            {"title": "T2", "url": "https://example.com/2", "snippet": "s2"},
        ],
    }

    with patch(
        "core.tools.builtin_tool.providers.perplexity.tools.perplexity_search.requests.post",
        return_value=_mock_response(api_payload),
    ) as mock_post:
        messages = list(tool.invoke(user_id="u1", tool_parameters={"query": "test", "max_results": 2}))

    assert mock_post.call_count == 1
    args, kwargs = mock_post.call_args
    assert args[0] == PERPLEXITY_SEARCH_URL
    assert kwargs["json"]["query"] == "test"
    assert kwargs["json"]["max_results"] == 2
    assert kwargs["headers"]["Authorization"] == "Bearer test-key"

    types = [m.type for m in messages]
    assert ToolInvokeMessage.MessageType.JSON in types
    assert types.count(ToolInvokeMessage.MessageType.LINK) == 2
    assert types[-1] == ToolInvokeMessage.MessageType.TEXT


def test_invoke_with_no_results_returns_friendly_text():
    tool = _make_tool()
    with patch(
        "core.tools.builtin_tool.providers.perplexity.tools.perplexity_search.requests.post",
        return_value=_mock_response({"results": []}),
    ):
        messages = list(tool.invoke(user_id="u1", tool_parameters={"query": "obscure"}))

    assert len(messages) == 1
    assert messages[0].type == ToolInvokeMessage.MessageType.TEXT
    assert "No results" in messages[0].message.text


def test_invoke_missing_query_yields_prompt():
    tool = _make_tool()
    with patch("core.tools.builtin_tool.providers.perplexity.tools.perplexity_search.requests.post") as mock_post:
        messages = list(tool.invoke(user_id="u1", tool_parameters={"query": "  "}))
    mock_post.assert_not_called()
    assert len(messages) == 1
    assert "query" in messages[0].message.text.lower()


def test_invoke_missing_api_key_yields_prompt():
    tool = _make_tool(api_key=None)
    with patch("core.tools.builtin_tool.providers.perplexity.tools.perplexity_search.requests.post") as mock_post:
        messages = list(tool.invoke(user_id="u1", tool_parameters={"query": "anything"}))
    mock_post.assert_not_called()
    assert len(messages) == 1
    assert "perplexity_api_key" in messages[0].message.text


def test_invoke_http_error_raises_tool_invoke_error():
    tool = _make_tool()
    with patch(
        "core.tools.builtin_tool.providers.perplexity.tools.perplexity_search.requests.post",
        return_value=_mock_response({}, status=500),
    ):
        with pytest.raises(ToolInvokeError):
            list(tool.invoke(user_id="u1", tool_parameters={"query": "boom"}))


def test_invoke_passes_filter_parameters_through():
    tool = _make_tool()
    with patch(
        "core.tools.builtin_tool.providers.perplexity.tools.perplexity_search.requests.post",
        return_value=_mock_response({"results": [{"title": "x", "url": "https://x.test"}]}),
    ) as mock_post:
        list(
            tool.invoke(
                user_id="u1",
                tool_parameters={
                    "query": "ai",
                    "max_results": 3,
                    "search_domain_filter": "nytimes.com,-pinterest.com",
                    "search_recency_filter": "month",
                    "search_after_date_filter": "1/1/2025",
                    "search_before_date_filter": "12/31/2025",
                },
            )
        )

    sent = mock_post.call_args.kwargs["json"]
    assert sent == {
        "query": "ai",
        "max_results": 3,
        "search_domain_filter": ["nytimes.com", "-pinterest.com"],
        "search_recency_filter": "month",
        "search_after_date_filter": "1/1/2025",
        "search_before_date_filter": "12/31/2025",
    }


def test_format_results_as_text_renders_each_result():
    text = PerplexitySearchTool._format_results_as_text(
        [
            {"title": "Title", "url": "https://example.com", "snippet": "Snippet", "date": "2025-04-01"},
            {"title": "Other", "url": "https://other.example.com"},
        ]
    )
    assert "Result 1" in text
    assert "[Title](https://example.com)" in text
    assert "Snippet" in text
    assert "2025-04-01" in text
    assert "Result 2" in text
