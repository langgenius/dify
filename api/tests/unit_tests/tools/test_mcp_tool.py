import base64
from collections.abc import Iterator
from decimal import Decimal
from typing import Any
from unittest.mock import Mock, patch

import pytest
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from core.mcp.types import (
    AudioContent,
    BlobResourceContents,
    CallToolResult,
    EmbeddedResource,
    ImageContent,
    TextContent,
    TextResourceContents,
)
from core.mcp.types import (
    Tool as MCPToolType,
)
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolEntity, ToolIdentity, ToolInvokeMessage
from core.tools.mcp_tool.tool import MCPTool
from graphon.model_runtime.entities.llm_entities import LLMUsage
from services.tools.mcp_tools_manage_service import MCPToolManageService


@pytest.fixture
def orm_session(sqlite_engine: Engine) -> Iterator[Session]:
    """Use a real ORM session while MCP transport remains mocked."""
    with Session(sqlite_engine) as session:
        yield session


def _make_mcp_tool(output_schema: dict[str, Any] | None = None) -> MCPTool:
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
    def test_invoke_image_or_audio_yields_blob(self, content_factory, mime_type, orm_session: Session) -> None:
        tool = _make_mcp_tool()
        raw = b"\x00\x01test-bytes\x02"
        b64 = base64.b64encode(raw).decode()
        content = content_factory(b64, mime_type)
        result = CallToolResult(content=[content])

        with patch.object(tool, "invoke_remote_mcp_tool", return_value=result):
            messages = list(tool._invoke(session=orm_session, user_id="test_user", tool_parameters={}))

        assert len(messages) == 1
        msg = messages[0]
        assert msg.type == ToolInvokeMessage.MessageType.BLOB
        assert isinstance(msg.message, ToolInvokeMessage.BlobMessage)
        assert msg.message.blob == raw
        assert msg.meta == {"mime_type": mime_type}

    def test_invoke_embedded_text_resource_yields_text(self, orm_session: Session) -> None:
        tool = _make_mcp_tool()
        text_resource = TextResourceContents(uri="file://test.txt", mimeType="text/plain", text="hello world")
        content = EmbeddedResource(type="resource", resource=text_resource)
        result = CallToolResult(content=[content])

        with patch.object(tool, "invoke_remote_mcp_tool", return_value=result):
            messages = list(tool._invoke(session=orm_session, user_id="test_user", tool_parameters={}))

        assert len(messages) == 1
        msg = messages[0]
        assert msg.type == ToolInvokeMessage.MessageType.TEXT
        assert isinstance(msg.message, ToolInvokeMessage.TextMessage)
        assert msg.message.text == "hello world"

    @pytest.mark.parametrize(
        ("mime_type", "expected_mime"),
        [("application/pdf", "application/pdf"), (None, "application/octet-stream")],
    )
    def test_invoke_embedded_blob_resource_yields_blob(self, mime_type, expected_mime, orm_session: Session) -> None:
        tool = _make_mcp_tool()
        raw = b"binary-data"
        b64 = base64.b64encode(raw).decode()
        blob_resource = BlobResourceContents(uri="file://doc.bin", mimeType=mime_type, blob=b64)
        content = EmbeddedResource(type="resource", resource=blob_resource)
        result = CallToolResult(content=[content])

        with patch.object(tool, "invoke_remote_mcp_tool", return_value=result):
            messages = list(tool._invoke(session=orm_session, user_id="test_user", tool_parameters={}))

        assert len(messages) == 1
        msg = messages[0]
        assert msg.type == ToolInvokeMessage.MessageType.BLOB
        assert isinstance(msg.message, ToolInvokeMessage.BlobMessage)
        assert msg.message.blob == raw
        assert msg.meta == {"mime_type": expected_mime}

    def test_invoke_yields_variables_when_structured_content_and_schema(self, orm_session: Session) -> None:
        tool = _make_mcp_tool(output_schema={"type": "object"})
        result = CallToolResult(content=[], structuredContent={"a": 1, "b": "x"})

        with patch.object(tool, "invoke_remote_mcp_tool", return_value=result):
            messages = list(tool._invoke(session=orm_session, user_id="test_user", tool_parameters={}))

        # Expect two variable messages corresponding to keys a and b
        assert len(messages) == 2
        var_msgs = [m for m in messages if isinstance(m.message, ToolInvokeMessage.VariableMessage)]
        assert {m.message.variable_name for m in var_msgs} == {"a", "b"}
        # Validate values
        values = {m.message.variable_name: m.message.variable_value for m in var_msgs}
        assert values == {"a": 1, "b": "x"}

    def test_invoke_yields_json_when_structured_content_has_no_output_schema(self, orm_session: Session) -> None:
        tool = _make_mcp_tool()
        result = CallToolResult(content=[], structuredContent={"a": 1, "b": "x"})

        with patch.object(tool, "invoke_remote_mcp_tool", return_value=result):
            messages = list(tool._invoke(session=orm_session, user_id="test_user", tool_parameters={}))

        assert len(messages) == 1
        msg = messages[0]
        assert msg.type == ToolInvokeMessage.MessageType.JSON
        assert isinstance(msg.message, ToolInvokeMessage.JsonMessage)
        assert msg.message.json_object == {"a": 1, "b": "x"}


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

    def test_invoke_sets_latest_usage_from_meta(self, orm_session: Session) -> None:
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
            list(tool._invoke(session=orm_session, user_id="test_user", tool_parameters={}))

        # Verify latest_usage was set correctly
        assert tool.latest_usage.prompt_tokens == 200
        assert tool.latest_usage.completion_tokens == 100
        assert tool.latest_usage.total_tokens == 300
        assert tool.latest_usage.total_price == Decimal("0.003")

    def test_invoke_with_no_meta_returns_empty_usage(self, orm_session: Session) -> None:
        """Test that _invoke returns empty usage when no meta is present."""
        tool = _make_mcp_tool()
        result = CallToolResult(content=[TextContent(type="text", text="test")], _meta=None)

        with patch.object(tool, "invoke_remote_mcp_tool", return_value=result):
            list(tool._invoke(session=orm_session, user_id="test_user", tool_parameters={}))

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


class TestMCPToolNormalization:
    """Test MCP tool data normalization before persistence (issue #42453)."""

    def test_normalize_tool_without_title_falls_back_to_name(self):
        """When title is absent, fall back to tool name."""
        tool = MCPToolType(
            name="web_search_exa",
            description="Search the web",
            inputSchema={"type": "object"},
        )
        result = MCPToolManageService._normalize_mcp_tool_data(tool)
        assert result["title"] == "web_search_exa"
        assert result["description"] == "Search the web"
        assert result["outputSchema"] == {}

    def test_normalize_tool_with_title_preserves_title(self):
        """When title is provided, keep it."""
        tool = MCPToolType(
            name="web_search_exa",
            title="Web Search",
            description="Search the web",
            inputSchema={"type": "object"},
        )
        result = MCPToolManageService._normalize_mcp_tool_data(tool)
        assert result["title"] == "Web Search"

    def test_normalize_tool_title_falls_back_to_annotations_title(self):
        """When title is absent but annotations.title exists, use annotations.title."""
        tool = MCPToolType(
            name="web_search_exa",
            description="Search the web",
            inputSchema={"type": "object"},
            annotations={"title": "Exa Web Search"},
        )
        result = MCPToolManageService._normalize_mcp_tool_data(tool)
        assert result["title"] == "Exa Web Search"

    def test_normalize_tool_without_description_gives_empty_string(self):
        """When description is absent, use empty string."""
        tool = MCPToolType(
            name="test_tool",
            inputSchema={"type": "object"},
        )
        result = MCPToolManageService._normalize_mcp_tool_data(tool)
        assert result["description"] == ""
        assert result["title"] == "test_tool"

    def test_normalize_tool_removes_none_meta(self):
        """None meta field should be removed from output."""
        tool = MCPToolType(
            name="test_tool",
            description="A tool",
            inputSchema={"type": "object"},
        )
        result = MCPToolManageService._normalize_mcp_tool_data(tool)
        assert "meta" not in result or result["meta"] is not None

    def test_normalized_tool_no_none_title_in_json(self):
        """Serialized normalized tool should not contain title: null."""
        import json

        tool = MCPToolType(
            name="web_search_exa",
            description="Search the web for any topic",
            inputSchema={"type": "object", "properties": {}},
        )
        result = MCPToolManageService._normalize_mcp_tool_data(tool)
        serialized = json.dumps(result)
        assert '"title": null' not in serialized
        assert '"title": "web_search_exa"' in serialized

    def test_display_title_consistent_with_normalized_storage(self):
        """Display title from mcp_tool_to_user_tool must match normalized stored title.

        Calls the real ToolTransformService.mcp_tool_to_user_tool() function
        to verify that the label.en_US matches what normalization would store.
        Covers: explicit title, annotations.title only, neither.
        """
        import json
        from unittest.mock import Mock

        from services.tools.tools_transform_service import ToolTransformService

        def _get_label(tool: MCPToolType) -> str:
            """Call the real display function and return label.en_US."""
            result = ToolTransformService.mcp_tool_to_user_tool(
                Mock(), [tool], user_name="test_user"
            )
            return result[0].label.en_US

        def _roundtrip(tool: MCPToolType) -> MCPToolType:
            """Simulate save-to-DB then read-back via normalization + JSON."""
            normalized = MCPToolManageService._normalize_mcp_tool_data(tool)
            return MCPToolType.model_validate(json.loads(json.dumps(normalized)))

        cases = [
            # (tool, expected_title)
            # Case 1: no title, no annotations.title -> name
            (
                MCPToolType(name="web_search_exa", description="Search", inputSchema={"type": "object"}),
                "web_search_exa",
            ),
            # Case 2: no title, has annotations.title -> annotations.title
            (
                MCPToolType(
                    name="web_search_exa",
                    description="Search",
                    inputSchema={"type": "object"},
                    annotations={"title": "Exa Web Search"},
                ),
                "Exa Web Search",
            ),
            # Case 3: explicit title -> title
            (
                MCPToolType(
                    name="web_search_exa",
                    title="My Search",
                    description="Search",
                    inputSchema={"type": "object"},
                ),
                "My Search",
            ),
        ]

        for tool, expected in cases:
            # Original tool: display function must produce expected title
            display_label = _get_label(tool)
            assert display_label == expected, (
                f"Display label for {tool.name} (title={tool.title}): "
                f"expected {expected!r}, got {display_label!r}"
            )

            # Normalized + JSON roundtrip: display function must produce same title
            restored = _roundtrip(tool)
            restored_label = _get_label(restored)
            assert restored_label == expected, (
                f"Restored display label for {tool.name}: "
                f"expected {expected!r}, got {restored_label!r}"
            )

            # Stored title must also match
            stored = json.loads(json.dumps(MCPToolManageService._normalize_mcp_tool_data(tool)))
            assert stored["title"] == expected
