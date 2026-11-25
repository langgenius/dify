"""An op called in-process runs through the real Flask app, guards and all.

Every test calls `call_op` inside an outer `test_request_context`, the way the
MCP route will. `inner_requests` records each inner request as the app sees it,
so a refused call can be shown to have run nothing.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from contextvars import ContextVar
from dataclasses import dataclass, replace
from http import HTTPMethod

import pytest
from flask import Flask, g, request

from constants import (
    HEADER_NAME_FILE_RESULT,
    HEADER_NAME_IDEMPOTENCY_KEY,
    HEADER_NAME_JOB_WAIT_SECONDS,
    HEADER_NAME_STREAM_RESULT,
)
from controllers.openapi import _mcp_call, _transfer
from controllers.openapi._catalog import CATALOG_HEADER, catalog_for, op_registry
from controllers.openapi._errors import OpenApiErrorCode
from controllers.openapi._mcp_call import (
    FileInputUnsupported,
    OpCall,
    RouteMismatch,
    UnknownOp,
    UnsafeHeaderValue,
    UnsafePathValue,
    call_op,
)
from controllers.openapi._stream_result import StreamResult
from controllers.openapi._transfer import FileResult
from controllers.openapi.jobs import WAIT_JOB_OP
from extensions.ext_application_services import ApplicationServices
from tests.unit_tests.controllers.openapi.conftest import AdmittedWorld

_BEARER = "Bearer dfoa_admitted"
_TRACE_ID = "trace-mcp-call"
_OUTER = "outer"
_CALLER_ADDR = "203.0.113.7"
_OUTER_HOST_URL = "https://dify.example.com:8443/"
_LONE_SURROGATE = "\ud800"
_INNER = "inner"
_UNKNOWN_UPLOAD = "00000000-0000-4000-8000-000000000000"

_marker: ContextVar[str] = ContextVar("mcp_call_test_marker")


@dataclass(frozen=True, slots=True)
class _SeenRequest:
    path: str
    query: dict[str, list[str]]
    headers: dict[str, str]
    remote_addr: str | None
    host_url: str
    body: object


@pytest.fixture
def inner_requests(openapi_app: Flask) -> list[_SeenRequest]:
    """Each request the app handles, recorded before any guard runs. The hook also
    writes over `flask.g` and a context variable, so a leak reaches the outer request."""
    seen: list[_SeenRequest] = []

    @openapi_app.before_request
    def _record() -> None:  # pyright: ignore[reportUnusedFunction]
        seen.append(
            _SeenRequest(
                path=request.path,
                query={key: request.args.getlist(key) for key in request.args},
                headers=dict(request.headers),
                remote_addr=request.remote_addr,
                host_url=request.host_url,
                body=request.get_json(silent=True),
            )
        )
        g.mcp_call_marker = _INNER
        _marker.set(_INNER)

    return seen


def _call(op: str, input: dict[str, object], *, authorization: str | None = _BEARER) -> _mcp_call.OpResult:
    return call_op(OpCall(op=op, input=input, authorization=authorization, trace_id=_TRACE_ID))


def test_a_get_op_is_called_with_query_params_and_returns_its_json(
    admitted_bearer: AdmittedWorld, openapi_app: Flask, inner_requests: list[_SeenRequest]
) -> None:
    with openapi_app.test_request_context():
        result = _call("get.workspace", {"page": 1, "limit": 20})

    assert result.status == 200
    assert result.is_json is True
    assert [row["id"] for row in result.body["data"]] == [admitted_bearer.workspace_id]
    assert result.headers[CATALOG_HEADER] == catalog_for(openapi_app)[1]
    assert inner_requests[0].query == {"page": ["1"], "limit": ["20"]}


def test_path_values_fill_the_template(
    admitted_bearer: AdmittedWorld, openapi_app: Flask, inner_requests: list[_SeenRequest]
) -> None:
    with openapi_app.test_request_context():
        result = _call("get.workspace.member", {"workspace_id": admitted_bearer.workspace_id, "limit": 2})

    assert result.status == 200
    assert inner_requests[0].path == f"/openapi/v1/workspaces/{admitted_bearer.workspace_id}/members"
    assert inner_requests[0].query == {"limit": ["2"]}
    assert [row["email"] for row in result.body["data"]] == ["caller@example.com"]


@pytest.mark.usefixtures("admitted_bearer")
def test_a_list_value_is_sent_as_a_repeated_query_parameter(
    openapi_app: Flask, inner_requests: list[_SeenRequest]
) -> None:
    with openapi_app.test_request_context():
        _call("get.workspace", {"page": [1, 2]})

    assert inner_requests[0].query == {"page": ["1", "2"]}


@pytest.mark.usefixtures("admitted_bearer")
def test_a_key_outside_the_bind_table_reaches_the_op_and_is_rejected_by_it(
    openapi_app: Flask, inner_requests: list[_SeenRequest]
) -> None:
    with openapi_app.test_request_context():
        result = _call("get.workspace", {"pg": 2})

    assert inner_requests[0].query == {"pg": ["2"]}
    assert result.status == 422


@pytest.mark.usefixtures("admitted_bearer")
def test_the_inner_request_carries_the_callers_authorization_and_the_catalog_fingerprint(
    openapi_app: Flask, inner_requests: list[_SeenRequest]
) -> None:
    with openapi_app.test_request_context():
        result = _call("get.workspace", {})

    assert result.status == 200
    headers = inner_requests[0].headers
    assert headers["Authorization"] == _BEARER
    assert headers[CATALOG_HEADER] == catalog_for(openapi_app)[1]
    assert headers["X-Trace-Id"] == _TRACE_ID
    assert headers["Accept"] == "application/json"
    assert headers[HEADER_NAME_STREAM_RESULT] == StreamResult.JOB
    assert headers[HEADER_NAME_FILE_RESULT] == FileResult.TRANSFER


_RUN_WORKFLOW = "run.console_app.workflow"


def _split(op: str, input: dict[str, object]) -> _mcp_call._Request:
    entry = op_registry()[op].entry
    return _mcp_call._split_input(entry, HTTPMethod(entry["method"]), input)


def test_a_stream_op_sends_its_job_fields_as_headers_and_not_in_its_body(openapi_app: Flask) -> None:
    with openapi_app.test_request_context():
        built = _split(
            _RUN_WORKFLOW,
            {"app_id": "a1", "inputs": {}, "wait_seconds": 5, "idempotency_key": "k1", "workflow_id": None},
        )

    assert built.headers == {HEADER_NAME_JOB_WAIT_SECONDS: "5", HEADER_NAME_IDEMPOTENCY_KEY: "k1"}
    assert built.body == {"inputs": {}, "workflow_id": None}


def test_a_null_job_field_sends_no_header(openapi_app: Flask) -> None:
    with openapi_app.test_request_context():
        built = _split(_RUN_WORKFLOW, {"app_id": "a1", "idempotency_key": None})

    assert built.headers == {}
    assert built.body == {}


def test_an_op_of_another_kind_keeps_a_field_of_the_same_name_in_its_input(openapi_app: Flask) -> None:
    with openapi_app.test_request_context():
        built = _split(WAIT_JOB_OP, {"app_id": "a1", "job_id": "j1", "wait_seconds": 5})

    assert built.headers == {}
    assert built.query == {"wait_seconds": 5}


@pytest.mark.parametrize("bad", ["ключ", "k\n1"])
@pytest.mark.usefixtures("admitted_bearer")
def test_a_job_field_a_header_cannot_carry_is_refused_before_anything_runs(
    openapi_app: Flask, inner_requests: list[_SeenRequest], bad: str
) -> None:
    with openapi_app.test_request_context():
        with pytest.raises(UnsafeHeaderValue):
            _call(_RUN_WORKFLOW, {"app_id": "a1", "idempotency_key": bad})

    assert inner_requests == []


def test_without_authorization_the_op_answers_401(openapi_app: Flask, inner_requests: list[_SeenRequest]) -> None:
    with openapi_app.test_request_context():
        result = _call("get.workspace", {}, authorization=None)

    assert result.status == 401
    assert result.is_json is True
    assert "Authorization" not in inner_requests[0].headers


def test_an_unknown_op_raises(openapi_app: Flask, inner_requests: list[_SeenRequest]) -> None:
    with openapi_app.test_request_context():
        with pytest.raises(UnknownOp):
            _call("no.such.op", {})

    assert inner_requests == []


@pytest.mark.parametrize("bad", ["a/b", "a?b", "a#b", 5, None])
@pytest.mark.usefixtures("admitted_bearer")
def test_a_path_value_with_a_slash_is_refused_before_anything_runs(
    openapi_app: Flask, inner_requests: list[_SeenRequest], bad: object
) -> None:
    with openapi_app.test_request_context():
        with pytest.raises(UnsafePathValue):
            _call("describe.workspace", {"workspace_id": bad})

    assert inner_requests == []


@pytest.mark.parametrize(
    ("op", "input"),
    [
        ("describe.workspace", {"workspace_id": f"a{_LONE_SURROGATE}b"}),
        ("get.workspace", {"page": _LONE_SURROGATE}),
        ("get.workspace", {"page": ["1", _LONE_SURROGATE]}),
        ("get.workspace", {_LONE_SURROGATE: "1"}),
    ],
    ids=["path-value", "query-value", "query-list-item", "query-key"],
)
@pytest.mark.usefixtures("admitted_bearer")
def test_a_url_value_that_is_not_utf8_text_is_refused_before_anything_runs(
    openapi_app: Flask, inner_requests: list[_SeenRequest], op: str, input: dict[str, object]
) -> None:
    """A lone surrogate is legal in JSON but cannot be encoded into the URL."""
    with openapi_app.test_request_context():
        with pytest.raises(UnsafePathValue):
            _call(op, input)

    assert inner_requests == []


@pytest.mark.usefixtures("admitted_bearer")
def test_a_percent_encoded_slash_reaches_the_op_as_text(openapi_app: Flask, inner_requests: list[_SeenRequest]) -> None:
    with openapi_app.test_request_context():
        result = _call("describe.workspace", {"workspace_id": "x%2Fmembers"})

    assert inner_requests[0].path == "/openapi/v1/workspaces/x%2Fmembers"
    assert result.status == 404


def test_a_built_path_that_matches_another_rule_is_refused(
    openapi_app: Flask, monkeypatch: pytest.MonkeyPatch, inner_requests: list[_SeenRequest]
) -> None:
    with openapi_app.test_request_context():
        registry = op_registry()
        moved = replace(registry["describe.workspace"], entry=registry["get.workspace.member"].entry)
        # describe.workspace now carries the members path: the built path resolves to another rule
        monkeypatch.setattr(_mcp_call, "op_registry", lambda: {"describe.workspace": moved})
        with pytest.raises(RouteMismatch):
            _call("describe.workspace", {"workspace_id": str(uuid.uuid4())})

    assert inner_requests == []


def test_an_op_error_body_comes_back_unchanged(
    admitted_bearer: AdmittedWorld, openapi_app: Flask, inner_requests: list[_SeenRequest]
) -> None:
    with openapi_app.test_request_context():
        result = _call("describe.workspace", {"workspace_id": str(uuid.uuid4())})
    direct = admitted_bearer.client.get(
        inner_requests[0].path,
        headers={**admitted_bearer.headers, "Accept": "application/json"},
    )

    assert result.status == 404
    assert result.is_json is True
    assert {"code", "message", "status"} <= set(result.body)
    assert result.body == direct.get_json()


def test_a_file_bound_key_goes_into_the_json_body(
    admitted_bearer: AdmittedWorld,
    openapi_app: Flask,
    inner_requests: list[_SeenRequest],
    account_application_services: ApplicationServices,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(_transfer, "application_services", lambda: account_application_services)

    with openapi_app.test_request_context():
        result = _call("upload.console_app.file", {"app_id": admitted_bearer.app_id, "file": _UNKNOWN_UPLOAD})

    assert inner_requests[0].body == {"file": _UNKNOWN_UPLOAD}
    assert (result.status, result.body["code"]) == (400, OpenApiErrorCode.UPLOAD_NOT_FOUND)


@pytest.mark.usefixtures("admitted_bearer")
def test_the_outer_request_context_survives_the_call(openapi_app: Flask, inner_requests: list[_SeenRequest]) -> None:
    with openapi_app.test_request_context("/openapi/v1/mcp", method="POST"):
        g.mcp_call_marker = _OUTER
        token = _marker.set(_OUTER)
        outer_g = dict(vars(g))

        result = _call("get.workspace", {})

        assert result.status == 200
        assert inner_requests
        assert g.mcp_call_marker == _OUTER
        assert dict(vars(g)) == outer_g
        assert _marker.get() == _OUTER
        assert request.path == "/openapi/v1/mcp"
        _marker.reset(token)


@pytest.mark.usefixtures("admitted_bearer")
def test_the_inner_request_keeps_the_callers_address(openapi_app: Flask, inner_requests: list[_SeenRequest]) -> None:
    with openapi_app.test_request_context(environ_base={"REMOTE_ADDR": _CALLER_ADDR}):
        result = _call("get.workspace", {})

    assert result.status == 200
    assert inner_requests[0].remote_addr == _CALLER_ADDR
    assert "X-Forwarded-For" not in inner_requests[0].headers


@pytest.mark.usefixtures("admitted_bearer")
def test_the_inner_request_keeps_the_callers_scheme_and_host(
    openapi_app: Flask, inner_requests: list[_SeenRequest]
) -> None:
    with openapi_app.test_request_context(base_url=_OUTER_HOST_URL):
        outer_host_url = request.host_url
        result = _call("get.workspace", {})

    assert result.status == 200
    assert outer_host_url == _OUTER_HOST_URL
    assert inner_requests[0].host_url == outer_host_url
    assert inner_requests[0].path == "/openapi/v1/workspaces"


_TRANSFERS_OFF = pytest.mark.parametrize(
    ("mcp", "transfers"),
    [(True, False), (False, True), (False, False)],
    ids=["transfers off", "mcp off, transfers on", "both off"],
)


@pytest.mark.usefixtures("admitted_bearer")
@_TRANSFERS_OFF
def test_with_transfers_off_the_inner_request_does_not_ask_for_a_transfer(
    openapi_app: Flask,
    inner_requests: list[_SeenRequest],
    config_overrides: Callable[..., None],
    mcp: bool,
    transfers: bool,
) -> None:
    config_overrides(OPENAPI_MCP_ENABLED=mcp, FILE_TRANSFER_ENABLED=transfers)

    with openapi_app.test_request_context():
        result = _call("get.workspace", {})

    assert result.status == 200
    assert HEADER_NAME_FILE_RESULT not in inner_requests[0].headers


@_TRANSFERS_OFF
def test_with_transfers_off_a_file_bound_key_is_refused_before_anything_runs(
    admitted_bearer: AdmittedWorld,
    openapi_app: Flask,
    inner_requests: list[_SeenRequest],
    config_overrides: Callable[..., None],
    mcp: bool,
    transfers: bool,
) -> None:
    config_overrides(OPENAPI_MCP_ENABLED=mcp, FILE_TRANSFER_ENABLED=transfers)

    with openapi_app.test_request_context(), pytest.raises(FileInputUnsupported):
        _call("upload.console_app.file", {"app_id": admitted_bearer.app_id, "file": _UNKNOWN_UPLOAD})

    assert inner_requests == []
