"""Server-sent event frames, and releasing optional stream resources without replacing an invocation error."""

import json
import logging
from collections.abc import Mapping
from typing import Any, Final, Protocol, runtime_checkable

logger = logging.getLogger(__name__)

DATA_PREFIX: Final = "data: "


@runtime_checkable
class _Closable(Protocol):
    def close(self) -> None: ...


def close_stream(stream: object) -> None:
    """Close resource-owning streams; plain iterables need no cleanup."""
    if isinstance(stream, _Closable):
        try:
            stream.close()
        except Exception:
            logger.warning("Failed to close stream", exc_info=True)


def decode_data_frame(frame: str) -> dict[str, Any] | None:
    """Postcondition: the JSON object of a `data:` frame; None for any other frame or a payload that is not one."""
    if not frame.startswith(DATA_PREFIX):
        return None
    try:
        payload = json.loads(frame[len(DATA_PREFIX) :])
    except ValueError:
        return None
    if not isinstance(payload, dict):
        return None
    return payload


def encode_data_frame(payload: Mapping[str, Any]) -> str:
    """Postcondition: a `data:` frame that decode_data_frame reads back as payload."""
    return f"{DATA_PREFIX}{json.dumps(payload, ensure_ascii=False)}\n\n"
