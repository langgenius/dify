import unittest
from unittest.mock import patch

import pytest

from core.plugin.impl.tool import FileChunk, PluginToolManager
from core.tools.entities.tool_entities import ToolInvokeMessage


class TestFileChunk(unittest.TestCase):
    def test_file_chunk_creation(self):
        """Test FileChunk creation with specified total length."""
        chunk = FileChunk(total_length=1024)

        assert chunk.total_length == 1024
        assert chunk.bytes_written == 0
        assert len(chunk.data) == 1024
        assert isinstance(chunk.data, bytearray)

    def test_file_chunk_pydantic_model(self):
        """Test FileChunk as a Pydantic model."""
        chunk = FileChunk(total_length=512, bytes_written=100, data=bytearray(512))

        assert chunk.total_length == 512
        assert chunk.bytes_written == 100
        assert len(chunk.data) == 512


class TestBlobChunkProcessing(unittest.TestCase):
    def setUp(self):
        self.manager = PluginToolManager()

    def test_process_non_blob_chunk_messages(self):
        """Test that non-blob chunk messages are passed through unchanged."""
        # Create test messages
        text_message = ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.TEXT, message=ToolInvokeMessage.TextMessage(text="Test message")
        )

        def response_generator():
            yield text_message

        # Process the response
        result = list(self.manager._process_blob_chunks(response_generator()))

        assert len(result) == 1
        assert result[0] == text_message

    def test_process_single_blob_chunk(self):
        """Test processing a complete blob in a single chunk (marked as end)."""
        test_data = b"Test file content"

        # Create a blob chunk message marked as end
        chunk_message = ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.BLOB_CHUNK,
            message=ToolInvokeMessage.BlobChunkMessage(
                id="file1", sequence=0, total_length=len(test_data), blob=test_data, end=True
            ),
            meta={"test": "meta"},
        )

        def response_generator():
            yield chunk_message

        # Process the response
        result = list(self.manager._process_blob_chunks(response_generator()))

        assert len(result) == 1
        assert result[0].type == ToolInvokeMessage.MessageType.BLOB
        assert isinstance(result[0].message, ToolInvokeMessage.BlobMessage)
        # The blob should be the complete file buffer, not just the chunk data
        assert len(result[0].message.blob) == len(test_data)
        assert result[0].meta == {"test": "meta"}

    def test_process_multiple_blob_chunks(self):
        """Test assembling a blob from multiple chunks."""
        chunk1_data = b"First part"
        chunk2_data = b" Second part"
        total_data = chunk1_data + chunk2_data

        # Create multiple chunk messages
        chunk1 = ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.BLOB_CHUNK,
            message=ToolInvokeMessage.BlobChunkMessage(
                id="file1", sequence=0, total_length=len(total_data), blob=chunk1_data, end=False
            ),
        )

        chunk2 = ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.BLOB_CHUNK,
            message=ToolInvokeMessage.BlobChunkMessage(
                id="file1", sequence=1, total_length=len(total_data), blob=chunk2_data, end=True
            ),
        )

        def response_generator():
            yield chunk1
            yield chunk2

        # Process the response
        result = list(self.manager._process_blob_chunks(response_generator()))

        # Should only yield one complete blob message
        assert len(result) == 1
        assert result[0].type == ToolInvokeMessage.MessageType.BLOB
        assert isinstance(result[0].message, ToolInvokeMessage.BlobMessage)
        assert result[0].message.blob[: len(total_data)] == total_data

    def test_chunk_size_limit_exceeded(self):
        """Test that chunks exceeding size limit raise an error."""
        # Create a chunk that exceeds the 12KB limit
        oversized_data = b"x" * 12222  # 12KB

        chunk_message = ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.BLOB_CHUNK,
            message=ToolInvokeMessage.BlobChunkMessage(
                id="file1", sequence=0, total_length=10000, blob=oversized_data, end=False
            ),
        )

        def response_generator():
            yield chunk_message

        # Should raise ValueError for oversized chunk
        with pytest.raises(ValueError) as exc_info:
            list(self.manager._process_blob_chunks(response_generator()))

        assert "File chunk is too large" in str(exc_info.value)
        assert "10000 bytes" in str(exc_info.value)

    @patch("core.plugin.impl.tool.dify_config")
    def test_file_size_limit_exceeded(self, mock_config):
        """Test that files exceeding total size limit raise an error."""
        mock_config.TOOL_FILE_MAX_SIZE = 1024  # Set limit to 1KB

        # Create chunks that together exceed the limit
        chunk1 = ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.BLOB_CHUNK,
            message=ToolInvokeMessage.BlobChunkMessage(
                id="file1", sequence=0, total_length=2000, blob=b"x" * 600, end=False
            ),
        )

        chunk2 = ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.BLOB_CHUNK,
            message=ToolInvokeMessage.BlobChunkMessage(
                id="file1", sequence=1, total_length=2000, blob=b"x" * 600, end=False
            ),
        )

        def response_generator():
            yield chunk1
            yield chunk2

        # Process first chunk successfully, second should fail
        with pytest.raises(ValueError) as exc_info:
            list(self.manager._process_blob_chunks(response_generator()))

        assert "File is too large" in str(exc_info.value)
        assert "1024 bytes" in str(exc_info.value)

    def test_multiple_files_concurrent_processing(self):
        """Test processing chunks from multiple files concurrently."""
        # Create chunks for two different files
        file1_chunk1 = ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.BLOB_CHUNK,
            message=ToolInvokeMessage.BlobChunkMessage(
                id="file1", sequence=0, total_length=10, blob=b"File1 data", end=False
            ),
        )

        file2_chunk1 = ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.BLOB_CHUNK,
            message=ToolInvokeMessage.BlobChunkMessage(
                id="file2", sequence=0, total_length=10, blob=b"File2 data", end=False
            ),
        )

        file1_chunk2 = ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.BLOB_CHUNK,
            message=ToolInvokeMessage.BlobChunkMessage(id="file1", sequence=1, total_length=10, blob=b"", end=True),
        )

        file2_chunk2 = ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.BLOB_CHUNK,
            message=ToolInvokeMessage.BlobChunkMessage(id="file2", sequence=1, total_length=10, blob=b"", end=True),
        )

        def response_generator():
            yield file1_chunk1
            yield file2_chunk1
            yield file1_chunk2
            yield file2_chunk2

        # Process the response
        result = list(self.manager._process_blob_chunks(response_generator()))

        # Should get two complete blobs
        assert len(result) == 2
        assert all(r.type == ToolInvokeMessage.MessageType.BLOB for r in result)

    def test_mixed_message_types(self):
        """Test processing a mix of blob chunks and other message types."""
        text_msg = ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.TEXT, message=ToolInvokeMessage.TextMessage(text="Status update")
        )

        chunk_msg = ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.BLOB_CHUNK,
            message=ToolInvokeMessage.BlobChunkMessage(id="file1", sequence=0, total_length=4, blob=b"Data", end=True),
        )

        # Use LOG message type with ERROR status instead of non-existent ERROR message type
        error_msg = ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.LOG,
            message=ToolInvokeMessage.LogMessage(
                id="error1",
                label="Error Log",
                status=ToolInvokeMessage.LogMessage.LogStatus.ERROR,
                data={"error": "Test error"},
            ),
        )

        def response_generator():
            yield text_msg
            yield chunk_msg
            yield error_msg

        # Process the response
        result = list(self.manager._process_blob_chunks(response_generator()))

        assert len(result) == 3
        assert result[0].type == ToolInvokeMessage.MessageType.TEXT
        assert result[1].type == ToolInvokeMessage.MessageType.BLOB
        assert result[2].type == ToolInvokeMessage.MessageType.LOG
