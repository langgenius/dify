"""Regression tests for tool-stream message validation and blob chunk merging.

Agent V2 talks to the plugin daemon through its own copy of the tool-stream
message model. A tool that emits an operation log via the plugin SDK's
``create_log_message`` leaves ``metadata`` unset, and the daemon serializes it
onto the wire as ``metadata: null``. The canonical core model
(``core.tools.entities.tool_entities.ToolInvokeMessage.LogMessage``) normalizes
that null to ``{}``; Agent V2's copy must do the same, otherwise every such log
message collapses the whole ``message`` union and the tool invocation fails with
``N validation errors for DifyPluginToolInvokeMessage``.

See langgenius/dify-official-plugins#3512.

Blob chunk merging validates the plugin-declared size before allocating.
"""

from __future__ import annotations

import pytest

from dify_agent.layers.dify_plugin.tool_client import (
    DifyPluginToolInvokeMessage,
    merge_blob_chunks,
)


def test_log_message_with_null_metadata_normalizes_to_empty_dict() -> None:
    """A LogMessage whose ``metadata`` is null must validate, not raise.

    This is the exact wire shape produced when a plugin tool calls
    ``create_log_message(label=..., data=..., status=...)`` without passing
    ``metadata`` (the SDK default), e.g. the Google Calendar tool.
    """
    message = DifyPluginToolInvokeMessage.model_validate(
        {
            "type": "log",
            "message": {
                "id": "log-1",
                "label": "Search Events Operation",
                "status": "success",
                "data": {"calendar_id": "primary"},
                "metadata": None,
            },
        }
    )

    assert isinstance(message.message, DifyPluginToolInvokeMessage.LogMessage)
    assert message.message.metadata == {}


def test_log_message_with_omitted_metadata_still_validates() -> None:
    """Omitting ``metadata`` entirely must also validate to an empty dict."""
    message = DifyPluginToolInvokeMessage.model_validate(
        {
            "type": "log",
            "message": {
                "id": "log-2",
                "label": "Fetching Top Stories",
                "status": "success",
                "data": {"limit": 10},
            },
        }
    )

    assert isinstance(message.message, DifyPluginToolInvokeMessage.LogMessage)
    assert message.message.metadata == {}


def blob_chunk(
    *, chunk_id: str, sequence: int, total_length: int, blob: bytes, end: bool
) -> DifyPluginToolInvokeMessage:
    return DifyPluginToolInvokeMessage(
        type=DifyPluginToolInvokeMessage.MessageType.BLOB_CHUNK,
        message=DifyPluginToolInvokeMessage.BlobChunkMessage(
            id=chunk_id,
            sequence=sequence,
            total_length=total_length,
            blob=blob,
            end=end,
        ),
    )


def test_merge_blob_chunks_rejects_declared_length_above_limit() -> None:
    """A declared length above the limit fails before the buffer is allocated."""
    chunks = [blob_chunk(chunk_id="file1", sequence=0, total_length=1025, blob=b"x", end=False)]

    with pytest.raises(ValueError, match="File is too large"):
        merge_blob_chunks(chunks, max_file_size=1024)


def test_merge_blob_chunks_rejects_unallocatable_declared_length() -> None:
    """An absurd declared length raises ValueError instead of MemoryError."""
    chunks = [blob_chunk(chunk_id="file1", sequence=0, total_length=2**62, blob=b"x", end=False)]

    with pytest.raises(ValueError, match="File is too large"):
        merge_blob_chunks(chunks)


def test_merge_blob_chunks_accepts_declared_length_at_the_limit() -> None:
    """A declared length exactly at the limit is still accepted and merged."""
    chunks = [
        blob_chunk(chunk_id="file1", sequence=0, total_length=1024, blob=b"abc", end=False),
        blob_chunk(chunk_id="file1", sequence=1, total_length=1024, blob=b"defg", end=True),
    ]

    merged = merge_blob_chunks(chunks, max_file_size=1024)

    assert len(merged) == 1
    assert merged[0].type is DifyPluginToolInvokeMessage.MessageType.BLOB
    assert isinstance(merged[0].message, DifyPluginToolInvokeMessage.BlobMessage)
    assert merged[0].message.blob == b"abcdefg"


def test_merge_blob_chunks_keeps_non_chunk_messages_in_order() -> None:
    """Text messages around blob chunks still pass through in stream order."""
    chunks = [
        DifyPluginToolInvokeMessage(
            type=DifyPluginToolInvokeMessage.MessageType.TEXT,
            message=DifyPluginToolInvokeMessage.TextMessage(text="before"),
        ),
        blob_chunk(chunk_id="file1", sequence=0, total_length=1, blob=b"x", end=True),
        DifyPluginToolInvokeMessage(
            type=DifyPluginToolInvokeMessage.MessageType.TEXT,
            message=DifyPluginToolInvokeMessage.TextMessage(text="after"),
        ),
    ]

    merged = merge_blob_chunks(chunks)

    assert [message.type for message in merged] == [
        DifyPluginToolInvokeMessage.MessageType.TEXT,
        DifyPluginToolInvokeMessage.MessageType.BLOB,
        DifyPluginToolInvokeMessage.MessageType.TEXT,
    ]
