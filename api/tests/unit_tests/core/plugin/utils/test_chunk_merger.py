from collections.abc import Generator

import pytest

from core.agent.entities import AgentInvokeMessage
from core.plugin.utils.chunk_merger import FileChunk, merge_blob_chunks
from core.tools.entities.tool_entities import ToolInvokeMessage


class TestChunkMerger:
    def test_file_chunk_initialization(self):
        """Test FileChunk initialization."""
        chunk = FileChunk(1024)
        assert chunk.bytes_written == 0
        assert chunk.total_length == 1024
        assert len(chunk.data) == 1024

    def test_merge_blob_chunks_with_single_complete_chunk(self):
        """Test merging a single complete blob chunk."""

        def mock_generator() -> Generator[ToolInvokeMessage, None, None]:
            # First chunk (partial)
            yield ToolInvokeMessage(
                type=ToolInvokeMessage.MessageType.BLOB_CHUNK,
                message=ToolInvokeMessage.BlobChunkMessage(
                    id="file1", sequence=0, total_length=10, blob=b"Hello", end=False
                ),
            )
            # Second chunk (final)
            yield ToolInvokeMessage(
                type=ToolInvokeMessage.MessageType.BLOB_CHUNK,
                message=ToolInvokeMessage.BlobChunkMessage(
                    id="file1", sequence=1, total_length=10, blob=b"World", end=True
                ),
            )

        result = list(merge_blob_chunks(mock_generator()))
        assert len(result) == 1
        assert result[0].type == ToolInvokeMessage.MessageType.BLOB
        assert isinstance(result[0].message, ToolInvokeMessage.BlobMessage)
        # The buffer should contain the complete data
        assert result[0].message.blob[:10] == b"HelloWorld"

    def test_merge_blob_chunks_with_multiple_files(self):
        """Test merging chunks from multiple files."""

        def mock_generator() -> Generator[ToolInvokeMessage, None, None]:
            # File 1, chunk 1
            yield ToolInvokeMessage(
                type=ToolInvokeMessage.MessageType.BLOB_CHUNK,
                message=ToolInvokeMessage.BlobChunkMessage(
                    id="file1", sequence=0, total_length=4, blob=b"AB", end=False
                ),
            )
            # File 2, chunk 1
            yield ToolInvokeMessage(
                type=ToolInvokeMessage.MessageType.BLOB_CHUNK,
                message=ToolInvokeMessage.BlobChunkMessage(
                    id="file2", sequence=0, total_length=4, blob=b"12", end=False
                ),
            )
            # File 1, chunk 2 (final)
            yield ToolInvokeMessage(
                type=ToolInvokeMessage.MessageType.BLOB_CHUNK,
                message=ToolInvokeMessage.BlobChunkMessage(
                    id="file1", sequence=1, total_length=4, blob=b"CD", end=True
                ),
            )
            # File 2, chunk 2 (final)
            yield ToolInvokeMessage(
                type=ToolInvokeMessage.MessageType.BLOB_CHUNK,
                message=ToolInvokeMessage.BlobChunkMessage(
                    id="file2", sequence=1, total_length=4, blob=b"34", end=True
                ),
            )

        result = list(merge_blob_chunks(mock_generator()))
        assert len(result) == 2
        # Check that both files are properly merged
        assert all(r.type == ToolInvokeMessage.MessageType.BLOB for r in result)

    def test_merge_blob_chunks_passes_through_non_blob_messages(self):
        """Test that non-blob messages pass through unchanged."""

        def mock_generator() -> Generator[ToolInvokeMessage, None, None]:
            # Text message
            yield ToolInvokeMessage(
                type=ToolInvokeMessage.MessageType.TEXT,
                message=ToolInvokeMessage.TextMessage(text="Hello"),
            )
            # Blob chunk
            yield ToolInvokeMessage(
                type=ToolInvokeMessage.MessageType.BLOB_CHUNK,
                message=ToolInvokeMessage.BlobChunkMessage(
                    id="file1", sequence=0, total_length=5, blob=b"Test", end=True
                ),
            )
            # Another text message
            yield ToolInvokeMessage(
                type=ToolInvokeMessage.MessageType.TEXT,
                message=ToolInvokeMessage.TextMessage(text="World"),
            )

        result = list(merge_blob_chunks(mock_generator()))
        assert len(result) == 3
        assert result[0].type == ToolInvokeMessage.MessageType.TEXT
        assert isinstance(result[0].message, ToolInvokeMessage.TextMessage)
        assert result[0].message.text == "Hello"
        assert result[1].type == ToolInvokeMessage.MessageType.BLOB
        assert result[2].type == ToolInvokeMessage.MessageType.TEXT
        assert isinstance(result[2].message, ToolInvokeMessage.TextMessage)
        assert result[2].message.text == "World"

    def test_merge_blob_chunks_file_too_large(self):
        """Test that error is raised when file exceeds max size."""

        def mock_generator() -> Generator[ToolInvokeMessage, None, None]:
            # Send a chunk that would exceed the limit
            yield ToolInvokeMessage(
                type=ToolInvokeMessage.MessageType.BLOB_CHUNK,
                message=ToolInvokeMessage.BlobChunkMessage(
                    id="file1", sequence=0, total_length=100, blob=b"x" * 1024, end=False
                ),
            )

        with pytest.raises(ValueError) as exc_info:
            list(merge_blob_chunks(mock_generator(), max_file_size=1000))
        assert "File is too large" in str(exc_info.value)

    def test_merge_blob_chunks_chunk_too_large(self):
        """Test that error is raised when chunk exceeds max chunk size."""

        def mock_generator() -> Generator[ToolInvokeMessage, None, None]:
            # Send a chunk that exceeds the max chunk size
            yield ToolInvokeMessage(
                type=ToolInvokeMessage.MessageType.BLOB_CHUNK,
                message=ToolInvokeMessage.BlobChunkMessage(
                    id="file1", sequence=0, total_length=10000, blob=b"x" * 9000, end=False
                ),
            )

        with pytest.raises(ValueError) as exc_info:
            list(merge_blob_chunks(mock_generator(), max_chunk_size=8192))
        assert "File chunk is too large" in str(exc_info.value)

    def test_merge_blob_chunks_with_agent_invoke_message(self):
        """Test that merge_blob_chunks works with AgentInvokeMessage."""

        def mock_generator() -> Generator[AgentInvokeMessage, None, None]:
            # First chunk
            yield AgentInvokeMessage(
                type=AgentInvokeMessage.MessageType.BLOB_CHUNK,
                message=AgentInvokeMessage.BlobChunkMessage(
                    id="agent_file", sequence=0, total_length=8, blob=b"Agent", end=False
                ),
            )
            # Final chunk
            yield AgentInvokeMessage(
                type=AgentInvokeMessage.MessageType.BLOB_CHUNK,
                message=AgentInvokeMessage.BlobChunkMessage(
                    id="agent_file", sequence=1, total_length=8, blob=b"Data", end=True
                ),
            )

        result = list(merge_blob_chunks(mock_generator()))
        assert len(result) == 1
        assert isinstance(result[0], AgentInvokeMessage)
        assert result[0].type == AgentInvokeMessage.MessageType.BLOB

    def test_merge_blob_chunks_preserves_meta(self):
        """Test that meta information is preserved in merged messages."""

        def mock_generator() -> Generator[ToolInvokeMessage, None, None]:
            yield ToolInvokeMessage(
                type=ToolInvokeMessage.MessageType.BLOB_CHUNK,
                message=ToolInvokeMessage.BlobChunkMessage(
                    id="file1", sequence=0, total_length=4, blob=b"Test", end=True
                ),
                meta={"key": "value"},
            )

        result = list(merge_blob_chunks(mock_generator()))
        assert len(result) == 1
        assert result[0].meta == {"key": "value"}

    def test_merge_blob_chunks_custom_limits(self):
        """Test merge_blob_chunks with custom size limits."""

        def mock_generator() -> Generator[ToolInvokeMessage, None, None]:
            # This should work with custom limits
            yield ToolInvokeMessage(
                type=ToolInvokeMessage.MessageType.BLOB_CHUNK,
                message=ToolInvokeMessage.BlobChunkMessage(
                    id="file1", sequence=0, total_length=500, blob=b"x" * 400, end=False
                ),
            )
            yield ToolInvokeMessage(
                type=ToolInvokeMessage.MessageType.BLOB_CHUNK,
                message=ToolInvokeMessage.BlobChunkMessage(
                    id="file1", sequence=1, total_length=500, blob=b"y" * 100, end=True
                ),
            )

        # Should work with custom limits
        result = list(merge_blob_chunks(mock_generator(), max_file_size=1000, max_chunk_size=500))
        assert len(result) == 1

        # Should fail with smaller file size limit
        def mock_generator2() -> Generator[ToolInvokeMessage, None, None]:
            yield ToolInvokeMessage(
                type=ToolInvokeMessage.MessageType.BLOB_CHUNK,
                message=ToolInvokeMessage.BlobChunkMessage(
                    id="file1", sequence=0, total_length=500, blob=b"x" * 400, end=False
                ),
            )

        with pytest.raises(ValueError):
            list(merge_blob_chunks(mock_generator2(), max_file_size=300))

    def test_merge_blob_chunks_data_integrity(self):
        """Test that merged chunks exactly match the original data."""
        # Create original data
        original_data = b"This is a test message that will be split into chunks for testing purposes."
        chunk_size = 20

        def mock_generator() -> Generator[ToolInvokeMessage, None, None]:
            # Split original data into chunks
            chunks = []
            for i in range(0, len(original_data), chunk_size):
                chunk_data = original_data[i : i + chunk_size]
                is_last = (i + chunk_size) >= len(original_data)
                chunks.append((i // chunk_size, chunk_data, is_last))

            # Yield chunks
            for sequence, data, is_end in chunks:
                yield ToolInvokeMessage(
                    type=ToolInvokeMessage.MessageType.BLOB_CHUNK,
                    message=ToolInvokeMessage.BlobChunkMessage(
                        id="test_file",
                        sequence=sequence,
                        total_length=len(original_data),
                        blob=data,
                        end=is_end,
                    ),
                )

        result = list(merge_blob_chunks(mock_generator()))
        assert len(result) == 1
        assert result[0].type == ToolInvokeMessage.MessageType.BLOB
        assert isinstance(result[0].message, ToolInvokeMessage.BlobMessage)
        # Verify the merged data exactly matches the original
        assert result[0].message.blob == original_data

    def test_merge_blob_chunks_empty_chunk(self):
        """Test handling of empty chunks."""

        def mock_generator() -> Generator[ToolInvokeMessage, None, None]:
            # First chunk with data
            yield ToolInvokeMessage(
                type=ToolInvokeMessage.MessageType.BLOB_CHUNK,
                message=ToolInvokeMessage.BlobChunkMessage(
                    id="file1", sequence=0, total_length=10, blob=b"Hello", end=False
                ),
            )
            # Empty chunk in the middle
            yield ToolInvokeMessage(
                type=ToolInvokeMessage.MessageType.BLOB_CHUNK,
                message=ToolInvokeMessage.BlobChunkMessage(
                    id="file1", sequence=1, total_length=10, blob=b"", end=False
                ),
            )
            # Final chunk with data
            yield ToolInvokeMessage(
                type=ToolInvokeMessage.MessageType.BLOB_CHUNK,
                message=ToolInvokeMessage.BlobChunkMessage(
                    id="file1", sequence=2, total_length=10, blob=b"World", end=True
                ),
            )

        result = list(merge_blob_chunks(mock_generator()))
        assert len(result) == 1
        assert result[0].type == ToolInvokeMessage.MessageType.BLOB
        assert isinstance(result[0].message, ToolInvokeMessage.BlobMessage)
        # The final blob should contain "Hello" followed by "World"
        assert result[0].message.blob[:10] == b"HelloWorld"

    def test_merge_blob_chunks_single_chunk_file(self):
        """Test file that arrives as a single complete chunk."""

        def mock_generator() -> Generator[ToolInvokeMessage, None, None]:
            # Single chunk that is both first and last
            yield ToolInvokeMessage(
                type=ToolInvokeMessage.MessageType.BLOB_CHUNK,
                message=ToolInvokeMessage.BlobChunkMessage(
                    id="single_chunk_file",
                    sequence=0,
                    total_length=11,
                    blob=b"Single Data",
                    end=True,
                ),
            )

        result = list(merge_blob_chunks(mock_generator()))
        assert len(result) == 1
        assert result[0].type == ToolInvokeMessage.MessageType.BLOB
        assert isinstance(result[0].message, ToolInvokeMessage.BlobMessage)
        assert result[0].message.blob == b"Single Data"

    def test_merge_blob_chunks_concurrent_files(self):
        """Test that chunks from different files are properly separated."""

        def mock_generator() -> Generator[ToolInvokeMessage, None, None]:
            # Interleave chunks from three different files
            files_data = {
                "file1": b"First file content",
                "file2": b"Second file data",
                "file3": b"Third file",
            }

            # First chunk from each file
            for file_id, data in files_data.items():
                yield ToolInvokeMessage(
                    type=ToolInvokeMessage.MessageType.BLOB_CHUNK,
                    message=ToolInvokeMessage.BlobChunkMessage(
                        id=file_id,
                        sequence=0,
                        total_length=len(data),
                        blob=data[:6],
                        end=False,
                    ),
                )

            # Second chunk from each file (final)
            for file_id, data in files_data.items():
                yield ToolInvokeMessage(
                    type=ToolInvokeMessage.MessageType.BLOB_CHUNK,
                    message=ToolInvokeMessage.BlobChunkMessage(
                        id=file_id,
                        sequence=1,
                        total_length=len(data),
                        blob=data[6:],
                        end=True,
                    ),
                )

        result = list(merge_blob_chunks(mock_generator()))
        assert len(result) == 3

        # Extract the blob data from results
        blobs = set()
        for r in result:
            assert isinstance(r.message, ToolInvokeMessage.BlobMessage)
            blobs.add(r.message.blob)
        expected = {b"First file content", b"Second file data", b"Third file"}
        assert blobs == expected

    def test_merge_blob_chunks_exact_buffer_size(self):
        """Test that data fitting exactly in buffer works correctly."""

        def mock_generator() -> Generator[ToolInvokeMessage, None, None]:
            # Create data that exactly fills the declared buffer
            exact_data = b"X" * 100

            yield ToolInvokeMessage(
                type=ToolInvokeMessage.MessageType.BLOB_CHUNK,
                message=ToolInvokeMessage.BlobChunkMessage(
                    id="exact_file",
                    sequence=0,
                    total_length=100,
                    blob=exact_data[:50],
                    end=False,
                ),
            )
            yield ToolInvokeMessage(
                type=ToolInvokeMessage.MessageType.BLOB_CHUNK,
                message=ToolInvokeMessage.BlobChunkMessage(
                    id="exact_file",
                    sequence=1,
                    total_length=100,
                    blob=exact_data[50:],
                    end=True,
                ),
            )

        result = list(merge_blob_chunks(mock_generator()))
        assert len(result) == 1
        assert isinstance(result[0].message, ToolInvokeMessage.BlobMessage)
        assert len(result[0].message.blob) == 100
        assert result[0].message.blob == b"X" * 100

    def test_merge_blob_chunks_large_file_simulation(self):
        """Test handling of a large file split into many chunks."""

        def mock_generator() -> Generator[ToolInvokeMessage, None, None]:
            # Simulate a 1MB file split into 128 chunks of 8KB each
            chunk_size = 8192
            num_chunks = 128
            total_size = chunk_size * num_chunks

            for i in range(num_chunks):
                # Create unique data for each chunk to verify ordering
                chunk_data = bytes([i % 256]) * chunk_size
                is_last = i == num_chunks - 1

                yield ToolInvokeMessage(
                    type=ToolInvokeMessage.MessageType.BLOB_CHUNK,
                    message=ToolInvokeMessage.BlobChunkMessage(
                        id="large_file",
                        sequence=i,
                        total_length=total_size,
                        blob=chunk_data,
                        end=is_last,
                    ),
                )

        result = list(merge_blob_chunks(mock_generator()))
        assert len(result) == 1
        assert isinstance(result[0].message, ToolInvokeMessage.BlobMessage)
        assert len(result[0].message.blob) == 1024 * 1024

        # Verify the data pattern is correct
        merged_data = result[0].message.blob
        chunk_size = 8192
        num_chunks = 128
        for i in range(num_chunks):
            chunk_start = i * chunk_size
            chunk_end = chunk_start + chunk_size
            expected_byte = i % 256
            chunk = merged_data[chunk_start:chunk_end]
            assert all(b == expected_byte for b in chunk), f"Chunk {i} has incorrect data"

    def test_merge_blob_chunks_sequential_order_required(self):
        """
        Test note: The current implementation assumes chunks arrive in sequential order.
        Out-of-order chunks would need additional logic to handle properly.
        This test documents the expected behavior with sequential chunks.
        """

        def mock_generator() -> Generator[ToolInvokeMessage, None, None]:
            # Chunks arriving in correct sequential order
            data_parts = [b"First", b"Second", b"Third"]
            total_length = sum(len(part) for part in data_parts)

            for i, part in enumerate(data_parts):
                is_last = i == len(data_parts) - 1
                yield ToolInvokeMessage(
                    type=ToolInvokeMessage.MessageType.BLOB_CHUNK,
                    message=ToolInvokeMessage.BlobChunkMessage(
                        id="ordered_file",
                        sequence=i,
                        total_length=total_length,
                        blob=part,
                        end=is_last,
                    ),
                )

        result = list(merge_blob_chunks(mock_generator()))
        assert len(result) == 1
        assert isinstance(result[0].message, ToolInvokeMessage.BlobMessage)
        assert result[0].message.blob == b"FirstSecondThird"
