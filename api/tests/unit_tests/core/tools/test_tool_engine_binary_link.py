from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool_engine import ToolEngine


def test_extract_binary_link_with_mime_type_yields():
    url = "http://example.com/file.bin"
    msg = ToolInvokeMessage(
        type=ToolInvokeMessage.MessageType.BINARY_LINK,
        message=ToolInvokeMessage.TextMessage(text=url),
        meta={"mime_type": "application/pdf"},
    )

    out = list(ToolEngine._extract_tool_response_binary_and_text([msg]))

    assert len(out) == 1
    assert out[0].mimetype == "application/pdf"
    assert out[0].url == url


def test_extract_binary_link_without_mime_type_skips():
    url = "http://example.com/file.bin"
    msg = ToolInvokeMessage(
        type=ToolInvokeMessage.MessageType.BINARY_LINK,
        message=ToolInvokeMessage.TextMessage(text=url),
        meta=None,
    )

    out = list(ToolEngine._extract_tool_response_binary_and_text([msg]))

    assert out == []


def test_convert_to_str_includes_binary_link_hint():
    url = "http://example.com/file.bin"
    msgs: list[ToolInvokeMessage] = [
        ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.BINARY_LINK,
            message=ToolInvokeMessage.TextMessage(text=url),
            meta={"mime_type": "application/octet-stream"},
        )
    ]

    s = ToolEngine._convert_tool_response_to_str(msgs)

    assert "file link" in s.lower()
