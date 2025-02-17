from collections.abc import Generator, Mapping
from typing import Generic, Optional, TypeVar

from pydantic import BaseModel


class BaseBackwardsInvocation:
    @classmethod
    def convert_to_event_stream(cls, response: Generator[BaseModel | Mapping | str, None, None] | BaseModel | Mapping):
        if isinstance(response, Generator):
            try:
                for chunk in response:
                    if isinstance(chunk, BaseModel | dict):
                        yield BaseBackwardsInvocationResponse(data=chunk).model_dump_json().encode() + b"\n\n"
                    elif isinstance(chunk, str):
                        yield f"event: {chunk}\n\n".encode()
            except Exception as e:
                error_message = BaseBackwardsInvocationResponse(error=str(e)).model_dump_json()
                yield f"{error_message}\n\n".encode()
        else:
            yield BaseBackwardsInvocationResponse(data=response).model_dump_json().encode() + b"\n\n"


T = TypeVar("T", bound=dict | Mapping | str | bool | int | BaseModel)


class BaseBackwardsInvocationResponse(BaseModel, Generic[T]):
    data: Optional[T] = None
    error: str = ""
