import base64
from unittest.mock import Mock, patch

import pytest

from core.mcp.types import (
    AudioContent,
    BlobResourceContents,
    CallToolResult,
    EmbeddedResource,
    ImageContent,
    TextResourceContents,
)
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
