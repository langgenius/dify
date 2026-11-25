"""Run one ``/openapi/v1`` operation in-process, as the MCP endpoint's tool calls do.

A tool call names an op and a flat input. This module turns that into one HTTP
request against the same Flask app and returns the operation's own response, so
guards, rate limits, the PAT audit record and error bodies run unchanged.

Invariant: a call either runs exactly the op it names, or raises before any
request is handled. Path values come from an agent, so two guards keep a value
from steering the request to another op: no value may hold ``/``, ``?`` or ``#``,
and the built path must resolve, in the app's url map, to the op's own rule.
The proved path is percent-encoded for the inner request, because the WSGI
environ decodes it once; the op therefore sees exactly the path that was proved
(``%2F`` in a value reaches the op as text, never as a separator). Path and
query text must encode as UTF-8 (a lone surrogate is legal JSON but not), or the
call is refused before anything runs.

A tool call answers one JSON result, so every inner request asks a stream op for a
job (``X-Dify-Stream-Result: job``), and the input fields a stream op takes as
headers (its job's wait and idempotency key) travel as those headers.
"""

from __future__ import annotations

import contextvars
import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from http import HTTPMethod
from typing import Any, Final
from urllib.parse import quote

from flask import Flask, current_app, request
from flask.globals import app_ctx
from werkzeug.datastructures import Headers
from werkzeug.exceptions import HTTPException
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Response

from constants import HEADER_NAME_STREAM_RESULT
from controllers.openapi._catalog import (
    _QUERY_METHODS,
    CATALOG_HEADER,
    Bind,
    CatalogOp,
    RegisteredOp,
    current_catalog,
    op_registry,
)
from controllers.openapi._stream_result import JOB_FIELD_HEADERS, StreamResult
from controllers.openapi.auth.spec import Kind

AUTHORIZATION_HEADER: Final = "Authorization"
TRACE_ID_HEADER: Final = "X-Trace-Id"
ACCEPT_HEADER: Final = "Accept"
JSON_CONTENT_TYPE: Final = "application/json"
_UNSAFE_PATH_CHARS: Final = frozenset("/?#")
_REMOTE_ADDR_KEY: Final = "REMOTE_ADDR"
_URL_ENCODING: Final = "utf-8"
_PLACEHOLDER_RE: Final = re.compile(r"\{(\w+)\}")
# Kept unescaped when the proved path is encoded: the separators the template itself holds.
_PATH_SAFE: Final = "/"
# The input fields an op of each kind takes as request headers, and the header each one goes in.
_HEADER_FIELDS_BY_KIND: Final[Mapping[str, Mapping[str, str]]] = {Kind.SSE.value: JOB_FIELD_HEADERS}
_NO_HEADER_FIELDS: Final[Mapping[str, str]] = {}


@dataclass(frozen=True, slots=True, kw_only=True)
class OpCall:
    """One op to run: its catalog id, its flat input, and what the caller sent."""

    op: str
    input: Mapping[str, Any]
    authorization: str | None  # the caller's Authorization header value, forwarded as is
    trace_id: str | None


@dataclass(frozen=True, slots=True, kw_only=True)
class OpResult:
    """The op's response as it left the app."""

    status: int
    body: Any  # parsed JSON, or None when the response is not JSON
    headers: Mapping[str, str]
    is_json: bool


class UnknownOp(Exception):  # noqa: N818
    """The catalog of this app has no op by that id."""


class UnsafePathValue(Exception):  # noqa: N818
    """A path value is missing, is not a string, or holds ``/``, ``?`` or ``#``; or a
    path or query text does not encode as UTF-8, so it cannot be placed in the URL."""


class UnsafeHeaderValue(Exception):  # noqa: N818
    """An input field that travels as a request header holds text a header cannot carry."""


class FileInputUnsupported(Exception):  # noqa: N818
    """The input fills a field the op binds as a file upload."""


class RouteMismatch(Exception):  # noqa: N818
    """The built path does not resolve to the op's own rule."""


@dataclass(frozen=True, slots=True)
class _Request:
    """The inner request split by bind: the filled path, the query, the JSON body (None for query-bound methods)
    and the input fields the op takes as headers, by header name."""

    path: str
    query: dict[str, Any]
    body: dict[str, Any] | None
    headers: dict[str, str]


def call_op(call: OpCall) -> OpResult:
    """Run ``call.op`` through the app's WSGI stack.

    Precondition: runs inside a Flask request. Postcondition: the operation ran
    exactly as for an outside HTTP request, or one of ``UnknownOp``,
    ``FileInputUnsupported``, ``UnsafePathValue``, ``UnsafeHeaderValue`` and ``RouteMismatch`` was raised
    and nothing ran. The outer request's context variables and ``flask.g`` are
    untouched either way.
    """
    registered = op_registry().get(call.op)
    if registered is None:
        raise UnknownOp(call.op)
    method = HTTPMethod(registered.entry["method"])
    built = _split_input(registered.entry, method, call.input)
    _prove_route(registered, method, built.path)
    environ = _environ(call, method, built)
    response = contextvars.copy_context().run(_run, app_ctx.app, environ)
    return _result(response)


def _split_input(entry: CatalogOp, method: HTTPMethod, input: Mapping[str, Any]) -> _Request:
    """Place each input key where the op's bind table says.

    Precondition: ``entry`` is a catalog entry. Postcondition: returns the filled
    path, the query, for body-bound methods the JSON body, and the fields the op's
    kind takes as headers (``_HEADER_FIELDS_BY_KIND``; a null one is left out). Keys
    the bind table does not list go to the body for body-bound methods and to the
    query otherwise, so the op's own validation answers them. Raises
    ``FileInputUnsupported`` when a file-bound key is present, ``UnsafePathValue`` for
    a bad path value and ``UnsafeHeaderValue`` for a bad header value.
    """
    body_bound = method not in _QUERY_METHODS
    default = Bind.BODY if body_bound else Bind.QUERY
    bind = entry["bind"]
    header_fields = _HEADER_FIELDS_BY_KIND.get(entry["kind"], _NO_HEADER_FIELDS)
    headers = {
        header_fields[name]: _header_value(name, value)
        for name, value in input.items()
        if name in header_fields and value is not None
    }
    parts: dict[Bind, dict[str, Any]] = {kind: {} for kind in Bind}
    for name, value in input.items():
        if name not in header_fields:
            parts[Bind(bind.get(name, default))][name] = value
    if parts[Bind.FILE]:
        raise FileInputUnsupported(sorted(parts[Bind.FILE]))
    path_values = parts[Bind.PATH]
    path = _PLACEHOLDER_RE.sub(lambda match: _safe_path_value(match.group(1), path_values), entry["path"])
    _check_query_text(parts[Bind.QUERY])
    body = parts[Bind.BODY] if body_bound else None
    return _Request(path=path, query=parts[Bind.QUERY], body=body, headers=headers)


def _header_value(name: str, value: Any) -> str:
    """The text a header carries for input field ``name``.

    Postcondition: a string as it is, any other value as compact JSON, so the op's own validation answers it;
    raises ``UnsafeHeaderValue`` when the text is not printable ASCII, which a header cannot carry.
    """
    text = value if isinstance(value, str) else json.dumps(value, separators=(",", ":"))
    if not text.isascii():
        raise UnsafeHeaderValue(f"{name}: use printable ASCII text")
    if not text.isprintable():
        raise UnsafeHeaderValue(f"{name}: use printable ASCII text")
    return text


def _safe_path_value(name: str, values: Mapping[str, Any]) -> str:
    """The value for placeholder ``name``.

    Postcondition: returns a ``str`` free of ``/``, ``?`` and ``#``; raises
    ``UnsafePathValue`` when it is absent, not a string, or holds one of them.
    """
    value = values.get(name)
    if not isinstance(value, str):
        raise UnsafePathValue(f"{name}: expected a string")
    if _UNSAFE_PATH_CHARS & set(value):
        raise UnsafePathValue(f"{name}: may not contain '/', '?' or '#'")
    if not _is_utf8_text(value):
        raise UnsafePathValue(f"{name}: not valid UTF-8 text")
    return value


def _check_query_text(query: Mapping[str, Any]) -> None:
    """Refuse query text the URL cannot carry.

    Postcondition: returns when every key, and every string value or list item,
    encodes as UTF-8; raises ``UnsafePathValue`` naming the first key that does not.
    Other values are left for werkzeug to stringify and the op to validate.
    """
    bad = [name for name, value in query.items() if not all(map(_is_utf8_text, _query_texts(name, value)))]
    if bad:
        raise UnsafePathValue(f"{bad[0]!r}: not valid UTF-8 text")


def _query_texts(name: str, value: Any) -> list[str]:
    """Postcondition: the key plus the string values werkzeug will encode for it."""
    items = value if isinstance(value, (list, tuple)) else [value]
    return [name, *(item for item in items if isinstance(item, str))]


def _is_utf8_text(text: str) -> bool:
    """Postcondition: True when ``text`` encodes as UTF-8 (no lone surrogates)."""
    try:
        text.encode(_URL_ENCODING)
    except UnicodeEncodeError:
        return False
    return True


def _prove_route(registered: RegisteredOp, method: HTTPMethod, path: str) -> None:
    """Check that ``method path`` resolves to the op's own rule.

    Precondition: an app context is pushed and ``path`` is the decoded path the
    inner request will carry. Postcondition: returns when the url map picks the
    op's rule; raises ``RouteMismatch`` for another rule, a redirect or no match.
    """
    try:
        matched, _ = current_app.url_map.bind("").match(path, method=method, return_rule=True)
    except HTTPException as exc:
        raise RouteMismatch(f"{method} {path} resolves to no rule") from exc
    if matched is not registered.rule:
        raise RouteMismatch(f"{method} {path} resolves to {matched.rule}, not to {registered.spec.catalog.op}")


def _environ(call: OpCall, method: HTTPMethod, built: _Request) -> dict[str, Any]:
    """The WSGI environ for the inner request.

    Precondition: runs inside the outer Flask request. Postcondition: ``PATH_INFO``
    equals ``built.path`` (the builder decodes the encoded path once); a list query
    value becomes a repeated parameter; the body, when present, is JSON;
    ``REMOTE_ADDR`` is the outer request's, as already resolved by any proxy
    middleware (forwarding headers are not copied, so nothing resolves twice).
    The inner request carries the outer request's scheme and host, so links an op builds
    from ``request.url_root`` point at the server the caller reached.
    Headers: the caller's Authorization and trace id when given, the current
    catalog fingerprint, ``Accept: application/json``, ``X-Dify-Stream-Result: job``
    so a stream op answers its job's state, and the input fields the op takes as headers.
    """
    _, fingerprint = current_catalog()
    headers = Headers({CATALOG_HEADER: fingerprint, ACCEPT_HEADER: JSON_CONTENT_TYPE, **built.headers})
    headers[HEADER_NAME_STREAM_RESULT] = StreamResult.JOB
    if call.authorization is not None:
        headers[AUTHORIZATION_HEADER] = call.authorization
    if call.trace_id is not None:
        headers[TRACE_ID_HEADER] = call.trace_id
    builder = EnvironBuilder(
        base_url=request.host_url,
        path=quote(built.path, safe=_PATH_SAFE),
        method=method,
        query_string=built.query,
        json=built.body,
        headers=headers,
        environ_overrides={_REMOTE_ADDR_KEY: request.remote_addr},
    )
    try:
        return builder.get_environ()
    finally:
        builder.close()


def _run(app: Flask, environ: dict[str, Any]) -> Response:
    """Run the request through ``app`` and read its whole body.

    Precondition: called in a copied context, so context variables the inner
    request sets stay in the copy. Postcondition: the response is buffered. A fresh
    app context is pushed first: Flask reuses an already pushed one for a request
    of the same app, which would share the outer request's ``flask.g``.
    """
    with app.app_context():
        return Response.from_app(app.wsgi_app, environ, buffered=True)


def _result(response: Response) -> OpResult:
    """Postcondition: ``body`` is the parsed JSON when the response says JSON and parses, else None."""
    is_json = response.is_json
    body = response.get_json(silent=True) if is_json else None
    return OpResult(status=response.status_code, body=body, headers=dict(response.headers), is_json=is_json)
