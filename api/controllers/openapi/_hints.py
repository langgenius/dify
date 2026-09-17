"""Server-built next steps (`hints`) for the /openapi/v1 surface.

A hint is a normal response field. Handlers fill it where they can see the state; two
helpers cover the spots a handler cannot see: the next page of a list (the contract
layer knows the op id and raw query) and the form on a `human_input_required` event
(the handler only holds a generator).
"""

from __future__ import annotations

import json
from collections.abc import Generator, Iterable, Mapping
from typing import Any, Final

from pydantic import BaseModel

from controllers.openapi._models import Hint, PaginationEnvelope
from core.app.entities.task_entities import StreamEvent

HINTS_FIELD: Final = "hints"
IMPORT_CONFIRM_OP: Final = "console_app.dsl.import_confirm"
FORM_SUBMIT_OP: Final = "run.form.submit"

NEXT_PAGE_SUMMARY: Final = "Next page"
PAGE_FIELD: Final = "page"
LIMIT_FIELD: Final = "limit"

_DATA_PREFIX: Final = "data: "
_HINTED_EVENT: Final = StreamEvent.HUMAN_INPUT_REQUIRED.value


def next_page_hint(
    *, op: str, path_args: Mapping[str, Any], query: BaseModel | None, envelope: PaginationEnvelope[Any]
) -> Hint | None:
    if not envelope.has_more:
        return None
    params: dict[str, Any] = dict(path_args)
    if query is not None:
        params |= query.model_dump(exclude_none=True)
    params[PAGE_FIELD] = envelope.page + 1
    params[LIMIT_FIELD] = envelope.limit
    return Hint(summary=NEXT_PAGE_SUMMARY, op=op, input=params)


def form_hints(*, app_id: str, data: Mapping[str, Any]) -> list[Hint]:
    form_token = data.get("form_token")
    if not form_token:
        return []
    fields = [dict(field) for field in data.get("inputs") or []]
    blank = {field["output_variable_name"]: None for field in fields if "output_variable_name" in field}
    return [
        Hint(
            summary=str(action.get("title") or action["id"]),
            op=FORM_SUBMIT_OP,
            input={"app_id": app_id, "form_token": form_token, "action": action["id"], "inputs": dict(blank)},
            form=fields,
        )
        for action in data.get("actions") or []
    ]


def _hints_for_event(event: Mapping[str, Any], *, app_id: str) -> list[Hint]:
    if event.get("event") != StreamEvent.HUMAN_INPUT_REQUIRED.value:
        return []
    return form_hints(app_id=app_id, data=event.get("data") or {})


def attach_stream_hints(events: Iterable[str], *, app_id: str) -> Generator[str, None, None]:
    """Yield the source SSE chunks, adding a top-level `hints` list to events that have a next step.

    Chunks that are not `data:` JSON, and events without hints, are yielded as the original
    string so the wire bytes stay identical. Only the one event kind that carries a hint is
    parsed — every other chunk of a long run is passed through on a substring test. Closing
    this generator closes the source (the run stream is a `RateLimitGenerator` that releases
    its slot on close).
    """
    try:
        for chunk in events:
            if not chunk.startswith(_DATA_PREFIX) or _HINTED_EVENT not in chunk:
                yield chunk
                continue
            try:
                event = json.loads(chunk[len(_DATA_PREFIX) :])
            except ValueError:
                yield chunk
                continue
            if not isinstance(event, dict):
                yield chunk
                continue
            hints = _hints_for_event(event, app_id=app_id)
            if not hints:
                yield chunk
                continue
            event[HINTS_FIELD] = [hint.model_dump(exclude_none=True) for hint in hints]
            yield f"{_DATA_PREFIX}{json.dumps(event, ensure_ascii=False)}\n\n"
    finally:
        close = getattr(events, "close", None)
        if close is not None:
            close()
