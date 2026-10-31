"""Blob chunk merging validates the plugin-declared size before allocating."""

import pytest

from dify_agent.layers.dify_plugin.tool_client import (
    DifyPluginToolInvokeMessage,
    merge_blob_chunks,
)


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
