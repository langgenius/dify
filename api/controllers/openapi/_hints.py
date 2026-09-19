"""Server-built next steps (`hints`) for the /openapi/v1 surface.

A hint is a normal response field, and the handler that owns the target op composes it.
This module holds only the two mechanics a handler cannot do inline: the next page of a
list (the contract layer knows the op id and raw query) and adding hints to one kind of
SSE event in a stream the handler only holds as a generator. Neither knows any op id;
the caller passes it.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Generator, Iterable, Mapping
from typing import Any, Final, Protocol, runtime_checkable

from pydantic import BaseModel

from controllers.openapi._models import Hint, Hinted, PageQuery, PaginationEnvelope

# The core's SSE framing and its event key; it exports no name for either.
_DATA_PREFIX: Final = "data: "
_EVENT_FIELD: Final = "event"

HintBuilder = Callable[[Mapping[str, Any]], list[Hint]]


@runtime_checkable
class _ClosableStream(Protocol):
    def close(self) -> None: ...


def next_page_hint(
    *, op: str, path_args: Mapping[str, Any], query: BaseModel | None, envelope: PaginationEnvelope[Any]
) -> Hint | None:
    if not envelope.has_more:
        return None
    params: dict[str, Any] = dict(path_args)
    if query is not None:
        params |= query.model_dump(exclude_none=True)
    params |= PageQuery(page=envelope.page + 1, limit=envelope.limit).model_dump()
    return Hint(summary="Next page", op=op, input=params)


def attach_stream_hints(events: Iterable[str], *, event: str, build: HintBuilder) -> Generator[str, None, None]:
    """Yield the source SSE chunks, adding a top-level `hints` list to every `event` that `build` hints.

    `event: ping` chunks, other event kinds, and events `build` returns nothing for are
    yielded as the original string so the wire bytes stay identical. Only chunks that can
    be the wanted event are parsed — every other chunk of a long run is passed through on
    a substring test. Closing this generator closes the source (the run stream is a
    `RateLimitGenerator` that releases its slot on close).
    """
    try:
        for chunk in events:
            if not chunk.startswith(_DATA_PREFIX) or event not in chunk:
                yield chunk
                continue
            parsed = json.loads(chunk[len(_DATA_PREFIX) :])
            if parsed.get(_EVENT_FIELD) != event:
                yield chunk
                continue
            hints = build(parsed)
            if not hints:
                yield chunk
                continue
            parsed |= Hinted(hints=hints).model_dump(exclude_none=True)
            yield f"{_DATA_PREFIX}{json.dumps(parsed, ensure_ascii=False)}\n\n"
    finally:
        if isinstance(events, _ClosableStream):
            events.close()
