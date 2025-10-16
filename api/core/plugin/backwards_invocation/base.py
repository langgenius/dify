from collections.abc import Generator, Mapping
from typing import Generic, TypeVar

from pydantic import BaseModel


class BaseBackwardsInvocation:
    @classmethod
    def convert_to_event_stream(cls, response: Generator[BaseModel | Mapping | str, None, None] | BaseModel | Mapping):
        if isinstance(response, Generator):
            try:
                for chunk in response:
                    if isinstance(chunk, BaseModel | dict):
                        yield BaseBackwardsInvocationResponse(data=chunk).model_dump_json().encode()
            except Exception as e:
                error_message = BaseBackwardsInvocationResponse(error=str(e)).model_dump_json()
                yield error_message.encode()
        else:
            yield BaseBackwardsInvocationResponse(data=response).model_dump_json().encode()


T = TypeVar("T", bound=dict | Mapping | str | bool | int | BaseModel)


class BaseBackwardsInvocationResponse(BaseModel, Generic[T]):
    data: T | None = None
    error: str = ""
