import base64
from decimal import Decimal
from unittest.mock import Mock, patch

import pytest

from core.mcp.types import (
    AudioContent,
    BlobResourceContents,
    CallToolResult,
    EmbeddedResource,
    ImageContent,
    TextContent,
    TextResourceContents,
)
from core.model_runtime.entities.llm_entities import LLMUsage
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolEntity, ToolIdentity, ToolInvokeMessage
from core.tools.mcp_tool.tool import MCPTool


def _make_mcp_tool(output_schema: dict | None = None) -> MCPTool:
    identity = ToolIdentity(
        author="test",
        name="test_mcp_tool",
        label=I18nObject(en_US="Test MCP Tool", zh_Hans="测试MCP工具"),
        provider="test_provider",
    )
    entity = ToolEntity(identity=identity, output_schema=output_schema or {})
    runtime = Mock(spec=ToolRuntime)
    runtime.credentials = {}
    return MCPTool(
        entity=entity,
        runtime=runtime,
        tenant_id="test_tenant",
        icon="",
        server_url="https://server.invalid",
        provider_id="provider_1",
        headers={},
    )


class TestMCPToolInvoke:
    @pytest.mark.parametrize(
        ("content_factory", "mime_type"),
        [
            (
                lambda b64, mt: ImageContent(type="image", data=b64, mimeType=mt),
                "image/png",
            ),
            (
                lambda b64, mt: AudioContent(type="audio", data=b64, mimeType=mt),
                "audio/mpeg",
            ),
        ],
    )
    def test_invoke_image_or_audio_yields_blob(self, content_factory, mime_type) -> None:
        tool = _make_mcp_tool()
        raw = b"\x00\x01test-bytes\x02"
        b64 = base64.b64encode(raw).decode()
        content = content_factory(b64, mime_type)
        result = CallToolResult(content=[content])

        with patch.object(tool, "invoke_remote_mcp_tool", return_value=result):
            messages = list(tool._invoke(user_id="test_user", tool_parameters={}))

        assert len(messages) == 1
        msg = messages[0]
        assert msg.type == ToolInvokeMessage.MessageType.BLOB
        assert isinstance(msg.message, ToolInvokeMessage.BlobMessage)
        assert msg.message.blob == raw
        assert msg.meta == {"mime_type": mime_type}

    def test_invoke_embedded_text_resource_yields_text(self) -> None:
        tool = _make_mcp_tool()
        text_resource = TextResourceContents(uri="file://test.txt", mimeType="text/plain", text="hello world")
        content = EmbeddedResource(type="resource", resource=text_resource)
        result = CallToolResult(content=[content])

        with patch.object(tool, "invoke_remote_mcp_tool", return_value=result):
            messages = list(tool._invoke(user_id="test_user", tool_parameters={}))

        assert len(messages) == 1
        msg = messages[0]
        assert msg.type == ToolInvokeMessage.MessageType.TEXT
        assert isinstance(msg.message, ToolInvokeMessage.TextMessage)
        assert msg.message.text == "hello world"

    @pytest.mark.parametrize(
        ("mime_type", "expected_mime"),
        [("application/pdf", "application/pdf"), (None, "application/octet-stream")],
    )
    def test_invoke_embedded_blob_resource_yields_blob(self, mime_type, expected_mime) -> None:
        tool = _make_mcp_tool()
        raw = b"binary-data"
        b64 = base64.b64encode(raw).decode()
        blob_resource = BlobResourceContents(uri="file://doc.bin", mimeType=mime_type, blob=b64)
        content = EmbeddedResource(type="resource", resource=blob_resource)
        result = CallToolResult(content=[content])

        with patch.object(tool, "invoke_remote_mcp_tool", return_value=result):
            messages = list(tool._invoke(user_id="test_user", tool_parameters={}))

        assert len(messages) == 1
        msg = messages[0]
        assert msg.type == ToolInvokeMessage.MessageType.BLOB
        assert isinstance(msg.message, ToolInvokeMessage.BlobMessage)
        assert msg.message.blob == raw
        assert msg.meta == {"mime_type": expected_mime}

    def test_invoke_yields_variables_when_structured_content_and_schema(self) -> None:
        tool = _make_mcp_tool(output_schema={"type": "object"})
        result = CallToolResult(content=[], structuredContent={"a": 1, "b": "x"})

        with patch.object(tool, "invoke_remote_mcp_tool", return_value=result):
            messages = list(tool._invoke(user_id="test_user", tool_parameters={}))

        # Expect two variable messages corresponding to keys a and b
        assert len(messages) == 2
        var_msgs = [m for m in messages if isinstance(m.message, ToolInvokeMessage.VariableMessage)]
        assert {m.message.variable_name for m in var_msgs} == {"a", "b"}
        # Validate values
        values = {m.message.variable_name: m.message.variable_value for m in var_msgs}
        assert values == {"a": 1, "b": "x"}


class TestMCPToolUsageExtraction:
    """Test usage metadata extraction from MCP tool results."""

    def test_extract_usage_dict_from_direct_usage_field(self) -> None:
        """Test extraction when usage is directly in meta.usage field."""
        meta = {
            "usage": {
                "prompt_tokens": 100,
                "completion_tokens": 50,
                "total_tokens": 150,
                "total_price": "0.001",
                "currency": "USD",
            }
        }
        usage_dict = MCPTool._extract_usage_dict(meta)
        assert usage_dict is not None
        assert usage_dict["prompt_tokens"] == 100
        assert usage_dict["completion_tokens"] == 50
        assert usage_dict["total_tokens"] == 150
        assert usage_dict["total_price"] == "0.001"
        assert usage_dict["currency"] == "USD"

    def test_extract_usage_dict_from_nested_metadata(self) -> None:
        """Test extraction when usage is nested in meta.metadata.usage."""
        meta = {
            "metadata": {
                "usage": {
                    "prompt_tokens": 200,
                    "completion_tokens": 100,
                    "total_tokens": 300,
                }
            }
        }
        usage_dict = MCPTool._extract_usage_dict(meta)
        assert usage_dict is not None
        assert usage_dict["prompt_tokens"] == 200
        assert usage_dict["total_tokens"] == 300

    def test_extract_usage_dict_from_flat_token_fields(self) -> None:
        """Test extraction when token counts are directly in meta."""
        meta = {
            "prompt_tokens": 150,
            "completion_tokens": 75,
            "total_tokens": 225,
            "currency": "EUR",
        }
        usage_dict = MCPTool._extract_usage_dict(meta)
        assert usage_dict is not None
        assert usage_dict["prompt_tokens"] == 150
        assert usage_dict["completion_tokens"] == 75
        assert usage_dict["total_tokens"] == 225
        assert usage_dict["currency"] == "EUR"

    def test_extract_usage_dict_recursive(self) -> None:
        """Test recursive search through nested structures."""
        meta = {
            "custom": {
                "nested": {
                    "usage": {
                        "total_tokens": 500,
                        "prompt_tokens": 300,
                        "completion_tokens": 200,
                    }
                }
            }
        }
        usage_dict = MCPTool._extract_usage_dict(meta)
        assert usage_dict is not None
        assert usage_dict["total_tokens"] == 500

    def test_extract_usage_dict_from_list(self) -> None:
        """Test extraction from nested list structures."""
        meta = {
            "items": [
                {"usage": {"total_tokens": 100}},
                {"other": "data"},
            ]
        }
        usage_dict = MCPTool._extract_usage_dict(meta)
        assert usage_dict is not None
        assert usage_dict["total_tokens"] == 100

    def test_extract_usage_dict_returns_none_when_missing(self) -> None:
        """Test that None is returned when no usage data is present."""
        meta = {"other": "data", "custom": {"nested": {"value": 123}}}
        usage_dict = MCPTool._extract_usage_dict(meta)
        assert usage_dict is None

    def test_extract_usage_dict_empty_meta(self) -> None:
        """Test with empty meta dict."""
        usage_dict = MCPTool._extract_usage_dict({})
        assert usage_dict is None

    def test_derive_usage_from_result_with_meta(self) -> None:
        """Test _derive_usage_from_result with populated meta."""
        meta = {
            "usage": {
                "prompt_tokens": 100,
                "completion_tokens": 50,
                "total_tokens": 150,
                "total_price": "0.0015",
                "currency": "USD",
            }
        }
        result = CallToolResult(content=[], _meta=meta)
        usage = MCPTool._derive_usage_from_result(result)

        assert isinstance(usage, LLMUsage)
        assert usage.prompt_tokens == 100
        assert usage.completion_tokens == 50
        assert usage.total_tokens == 150
        assert usage.total_price == Decimal("0.0015")
        assert usage.currency == "USD"

    def test_derive_usage_from_result_without_meta(self) -> None:
        """Test _derive_usage_from_result with no meta returns empty usage."""
        result = CallToolResult(content=[], meta=None)
        usage = MCPTool._derive_usage_from_result(result)

        assert isinstance(usage, LLMUsage)
        assert usage.total_tokens == 0
        assert usage.prompt_tokens == 0
        assert usage.completion_tokens == 0

    def test_derive_usage_from_result_calculates_total_tokens(self) -> None:
        """Test that total_tokens is calculated when missing."""
        meta = {
            "usage": {
                "prompt_tokens": 100,
                "completion_tokens": 50,
                # total_tokens is missing
            }
        }
        result = CallToolResult(content=[], _meta=meta)
        usage = MCPTool._derive_usage_from_result(result)

        assert usage.total_tokens == 150  # 100 + 50
        assert usage.prompt_tokens == 100
        assert usage.completion_tokens == 50

    def test_invoke_sets_latest_usage_from_meta(self) -> None:
        """Test that _invoke sets _latest_usage from result meta."""
        tool = _make_mcp_tool()
        meta = {
            "usage": {
                "prompt_tokens": 200,
                "completion_tokens": 100,
                "total_tokens": 300,
                "total_price": "0.003",
                "currency": "USD",
            }
        }
        result = CallToolResult(content=[TextContent(type="text", text="test")], _meta=meta)

        with patch.object(tool, "invoke_remote_mcp_tool", return_value=result):
            list(tool._invoke(user_id="test_user", tool_parameters={}))

        # Verify latest_usage was set correctly
        assert tool.latest_usage.prompt_tokens == 200
        assert tool.latest_usage.completion_tokens == 100
        assert tool.latest_usage.total_tokens == 300
        assert tool.latest_usage.total_price == Decimal("0.003")

    def test_invoke_with_no_meta_returns_empty_usage(self) -> None:
        """Test that _invoke returns empty usage when no meta is present."""
        tool = _make_mcp_tool()
        result = CallToolResult(content=[TextContent(type="text", text="test")], _meta=None)

        with patch.object(tool, "invoke_remote_mcp_tool", return_value=result):
            list(tool._invoke(user_id="test_user", tool_parameters={}))

        # Verify latest_usage is empty
        assert tool.latest_usage.total_tokens == 0
        assert tool.latest_usage.prompt_tokens == 0
        assert tool.latest_usage.completion_tokens == 0

    def test_latest_usage_property_returns_llm_usage(self) -> None:
        """Test that latest_usage property returns LLMUsage instance."""
        tool = _make_mcp_tool()
        assert isinstance(tool.latest_usage, LLMUsage)

    def test_initial_usage_is_empty(self) -> None:
        """Test that MCPTool is initialized with empty usage."""
        tool = _make_mcp_tool()
        assert tool.latest_usage.total_tokens == 0
        assert tool.latest_usage.prompt_tokens == 0
        assert tool.latest_usage.completion_tokens == 0
        assert tool.latest_usage.total_price == Decimal(0)

    @pytest.mark.parametrize(
        "meta_data",
        [
            # Direct usage field
            {"usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}},
            # Nested metadata
            {"metadata": {"usage": {"total_tokens": 100}}},
            # Flat token fields
            {"total_tokens": 50, "prompt_tokens": 30, "completion_tokens": 20},
            # With price info
            {
                "usage": {
                    "total_tokens": 150,
                    "total_price": "0.002",
                    "currency": "EUR",
                }
            },
            # Deep nested
            {"level1": {"level2": {"usage": {"total_tokens": 200}}}},
        ],
    )
    def test_various_meta_formats(self, meta_data) -> None:
        """Test that various meta formats are correctly parsed."""
        result = CallToolResult(content=[], _meta=meta_data)
        usage = MCPTool._derive_usage_from_result(result)

        assert isinstance(usage, LLMUsage)
        # Should have at least some usage data
        if meta_data.get("usage", {}).get("total_tokens") or meta_data.get("total_tokens"):
            expected_total = (
                meta_data.get("usage", {}).get("total_tokens")
                or meta_data.get("total_tokens")
                or meta_data.get("metadata", {}).get("usage", {}).get("total_tokens")
                or meta_data.get("level1", {}).get("level2", {}).get("usage", {}).get("total_tokens")
            )
            if expected_total:
                assert usage.total_tokens == expected_total
