"""How a stream operation answers: its SSE stream, or its run as a background job.

A ``Kind.SSE`` handler returns its raw SSE frames, never a response. With the request header
``X-Dify-Stream-Result: job`` the handler runs as the ``launch`` of ``RunJobService.start`` and the answer is the
job's state; with any other value, or none, the frames stream back. Handlers hand back frames because Flask's
``stream_with_context`` ties a response to the request thread, and a job's reader reads on a thread of its own.
"""

from __future__ import annotations

import inspect
from collections.abc import Callable, Iterable, Mapping
from enum import StrEnum
from functools import wraps
from types import MappingProxyType
from typing import Any, Final

from flask import Response, request, stream_with_context
from pydantic import BaseModel, ValidationError

from constants import HEADER_NAME_IDEMPOTENCY_KEY, HEADER_NAME_JOB_WAIT_SECONDS, HEADER_NAME_STREAM_RESULT
from controllers.openapi._errors import refuse_invalid_request
from controllers.openapi.auth.spec import AdmissionContext
from services.run_job import JobStartFields

SSE_MIMETYPE: Final = "text/event-stream"
STREAM_HEADERS: Final[Mapping[str, str]] = MappingProxyType({"Cache-Control": "no-cache", "Connection": "keep-alive"})
# A job belongs to one app and one caller, so a stream operation needs the app named in its path and the ORM
# context that carries the caller.
APP_PATH_PARAM: Final = "app_id"
JOB_CONTEXT: Final[AdmissionContext] = "orm"
_LOC: Final = "loc"


class StreamResult(StrEnum):
    """Values of the stream-result header: how a stream operation answers."""

    JOB = "job"


# The job's start fields and the request header each one arrives in.
JOB_FIELD_HEADERS: Final[Mapping[str, str]] = MappingProxyType(
    {"wait_seconds": HEADER_NAME_JOB_WAIT_SECONDS, "idempotency_key": HEADER_NAME_IDEMPOTENCY_KEY}
)
if set(JOB_FIELD_HEADERS) != set(JobStartFields.model_fields):
    raise TypeError("JOB_FIELD_HEADERS must name every field of JobStartFields")


def check_stream_op(
    view: Callable[..., Any],
    *,
    context: AdmissionContext | None,
    query: type[BaseModel] | None,
    body: type[BaseModel] | None,
) -> None:
    """Refuse, at import, a stream operation that could not run as a job.

    Postcondition: returns when the handler takes the ORM context and an ``app_id`` path parameter and no input
    field shares a name with a job start field; raises TypeError saying which rule failed otherwise.
    """
    name = view.__qualname__
    if context != JOB_CONTEXT:
        raise TypeError(f"{name} streams, so it must take the {JOB_CONTEXT!r} context: a job needs its caller")
    if APP_PATH_PARAM not in inspect.signature(view).parameters:
        raise TypeError(f"{name} streams, so it must take {APP_PATH_PARAM!r}: a job belongs to one app")
    taken = sorted(_input_names(query, body) & set(JOB_FIELD_HEADERS))
    if taken:
        raise TypeError(f"{name} streams, so its input may not use the job start field names {taken}")


def _input_names(*models: type[BaseModel] | None) -> set[str]:
    """Postcondition: the field names of every model given."""
    return {name for model in models if model is not None for name in model.model_fields}


def stream_response(frames: Iterable[str]) -> Response:
    """Stream a run's frames to the caller.

    Precondition: inside the request that produced frames.
    Postcondition: a 200 ``text/event-stream`` response with ``STREAM_HEADERS`` that sends the frames as they come,
    inside this request's context.
    """
    return Response(stream_with_context(iter(frames)), mimetype=SSE_MIMETYPE, headers=dict(STREAM_HEADERS))


def job_start_fields() -> JobStartFields:
    """Read a job's start fields from the request headers.

    Precondition: inside a request.
    Postcondition: the validated fields; an absent header leaves its field's default. A bad value aborts with the
    422 every request validation answers, each error located at its header's name.
    """
    headers = request.headers
    present = {field: headers[header] for field, header in JOB_FIELD_HEADERS.items() if header in headers}
    try:
        return JobStartFields.model_validate(present)
    except ValidationError as exc:
        errors = exc.errors(include_url=False, include_input=False, include_context=False)
        refuse_invalid_request([{**error, _LOC: _header_loc(error[_LOC])} for error in errors])


def _header_loc(loc: tuple[int | str, ...]) -> tuple[int | str, ...]:
    """Postcondition: loc with its field name replaced by the header that carries it."""
    field, *rest = loc
    return (JOB_FIELD_HEADERS[str(field)], *rest)


def answers_stream_or_job(op: str) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    """Wrap a stream operation's handler so it answers its stream, or its run as a job when asked.

    Precondition: the handler takes ``ctx`` (see ``check_stream_op``) and returns its run's SSE frames.
    Postcondition: without ``X-Dify-Stream-Result: job``, the handler's frames as ``stream_response``. With it, the
    job start fields are read from the headers first, so a bad value answers 422 and the handler never runs; then
    ``jobs.start_job`` runs the handler as the launch of a job of op and its answer is returned.
    """

    def decorator(view: Callable[..., Any]) -> Callable[..., Any]:
        @wraps(view)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            if request.headers.get(HEADER_NAME_STREAM_RESULT) != StreamResult.JOB:
                return stream_response(view(*args, **kwargs))
            fields = job_start_fields()
            # `jobs` imports `_contract`, which imports this module.
            from controllers.openapi.jobs import start_job

            return start_job(kwargs["ctx"], op=op, fields=fields, launch=lambda: view(*args, **kwargs))

        return wrapper

    return decorator
