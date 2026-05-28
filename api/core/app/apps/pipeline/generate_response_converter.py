from collections.abc import Generator
from typing import Any, cast

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


class WorkflowAppGenerateResponseConverter(AppGenerateResponseConverter[WorkflowAppBlockingResponse]):
    @classmethod
    def convert_blocking_full_response(cls, blocking_response: WorkflowAppBlockingResponse) -> dict[str, object]:
        """
        Convert blocking full response.
        :param blocking_response: blocking response
        :return:
        """
        return dict(blocking_response.model_dump())

    @classmethod
    def convert_blocking_simple_response(cls, blocking_response: WorkflowAppBlockingResponse) -> dict[str, object]:
        """
        Convert blocking simple response.
        :param blocking_response: blocking response
        :return:
        """
        return cls.convert_blocking_full_response(blocking_response)

    @classmethod
    def convert_stream_full_response(
        cls, stream_response: Generator[AppStreamResponse, None, None]
    ) -> Generator[dict[str, Any] | str, None, None]:
        """
        Convert stream full response.
        :param stream_response: stream response
        :return:
        """
        for chunk in stream_response:
            chunk = cast(WorkflowAppStreamResponse, chunk)
            sub_stream_response = chunk.stream_response

            match sub_stream_response:
                case PingStreamResponse():
                    yield "ping"
                    continue
                case ErrorStreamResponse():
                    response_chunk = {
                        "event": sub_stream_response.event.value,
                        "workflow_run_id": chunk.workflow_run_id,
                    }
                    data = cls._error_to_stream_response(sub_stream_response.err)
                    response_chunk.update(cast(dict, data))
                case _:
                    response_chunk = {
                        "event": sub_stream_response.event.value,
                        "workflow_run_id": chunk.workflow_run_id,
                    }
                    response_chunk.update(sub_stream_response.model_dump())

            yield response_chunk

    @classmethod
    def convert_stream_simple_response(
        cls, stream_response: Generator[AppStreamResponse, None, None]
    ) -> Generator[dict[str, Any] | str, None, None]:
        """
        Convert stream simple response.
        :param stream_response: stream response
        :return:
        """
        for chunk in stream_response:
            chunk = cast(WorkflowAppStreamResponse, chunk)
            sub_stream_response = chunk.stream_response

            match sub_stream_response:
                case PingStreamResponse():
                    yield "ping"
                    continue
                case ErrorStreamResponse():
                    response_chunk = {
                        "event": sub_stream_response.event.value,
                        "workflow_run_id": chunk.workflow_run_id,
                    }
                    data = cls._error_to_stream_response(sub_stream_response.err)
                    response_chunk.update(cast(dict, data))
                case NodeStartStreamResponse() | NodeFinishStreamResponse():
                    response_chunk = {
                        "event": sub_stream_response.event.value,
                        "workflow_run_id": chunk.workflow_run_id,
                    }
                    response_chunk.update(cast(dict, sub_stream_response.to_ignore_detail_dict()))
                case _:
                    response_chunk = {
                        "event": sub_stream_response.event.value,
                        "workflow_run_id": chunk.workflow_run_id,
                    }
                    response_chunk.update(sub_stream_response.model_dump())

            yield response_chunk
