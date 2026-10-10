"""Serialize generation responses at transport boundaries."""

from collections.abc import Generator, Mapping
from typing import Union

from libs.orjson import orjson_dumps


def convert_to_event_stream(generator: Union[Mapping, Generator[Mapping | str, None, None]]):
    """
    Convert messages into event stream
    """
    if isinstance(generator, dict):
        return generator
    else:

        def gen():
            for message in generator:
                if isinstance(message, Mapping | dict):
                    yield f"data: {orjson_dumps(message)}\n\n"
                else:
                    yield f"event: {message}\n\n"

        return gen()
