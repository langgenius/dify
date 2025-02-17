from collections.abc import Generator
from typing import cast

from core.app.apps.base_app_generate_response_converter import AppGenerateResponseConverter
from core.app.entities.task_entities import (
    AppStreamResponse,
    ChatbotAppBlockingResponse,
    ChatbotAppStreamResponse,
    ErrorStreamResponse,
    MessageEndStreamResponse,
    PingStreamResponse,
)


class AgentChatAppGenerateResponseConverter(AppGenerateResponseConverter):
    _blocking_response_type = ChatbotAppBlockingResponse

    @classmethod
    def convert_blocking_full_response(cls, blocking_response: ChatbotAppBlockingResponse) -> dict:  # type: ignore[override]
        """
        Convert blocking full response.
        :param blocking_response: blocking response
        :return:
        """
        response = {
            "event": "message",
            "task_id": blocking_response.task_id,
            "id": blocking_response.data.id,
            "message_id": blocking_response.data.message_id,
            "conversation_id": blocking_response.data.conversation_id,
            "mode": blocking_response.data.mode,
            "answer": blocking_response.data.answer,
            "metadata": blocking_response.data.metadata,
            "created_at": blocking_response.data.created_at,
        }

        return response

    @classmethod
    def convert_blocking_simple_response(cls, blocking_response: ChatbotAppBlockingResponse) -> dict:  # type: ignore[override]
        """
        Convert blocking simple response.
        :param blocking_response: blocking response
        :return:
        """
        response = cls.convert_blocking_full_response(blocking_response)

        metadata = response.get("metadata", {})
        response["metadata"] = cls._get_simple_metadata(metadata)

        return response

    @classmethod
    def convert_stream_full_response(
        cls, stream_response: Generator[AppStreamResponse, None, None]
    ) -> Generator[dict | str, None, None]:
        """
        Convert stream full response.
        :param stream_response: stream response
        :return:
        """
        for chunk in stream_response:
            chunk = cast(ChatbotAppStreamResponse, chunk)
            sub_stream_response = chunk.stream_response

            if isinstance(sub_stream_response, PingStreamResponse):
                yield "ping"
                continue

            response_chunk = {
                "event": sub_stream_response.event.value,
                "conversation_id": chunk.conversation_id,
                "message_id": chunk.message_id,
                "created_at": chunk.created_at,
            }

            if isinstance(sub_stream_response, ErrorStreamResponse):
                data = cls._error_to_stream_response(sub_stream_response.err)
                response_chunk.update(data)
            else:
                response_chunk.update(sub_stream_response.to_dict())
            yield response_chunk

    @classmethod
    def convert_stream_simple_response(
        cls, stream_response: Generator[AppStreamResponse, None, None]
    ) -> Generator[dict | str, None, None]:
        """
        Convert stream simple response.
        :param stream_response: stream response
        :return:
        """
        for chunk in stream_response:
            chunk = cast(ChatbotAppStreamResponse, chunk)
            sub_stream_response = chunk.stream_response

            if isinstance(sub_stream_response, PingStreamResponse):
                yield "ping"
                continue

            response_chunk = {
                "event": sub_stream_response.event.value,
                "conversation_id": chunk.conversation_id,
                "message_id": chunk.message_id,
                "created_at": chunk.created_at,
            }

            if isinstance(sub_stream_response, MessageEndStreamResponse):
                sub_stream_response_dict = sub_stream_response.to_dict()
                metadata = sub_stream_response_dict.get("metadata", {})
                sub_stream_response_dict["metadata"] = cls._get_simple_metadata(metadata)
                response_chunk.update(sub_stream_response_dict)
            if isinstance(sub_stream_response, ErrorStreamResponse):
                data = cls._error_to_stream_response(sub_stream_response.err)
                response_chunk.update(data)
            else:
                response_chunk.update(sub_stream_response.to_dict())

            yield response_chunk
