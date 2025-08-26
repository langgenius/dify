from collections.abc import Generator
from dataclasses import dataclass, field
from typing import TypeVar, Union, cast

from configs import dify_config
from core.agent.entities import AgentInvokeMessage
from core.tools.entities.tool_entities import ToolInvokeMessage
from libs.validate_utils import bytes_to_str, validate_size

MessageType = TypeVar("MessageType", bound=Union[ToolInvokeMessage, AgentInvokeMessage])


@dataclass
class FileChunk:
    """File chunk buffer for assembling blob data from chunks."""

    total_length: int
    bytes_written: int = field(default=0, init=False)
    data: bytearray = field(init=False)

    def __post_init__(self) -> None:
        """Initialize the data buffer and validate file size."""
        # Validate file size against configuration
        try:
            max_size = dify_config.TOOL_FILE_MAX_SIZE
        except AttributeError:
            # Fallback to 50MB if config is not available
            max_size = 50 * 1024 * 1024

        validate_size(
            actual_size=self.total_length,
            hint="The tool file",
            min_size=0,
            max_size=max_size,
        )
        self.data = bytearray(self.total_length)

    def __iadd__(self, other: bytes) -> "FileChunk":
        """Add blob data to the chunk buffer."""
        self.data[self.bytes_written : self.bytes_written + len(other)] = other
        self.bytes_written += len(other)
        if self.bytes_written > self.total_length:
            raise ValueError(f"File chunk is too large which reached the limit of {bytes_to_str(self.total_length)}")
        return self


def merge_blob_chunks(
    response: Generator[MessageType, None, None],
    max_chunk_size: int = 8192,
) -> Generator[MessageType, None, None]:
    """
    Merge streaming blob chunks into complete blob messages.

    This function processes a stream of plugin invoke messages, accumulating
    BLOB_CHUNK messages by their ID until the final chunk is received,
    then yielding a single complete BLOB message.

    Args:
        response: Generator yielding messages that may include blob chunks
        max_chunk_size: Maximum allowed chunk size in bytes (default: 8KB)

    Yields:
        Messages from the response stream, with blob chunks merged into complete blobs

    Raises:
        ValueError: If file size exceeds dify_config.TOOL_FILE_MAX_SIZE or chunk size exceeds max_chunk_size
    """
    files: dict[str, FileChunk] = {}

    for resp in response:
        if resp.type == ToolInvokeMessage.MessageType.BLOB_CHUNK:
            assert isinstance(resp.message, ToolInvokeMessage.BlobChunkMessage)
            # Get blob chunk information
            chunk_id = resp.message.id
            total_length = resp.message.total_length
            blob_data = resp.message.blob
            is_end = resp.message.end

            # Initialize buffer for this file if it doesn't exist
            if chunk_id not in files:
                # FileChunk will validate total_length in __post_init__
                files[chunk_id] = FileChunk(total_length=total_length)

            # Check if single chunk is too large
            if len(blob_data) > max_chunk_size:
                raise ValueError(f"File chunk is too large which reached the limit of {bytes_to_str(max_chunk_size)}")

            # Append the blob data to the buffer (using += operator)
            files[chunk_id] += blob_data

            # If this is the final chunk, yield a complete blob message
            if is_end:
                # Create the appropriate message type based on the response type
                message_class = type(resp)
                merged_message = message_class(
                    type=ToolInvokeMessage.MessageType.BLOB,
                    message=ToolInvokeMessage.BlobMessage(blob=files[chunk_id].data[: files[chunk_id].bytes_written]),
                    meta=resp.meta,
                )
                yield cast(MessageType, merged_message)
                # Clean up the buffer
                del files[chunk_id]
        else:
            yield resp
