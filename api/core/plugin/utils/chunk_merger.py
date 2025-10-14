from collections.abc import Generator
from dataclasses import dataclass, field
from typing import TypeVar, Union

from core.agent.entities import AgentInvokeMessage
from core.tools.entities.tool_entities import ToolInvokeMessage

MessageType = TypeVar("MessageType", bound=Union[ToolInvokeMessage, AgentInvokeMessage])


@dataclass
class FileChunk:
    """
    Buffer for accumulating file chunks during streaming.
    """

    total_length: int
    bytes_written: int = field(default=0, init=False)
    data: bytearray = field(init=False)

    def __post_init__(self):
        self.data = bytearray(self.total_length)


def merge_blob_chunks(
    response: Generator[MessageType, None, None],
    max_file_size: int = 30 * 1024 * 1024,
    max_chunk_size: int = 8192,
) -> Generator[MessageType, None, None]:
    """
    Merge streaming blob chunks into complete blob messages.

    This function processes a stream of plugin invoke messages, accumulating
    BLOB_CHUNK messages by their ID until the final chunk is received,
    then yielding a single complete BLOB message.

    Args:
        response: Generator yielding messages that may include blob chunks
        max_file_size: Maximum allowed file size in bytes (default: 30MB)
        max_chunk_size: Maximum allowed chunk size in bytes (default: 8KB)

    Yields:
        Messages from the response stream, with blob chunks merged into complete blobs

    Raises:
        ValueError: If file size exceeds max_file_size or chunk size exceeds max_chunk_size
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
                files[chunk_id] = FileChunk(total_length)

            # Check if file is too large (before appending)
            if files[chunk_id].bytes_written + len(blob_data) > max_file_size:
                # Delete the file if it's too large
                del files[chunk_id]
                raise ValueError(f"File is too large which reached the limit of {max_file_size / 1024 / 1024}MB")

            # Check if single chunk is too large
            if len(blob_data) > max_chunk_size:
                raise ValueError(f"File chunk is too large which reached the limit of {max_chunk_size / 1024}KB")

            # Append the blob data to the buffer
            files[chunk_id].data[files[chunk_id].bytes_written : files[chunk_id].bytes_written + len(blob_data)] = (
                blob_data
            )
            files[chunk_id].bytes_written += len(blob_data)

            # If this is the final chunk, yield a complete blob message
            if is_end:
                # Create the appropriate message type based on the response type
                message_class = type(resp)
                merged_message = message_class(
                    type=ToolInvokeMessage.MessageType.BLOB,
                    message=ToolInvokeMessage.BlobMessage(
                        blob=bytes(files[chunk_id].data[: files[chunk_id].bytes_written])
                    ),
                    meta=resp.meta,
                )
                assert isinstance(merged_message, (ToolInvokeMessage, AgentInvokeMessage))
                yield merged_message  # type: ignore
                # Clean up the buffer
                del files[chunk_id]
        else:
            yield resp
