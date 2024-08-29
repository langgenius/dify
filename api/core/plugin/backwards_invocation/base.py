import json
from collections.abc import Generator

from pydantic import BaseModel


class BaseBackwardsInvocation:
    @classmethod
    def convert_to_event_stream(cls, response: Generator[BaseModel | dict | str, None, None] | BaseModel | dict):
        if isinstance(response, Generator):
            for chunk in response:
                if isinstance(chunk, BaseModel):
                    yield chunk.model_dump_json().encode() + b'\n\n'
                elif isinstance(chunk, str):
                    yield f"event: {chunk}\n\n".encode()
                else:
                    yield json.dumps(chunk).encode() + b'\n\n'
        else:
            if isinstance(response, BaseModel):
                yield response.model_dump_json().encode() + b'\n\n'
            else:
                yield json.dumps(response).encode() + b'\n\n'
