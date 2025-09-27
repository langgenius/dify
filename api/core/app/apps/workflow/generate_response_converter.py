from collections.abc import Generator
from typing import cast

from core.app.apps.base_app_generate_response_converter import AppGenerateResponseConverter
from core.app.entities.task_entities import (
    AppStreamResponse,
    ErrorStreamResponse,
    NodeFinishStreamResponse,
    NodeStartStreamResponse,
    PingStreamResponse,
    WorkflowAppBlockingResponse,
    WorkflowAppStreamResponse,
)


class WorkflowAppGenerateResponseConverter(AppGenerateResponseConverter):
    _blocking_response_type = WorkflowAppBlockingResponse

    @classmethod
    def convert_blocking_full_response(cls, blocking_response: WorkflowAppBlockingResponse):  # type: ignore[override]
        """
        Convert blocking full response.
        :param blocking_response: blocking response
        :return:
        """
        return blocking_response.model_dump()

    @classmethod
    def convert_blocking_simple_response(cls, blocking_response: WorkflowAppBlockingResponse):  # type: ignore[override]
        """
        Convert blocking simple response.
        :param blocking_response: blocking response
        :return:
        """
        return cls.convert_blocking_full_response(blocking_response)

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
            chunk = cast(WorkflowAppStreamResponse, chunk)
            sub_stream_response = chunk.stream_response

            if isinstance(sub_stream_response, PingStreamResponse):
                yield "ping"
                continue

            response_chunk: dict[str, object] = {
                "event": sub_stream_response.event.value,
                "workflow_run_id": chunk.workflow_run_id,
            }

            if isinstance(sub_stream_response, ErrorStreamResponse):
                data = cls._error_to_stream_response(sub_stream_response.err)
                response_chunk.update(data)
            else:
                response_chunk.update(sub_stream_response.model_dump(mode="json"))
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
            chunk = cast(WorkflowAppStreamResponse, chunk)
            sub_stream_response = chunk.stream_response

            if isinstance(sub_stream_response, PingStreamResponse):
                yield "ping"
                continue

            response_chunk: dict[str, object] = {
                "event": sub_stream_response.event.value,
                "workflow_run_id": chunk.workflow_run_id,
            }

            if isinstance(sub_stream_response, ErrorStreamResponse):
                data = cls._error_to_stream_response(sub_stream_response.err)
                response_chunk.update(data)
            elif isinstance(sub_stream_response, NodeStartStreamResponse | NodeFinishStreamResponse):
                response_chunk.update(sub_stream_response.to_ignore_detail_dict())
            else:
                response_chunk.update(sub_stream_response.model_dump(mode="json"))
            yield response_chunk
