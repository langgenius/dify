from abc import ABC, abstractmethod
from collections.abc import Generator
from typing import Union

from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.task_entities import AppBlockingResponse, AppStreamResponse


class AppGenerateResponseConverter(ABC):
    _blocking_response_type: type[AppBlockingResponse]

    @classmethod
    def convert(cls, response: Union[
        AppBlockingResponse,
        Generator[AppStreamResponse, None, None]
    ], invoke_from: InvokeFrom) -> Union[
        dict,
        Generator[str, None, None]
    ]:
        if invoke_from in [InvokeFrom.DEBUGGER, InvokeFrom.EXPLORE]:
            if isinstance(response, cls._blocking_response_type):
                return cls.convert_blocking_full_response(response)
            else:
                for chunk in cls.convert_stream_full_response(response):
                    yield f'data: {chunk}\n\n'
        else:
            if isinstance(response, cls._blocking_response_type):
                return cls.convert_blocking_simple_response(response)
            else:
                for chunk in cls.convert_stream_simple_response(response):
                    yield f'data: {chunk}\n\n'

    @classmethod
    @abstractmethod
    def convert_blocking_full_response(cls, blocking_response: AppBlockingResponse) -> dict:
        raise NotImplementedError

    @classmethod
    @abstractmethod
    def convert_blocking_simple_response(cls, blocking_response: AppBlockingResponse) -> dict:
        raise NotImplementedError

    @classmethod
    @abstractmethod
    def convert_stream_full_response(cls, stream_response: Generator[AppStreamResponse, None, None]) \
            -> Generator[str, None, None]:
        raise NotImplementedError

    @classmethod
    @abstractmethod
    def convert_stream_simple_response(cls, stream_response: Generator[AppStreamResponse, None, None]) \
            -> Generator[str, None, None]:
        raise NotImplementedError

    @classmethod
    def _get_simple_metadata(cls, metadata: dict) -> dict:
        """
        Get simple metadata.
        :param metadata: metadata
        :return:
        """
        # show_retrieve_source
        if 'retriever_resources' in metadata:
            metadata['retriever_resources'] = []
            for resource in metadata['retriever_resources']:
                metadata['retriever_resources'].append({
                    'segment_id': resource['segment_id'],
                    'position': resource['position'],
                    'document_name': resource['document_name'],
                    'score': resource['score'],
                    'content': resource['content'],
                })

        # show annotation reply
        if 'annotation_reply' in metadata:
            del metadata['annotation_reply']

        # show usage
        if 'usage' in metadata:
            del metadata['usage']

        return metadata