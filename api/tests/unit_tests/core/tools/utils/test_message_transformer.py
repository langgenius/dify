import pytest

import core.tools.utils.message_transformer as mt
from core.tools.entities.tool_entities import ToolInvokeMessage


class _FakeToolFile:
    def __init__(self, mimetype: str):
        self.id = "fake-tool-file-id"
        self.mimetype = mimetype


class _FakeToolFileManager:
    """Fake ToolFileManager to capture the mimetype passed in."""

    last_call: dict | None = None

    def __init__(self, *args, **kwargs):
        pass

    def create_file_by_raw(
        self,
        *,
        user_id: str,
        tenant_id: str,
        conversation_id: str | None,
        file_binary: bytes,
        mimetype: str,
        filename: str | None = None,
    ):
        type(self).last_call = {
            "user_id": user_id,
            "tenant_id": tenant_id,
            "conversation_id": conversation_id,
            "file_binary": file_binary,
            "mimetype": mimetype,
            "filename": filename,
        }
        return _FakeToolFile(mimetype)


@pytest.fixture(autouse=True)
def _patch_tool_file_manager(monkeypatch):
    # Patch the manager used inside the transformer module
    monkeypatch.setattr(mt, "ToolFileManager", _FakeToolFileManager)
    # also ensure predictable URL generation (no need to patch; uses id and extension only)
    yield
    _FakeToolFileManager.last_call = None


def _gen(messages):
    yield from messages


def test_transform_tool_invoke_messages_mimetype_key_present_but_none():
    # Arrange: a BLOB message whose meta contains a mime_type key set to None
    blob = b"hello"
    msg = ToolInvokeMessage(
        type=ToolInvokeMessage.MessageType.BLOB,
        message=ToolInvokeMessage.BlobMessage(blob=blob),
        meta={"mime_type": None, "filename": "greeting"},
    )

    # Act
    out = list(
        mt.ToolFileMessageTransformer.transform_tool_invoke_messages(
            messages=_gen([msg]),
            user_id="u1",
            tenant_id="t1",
            conversation_id="c1",
        )
    )

    # Assert: default to application/octet-stream when mime_type is present but None
    assert _FakeToolFileManager.last_call is not None
    assert _FakeToolFileManager.last_call["mimetype"] == "application/octet-stream"

    # Should yield a BINARY_LINK (not IMAGE_LINK) and the URL ends with .bin
    assert len(out) == 1
    o = out[0]
    assert o.type == ToolInvokeMessage.MessageType.BINARY_LINK
    assert isinstance(o.message, ToolInvokeMessage.TextMessage)
    assert o.message.text.endswith(".bin")
    # meta is preserved (still contains mime_type: None)
    assert "mime_type" in (o.meta or {})
    assert o.meta["mime_type"] is None
