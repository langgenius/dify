"""Blob-chunk merging validates the declared size before allocating a buffer."""

import pytest

from dify_agent.layers.dify_plugin.tool_client import (
    DifyPluginToolInvokeMessage as M,
    merge_blob_chunks,
)


def _blob_chunk(total_length: int, *, blob: bytes = b"x", end: bool = False) -> M:
    return M(
        type=M.MessageType.BLOB_CHUNK,
        message=M.BlobChunkMessage(id="file1", sequence=0, total_length=total_length, blob=blob, end=end),
    )


class TestMergeBlobChunksSizeGuard:
    def test_single_complete_chunk_still_merges(self):
        """A well-formed stream still merges into one blob message."""
        messages = [_blob_chunk(5, blob=b"Hello", end=True)]

        result = merge_blob_chunks(messages)

        assert len(result) == 1
        assert result[0].type is M.MessageType.BLOB
        assert result[0].message.blob == b"Hello"

    def test_declared_size_at_the_limit_is_accepted(self):
        """A declared total_length exactly equal to the limit is not oversized."""
        messages = [_blob_chunk(4, blob=b"Test", end=True)]

        result = merge_blob_chunks(messages, max_file_size=4)

        assert len(result) == 1
        assert result[0].message.blob == b"Test"

    def test_declared_size_above_limit_is_rejected_before_allocation(self):
        """A declared total_length above the limit raises before the buffer exists.

        ``total_length`` comes from the plugin daemon, so trusting it for the
        pre-allocated buffer lets a plugin exhaust the agent runtime's memory.
        """

        with pytest.raises(ValueError, match="File is too large"):
            merge_blob_chunks([_blob_chunk(1025)], max_file_size=1024)

    def test_absurd_declared_size_raises_value_error_not_memory_error(self):
        """An absurd declared total_length raises ValueError, not MemoryError."""

        with pytest.raises(ValueError, match="File is too large"):
            merge_blob_chunks([_blob_chunk(2**62)])

    def test_oversized_declared_size_does_not_silently_drop_the_chunk(self):
        """A slightly oversized declaration is reported, not silently swallowed."""

        with pytest.raises(ValueError, match="File is too large"):
            merge_blob_chunks([_blob_chunk(1025, end=True)], max_file_size=1024)
