import json
import logging
import re
from abc import ABC, abstractmethod
from collections.abc import Generator, Mapping
from typing import Any, Union

from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.task_entities import AppBlockingResponse, AppStreamResponse
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.model_runtime.errors.invoke import InvokeError


class AppGenerateResponseConverter(ABC):
    _blocking_response_type: type[AppBlockingResponse]

    @classmethod
    def convert(
        cls,
        response: Union[AppBlockingResponse, Generator[AppStreamResponse, Any, None]],
        invoke_from: InvokeFrom,
    ) -> Mapping[str, Any] | Generator[str, None, None]:
        if invoke_from == InvokeFrom.SERVICE_API:
            if isinstance(response, AppBlockingResponse):
                return cls.convert_blocking_full_response(response)
            else:

                def _generate_full_response() -> Generator[str, Any, None]:
                    # Use the extracted method to handle thinking process logic
                    for processed_chunk in cls._process_stream_chunks_with_thinking(response):
                        if processed_chunk == "ping":
                            yield f"event: {processed_chunk}\n\n"
                            continue

                        yield f"data: {processed_chunk}\n\n"

                return _generate_full_response()
        elif invoke_from == InvokeFrom.DEBUGGER:
            if isinstance(response, AppBlockingResponse):
                return cls.convert_blocking_full_response(response)
            else:

                def _generate_full_response() -> Generator[str, Any, None]:
                    for chunk in cls.convert_stream_full_response(response):
                        if chunk == "ping":
                            yield f"event: {chunk}\n\n"
                        else:
                            yield f"data: {chunk}\n\n"

                return _generate_full_response()
        else:
            if isinstance(response, AppBlockingResponse):
                return cls.convert_blocking_simple_response(response)
            else:

                def _generate_simple_response() -> Generator[str, Any, None]:
                    for chunk in cls.convert_stream_simple_response(response):
                        if chunk == "ping":
                            yield f"event: {chunk}\n\n"
                        else:
                            yield f"data: {chunk}\n\n"

                return _generate_simple_response()

    @classmethod
    @abstractmethod
    def convert_blocking_full_response(cls, blocking_response: AppBlockingResponse) -> dict[str, Any]:
        raise NotImplementedError

    @classmethod
    @abstractmethod
    def convert_blocking_simple_response(cls, blocking_response: AppBlockingResponse) -> dict[str, Any]:
        raise NotImplementedError

    @classmethod
    @abstractmethod
    def convert_stream_full_response(
        cls, stream_response: Generator[AppStreamResponse, None, None]
    ) -> Generator[str, None, None]:
        raise NotImplementedError

    @classmethod
    @abstractmethod
    def convert_stream_simple_response(
        cls, stream_response: Generator[AppStreamResponse, None, None]
    ) -> Generator[str, None, None]:
        raise NotImplementedError

    @classmethod
    def _get_simple_metadata(cls, metadata: dict[str, Any]):
        """
        Get simple metadata.
        :param metadata: metadata
        :return:
        """
        # show_retrieve_source
        updated_resources = []
        if "retriever_resources" in metadata:
            for resource in metadata["retriever_resources"]:
                updated_resources.append(
                    {
                        "segment_id": resource.get("segment_id", ""),
                        "position": resource["position"],
                        "document_name": resource["document_name"],
                        "score": resource["score"],
                        "content": resource["content"],
                    }
                )
            metadata["retriever_resources"] = updated_resources

        # show annotation reply
        if "annotation_reply" in metadata:
            del metadata["annotation_reply"]

        # show usage
        if "usage" in metadata:
            del metadata["usage"]

        return metadata

    @classmethod
    def _error_to_stream_response(cls, e: Exception) -> dict:
        """
        Error to stream response.
        :param e: exception
        :return:
        """
        error_responses = {
            ValueError: {"code": "invalid_param", "status": 400},
            ProviderTokenNotInitError: {"code": "provider_not_initialize", "status": 400},
            QuotaExceededError: {
                "code": "provider_quota_exceeded",
                "message": (
                    "Your quota for Dify Hosted Model Provider has been exhausted. "
                    "Please go to Settings -> Model Provider to complete your own provider credentials."
                ),
                "status": 400,
            },
            ModelCurrentlyNotSupportError: {"code": "model_currently_not_support", "status": 400},
            InvokeError: {"code": "completion_request_error", "status": 400},
        }

        # Determine the response based on the type of exception
        data = None
        for k, v in error_responses.items():
            if isinstance(e, k):
                data = v

        if data:
            data.setdefault("message", getattr(e, "description", str(e)))
        else:
            logging.error(e)
            data = {
                "code": "internal_server_error",
                "message": "Internal Server Error, please contact support.",
                "status": 500,
            }

        return data

    @classmethod
    def _process_stream_chunks_with_thinking(
        cls, stream_response: Generator[AppStreamResponse, None, None]
    ) -> Generator[str, None, None]:
        """
        Process stream chunks and handle thinking process sections.

        This method processes each chunk from the stream response, handling any
        thinking process sections by accumulating content until the closing tag
        is found, then yielding only the content after the thinking process.

        :param stream_response: Stream of response chunks
        :yield: Processed chunks with thinking process sections removed
        """
        # Constants for thinking process handling
        THINKING_END_TAG = "</thinking_process>"

        # State variables
        is_thinking_process = False
        thinking_buffer = ""

        for chunk in cls.convert_stream_full_response(stream_response):
            # Handle ping messages
            if chunk == "ping":
                yield "ping"
                continue

            # Parse JSON chunks
            try:
                chunk_dict = json.loads(chunk)
            except json.JSONDecodeError:
                # Pass non-JSON chunks through unchanged
                yield chunk
                continue

            # Check if we're entering a thinking process
            if not is_thinking_process:
                # Check for thinking tag indicator in inputs
                has_thinking_tag = (
                    "data" in chunk_dict
                    and "inputs" in chunk_dict.get("data", {})
                    and chunk_dict.get("data", {}).get("inputs") is not None
                    and "thinking_tag" in chunk_dict.get("data", {}).get("inputs", {})
                )

                if has_thinking_tag:
                    is_thinking_process = True
                    thinking_buffer = ""  # Reset buffer
                else:
                    # No thinking process, pass through unchanged
                    yield chunk
                    continue

            # We're in a thinking process, check if chunk has answer
            if "answer" not in chunk_dict:
                # Unusual case - yield chunks without answers during thinking
                yield chunk
                continue

            # Add message text to thinking buffer
            message_text = chunk_dict["answer"]
            thinking_buffer += message_text

            # Check if thinking process has ended
            if THINKING_END_TAG not in thinking_buffer:
                # Still in thinking process, don't yield anything
                chunk_dict["answer"] = ""
                yield json.dumps(chunk_dict)
                continue

            # Extract content after the thinking process
            try:
                # Split at the end tag and take content after it
                remaining_parts = thinking_buffer.split(THINKING_END_TAG, 1)
                if len(remaining_parts) < 2:
                    # Unusual case - end tag found but splitting failed
                    # Reset state and continue with current chunk
                    is_thinking_process = False
                    thinking_buffer = ""
                    yield chunk
                    continue

                remaining_buffer = remaining_parts[1].strip()

                # Create modified chunk with only the content after thinking process
                chunk_dict["answer"] = remaining_buffer
                modified_chunk = json.dumps(chunk_dict)

                # Reset state variables
                is_thinking_process = False
                thinking_buffer = ""

                yield modified_chunk

            except Exception as e:
                # Log error and try to recover by resetting state
                logging.error(f"Error processing thinking buffer: {str(e)}")
                is_thinking_process = False
                thinking_buffer = ""
                # Try to return something useful
                yield chunk
