"""The MCP tools over the op catalog: which ops a bearer can find and call, and how a call's result maps.

Tests run against the real app's catalog, handler specs and in-process calls. A few replace
`call_op` or `callable_ops` on the tools module with plain functions, to prove nothing ran or to
feed a response no fixture can produce.
"""

from __future__ import annotations

import dataclasses
import json
import time
import uuid
from collections.abc import Callable, Mapping

import pytest
from flask import Flask
from sqlalchemy import select
from sqlalchemy.orm import Session

from controllers.openapi import _mcp_tools, jobs
from controllers.openapi._catalog import Bind
from controllers.openapi._mcp_call import OpCall, OpResult, UnknownOp, op_entry
from controllers.openapi._mcp_tools import (
    FIND_LIMIT,
    FIND_TOOL,
    MCP_INSTRUCTIONS,
    CallTool,
    FoundOps,
    Unauthenticated,
    callable_ops,
    describe_op,
    find_ops,
    run_tool,
    tool_list,
)
from controllers.openapi.auth.spec import Effect
from extensions.ext_application_services import ApplicationServices
from libs.oauth_bearer import extract_bearer
from models import Account
from models.enums import CreatorUserRole
from models.model import AppMode
from repositories.run_job_store import RedisRunJobStore
from services.run_job_contracts import JobOwner, JobPatch, JobStatus
from services.run_job_service import JobOpening, RunJobService
from tests.unit_tests.controllers.openapi.conftest import AdmittedWorld
from tests.unit_tests.services.run_job_fakes import InMemoryRedis, InMemoryRunResults, RecordingTaskControl

_PERSONAL = "dpat_x"
_WORKSPACE = "sk-x"
_ACCOUNT = "dfoa_x"
_UNKNOWN_PREFIX = "zz-x"
_STREAMING_AND_FILE = ("run.console_app.workflow", "get.run.event", "export.skill")
_INTERNAL = "switch.workspace"
_ACCOUNT_ONLY = "describe.account"
_NEEDS_ACCOUNT_SCOPE = "create.console_app.workflow"
_START_WORKFLOW = "start.console_app.workflow"
_LIST_APPS = "get.console_app"
_FILE_REQUIRED = "upload.console_app.file"


@pytest.fixture
def in_request(openapi_app: Flask):
    with openapi_app.test_request_context():
        yield


def _ids(found: FoundOps) -> list[str]:
    return [item["op"] for item in found.ops]


@pytest.mark.usefixtures("in_request")
@pytest.mark.parametrize("token", [None, _PERSONAL, _WORKSPACE, _ACCOUNT, _UNKNOWN_PREFIX])
def test_streaming_and_file_ops_are_never_listed(token: str | None) -> None:
    listed = callable_ops(token)
    for op in _STREAMING_AND_FILE:
        assert op not in listed


@pytest.mark.usefixtures("in_request")
def test_ops_with_a_required_file_input_are_never_listed() -> None:
    assert _FILE_REQUIRED not in callable_ops(None)


@pytest.mark.usefixtures("in_request")
def test_internal_ops_are_hidden() -> None:
    assert _INTERNAL not in callable_ops(_ACCOUNT)
    assert _INTERNAL not in callable_ops(None)


@pytest.mark.usefixtures("in_request")
def test_deprecated_ops_are_hidden() -> None:
    listed = callable_ops(None)
    assert not [op for op, entry in listed.items() if entry["deprecated"] or entry["internal"]]


@pytest.mark.usefixtures("in_request")
def test_a_personal_token_sees_only_ops_with_a_pat_policy() -> None:
    listed = callable_ops(_PERSONAL)
    assert _ACCOUNT_ONLY in listed
    assert _NEEDS_ACCOUNT_SCOPE not in listed


@pytest.mark.usefixtures("in_request")
def test_a_workspace_token_sees_only_ops_that_admit_it_and_fit_its_scopes() -> None:
    listed = callable_ops(_WORKSPACE)
    assert _START_WORKFLOW in listed
    assert _LIST_APPS in listed
    assert _ACCOUNT_ONLY not in listed
    assert _NEEDS_ACCOUNT_SCOPE not in listed


@pytest.mark.usefixtures("in_request")
def test_an_account_token_sees_every_listable_op() -> None:
    listed = callable_ops(_ACCOUNT)
    assert _ACCOUNT_ONLY in listed
    assert _NEEDS_ACCOUNT_SCOPE in listed
    assert set(callable_ops(_WORKSPACE)) < set(listed)
    assert set(callable_ops(_PERSONAL)) < set(listed)


@pytest.mark.usefixtures("in_request")
@pytest.mark.parametrize("token", [None, _UNKNOWN_PREFIX])
def test_no_token_or_an_unknown_prefix_sees_what_passes_the_entry_rules(token: str | None) -> None:
    listed = callable_ops(token)
    assert set(callable_ops(_ACCOUNT)) <= set(listed)
    assert _ACCOUNT_ONLY in listed


@pytest.mark.usefixtures("in_request")
def test_find_matches_words_in_id_or_summary_and_reports_the_total() -> None:
    found = find_ops("CURRENT account", token=_ACCOUNT)
    assert _ACCOUNT_ONLY in _ids(found)
    assert found.total == len(found.ops)
    by_id_words = find_ops("describe account", token=_ACCOUNT)
    assert _ACCOUNT_ONLY in _ids(by_id_words)
    assert find_ops("current nonexistentword", token=_ACCOUNT) == FoundOps(total=0, ops=[])


@pytest.mark.usefixtures("in_request")
def test_find_returns_at_most_twenty() -> None:
    found = find_ops("", token=_ACCOUNT)
    assert len(found.ops) == FIND_LIMIT
    assert found.total == len(callable_ops(_ACCOUNT))
    assert found.total > FIND_LIMIT
    assert _ids(found) == sorted(_ids(found))


@pytest.mark.usefixtures("in_request")
def test_describe_returns_schema_and_examples_without_file_fields() -> None:
    before = op_entry(_START_WORKFLOW)
    file_names = {name for name, bind in before["bind"].items() if bind == Bind.FILE}
    assert file_names

    described = describe_op(_START_WORKFLOW, token=_ACCOUNT)

    assert set(described) == {"op", "summary", "effect", "tool", "input", "examples"}
    assert described["op"] == _START_WORKFLOW
    assert not file_names & set(described["input"]["properties"])
    assert not file_names & set(described["input"]["required"])
    assert described["input"]["properties"]
    assert described["examples"] == before["examples"]
    assert op_entry(_START_WORKFLOW)["input"] == before["input"]


@pytest.mark.usefixtures("in_request")
@pytest.mark.parametrize("op", [*_STREAMING_AND_FILE, _INTERNAL, "no.such.op"])
def test_describe_of_a_hidden_op_is_unknown(op: str) -> None:
    with pytest.raises(UnknownOp):
        describe_op(op, token=_ACCOUNT)


@pytest.mark.usefixtures("in_request")
def test_describe_of_an_op_the_token_cannot_call_is_unknown() -> None:
    with pytest.raises(UnknownOp):
        describe_op(_ACCOUNT_ONLY, token=_WORKSPACE)


@pytest.mark.usefixtures("in_request")
def test_each_listed_op_names_the_tool_for_its_effect() -> None:
    listed = callable_ops(_ACCOUNT)
    by_effect: dict[str, set[str]] = {}
    for item in find_ops("", token=_ACCOUNT).ops:
        by_effect.setdefault(item["effect"], set()).add(item["tool"])
        assert item["tool"] == CallTool.for_effect(Effect(listed[item["op"]]["effect"]))
        assert set(item) == {"op", "summary", "effect", "tool"}
    assert all(len(tools) == 1 for tools in by_effect.values())
    assert CallTool.for_effect(Effect.READ) == "dify_read"
    assert CallTool.for_effect(Effect.WRITE) == "dify_write"
    assert CallTool.for_effect(Effect.DESTRUCTIVE) == "dify_destructive"


_BEARER = "Bearer dfoa_admitted"
_LATEST = "2025-06-18"
_OLDER = "2025-03-26"
_SUBMIT_FORM_OP = "submit.run.form"
_WAIT_JOB_OP = "wait.job"
_PAUSED_FORM = {
    "form_id": "f1",
    "node_id": "n1",
    "node_title": "Review",
    "form_content": "",
    "inputs": [{"type": "paragraph", "output_variable_name": "comment"}],
    "actions": [{"id": "approve", "title": "Approve"}],
    "form_token": "ft-1",
    "expiration_time": 4102444800,
}


@dataclasses.dataclass(frozen=True)
class _Carrier:
    headers: Mapping[str, str]


def _authorization_headers(authorization: str | None) -> dict[str, str]:
    return {} if authorization is None else {"Authorization": authorization}


def _run(
    name: str,
    arguments: Mapping[str, object],
    *,
    authorization: str | None = _BEARER,
    protocol_version: str = _LATEST,
):
    return run_tool(
        name,
        arguments,
        authorization=authorization,
        token=extract_bearer(_Carrier(headers=_authorization_headers(authorization))),
        trace_id="t1",
        protocol_version=protocol_version,
    )


def _text(result) -> str:
    assert len(result.content) == 1
    return result.content[0].text


def test_the_tool_list_has_four_tools_with_the_right_annotations() -> None:
    tools = {tool.name: tool for tool in tool_list()}

    assert set(tools) == {FIND_TOOL, *CallTool}
    assert tools[FIND_TOOL].annotations.readOnlyHint is True
    assert tools[CallTool.READ].annotations.readOnlyHint is True
    assert tools[CallTool.WRITE].annotations.readOnlyHint is False
    assert tools[CallTool.WRITE].annotations.destructiveHint is False
    assert tools[CallTool.DESTRUCTIVE].annotations.readOnlyHint is False
    assert tools[CallTool.DESTRUCTIVE].annotations.destructiveHint is True
    for tool in (tools[CallTool.READ], tools[CallTool.WRITE], tools[CallTool.DESTRUCTIVE]):
        assert tool.inputSchema["required"] == ["op", "input"]
    assert set(tools[FIND_TOOL].inputSchema["properties"]) == {"query", "op"}
    assert tools[FIND_TOOL].inputSchema["additionalProperties"] is False
    assert MCP_INSTRUCTIONS.startswith("This server runs operations of a Dify server.")


def test_the_call_tool_enum_carries_its_effect() -> None:
    assert [(tool.value, tool.effect) for tool in CallTool] == [
        ("dify_read", Effect.READ),
        ("dify_write", Effect.WRITE),
        ("dify_destructive", Effect.DESTRUCTIVE),
    ]


@pytest.mark.usefixtures("admitted_bearer")
def test_find_without_op_searches_and_with_op_describes(openapi_app: Flask) -> None:
    with openapi_app.test_request_context():
        found = _run(FIND_TOOL, {"query": "workspace"})
        described = _run(FIND_TOOL, {"op": "get.workspace"})
        unknown = _run(FIND_TOOL, {"op": "no.such.op"})

    assert found.isError is False
    assert "get.workspace" in [item["op"] for item in json.loads(_text(found))["ops"]]
    assert json.loads(_text(described))["op"] == "get.workspace"
    assert described.structuredContent["op"] == "get.workspace"
    assert unknown.isError is True
    assert _text(unknown) == "No operation `no.such.op`. Use dify_find to search."


@pytest.mark.usefixtures("admitted_bearer")
def test_read_runs_a_read_op_and_returns_its_json_as_text(openapi_app: Flask, admitted_bearer: AdmittedWorld) -> None:
    with openapi_app.test_request_context():
        result = _run(CallTool.READ, {"op": "get.workspace", "input": {}})

    assert result.isError is False
    body = json.loads(_text(result))
    assert [row["id"] for row in body["data"]] == [admitted_bearer.workspace_id]
    assert _text(result) == json.dumps(body, separators=(",", ":"), ensure_ascii=False)


@pytest.mark.usefixtures("admitted_bearer")
def test_structured_content_is_added_from_2025_06_18_on(openapi_app: Flask) -> None:
    with openapi_app.test_request_context():
        new = _run(CallTool.READ, {"op": "get.workspace", "input": {}}, protocol_version=_LATEST)
        old = _run(CallTool.READ, {"op": "get.workspace", "input": {}}, protocol_version=_OLDER)

    assert new.structuredContent == json.loads(_text(new))
    assert old.structuredContent is None


@pytest.mark.usefixtures("admitted_bearer")
def test_unknown_op_is_a_tool_error(openapi_app: Flask) -> None:
    with openapi_app.test_request_context():
        result = _run(CallTool.READ, {"op": "no.such.op", "input": {}})

    assert result.isError is True
    assert _text(result) == "No operation `no.such.op`. Use dify_find to search."


@pytest.mark.usefixtures("admitted_bearer")
def test_wrong_effect_names_the_right_tool(openapi_app: Flask) -> None:
    with openapi_app.test_request_context():
        result = _run(CallTool.READ, {"op": _NEEDS_ACCOUNT_SCOPE, "input": {}})

    assert result.isError is True
    assert _text(result) == f"`{_NEEDS_ACCOUNT_SCOPE}` is a write operation. Call it with dify_write."


@pytest.mark.usefixtures("admitted_bearer")
def test_an_op_error_becomes_a_tool_error_with_its_body(openapi_app: Flask) -> None:
    with openapi_app.test_request_context():
        missing = _run(CallTool.READ, {"op": "describe.workspace", "input": {"workspace_id": str(uuid.uuid4())}})
        invalid = _run(CallTool.READ, {"op": "get.workspace", "input": {"pg": 2}})

    for result in (missing, invalid):
        assert result.isError is True
        assert {"code", "message", "status"} <= set(json.loads(_text(result)))
    assert json.loads(_text(missing))["status"] == 404
    assert json.loads(_text(invalid))["status"] == 422


def test_a_401_from_the_op_raises_unauthenticated_with_its_headers(openapi_app: Flask) -> None:
    with openapi_app.test_request_context(), pytest.raises(Unauthenticated) as caught:
        _run(CallTool.READ, {"op": "get.workspace", "input": {}}, authorization=None)

    assert set(caught.value.headers) <= {"WWW-Authenticate", "Cache-Control"}
    assert "WWW-Authenticate" in caught.value.headers


@pytest.mark.usefixtures("admitted_bearer")
def test_an_oversize_result_is_a_tool_error_that_says_how_to_narrow(
    openapi_app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(_mcp_tools, "TOOL_RESULT_MAX_CHARS", 10)
    with openapi_app.test_request_context():
        result = _run(CallTool.READ, {"op": "get.workspace", "input": {}})

    assert result.isError is True
    assert result.structuredContent is None
    assert _text(result).endswith(
        "characters, above the 10 limit. Narrow the request (use `limit`, a filter, or a more specific operation)."
    )
    assert _text(result).startswith("The result is ")
    assert int(_text(result).split()[3]) > 10


@pytest.mark.usefixtures("admitted_bearer")
def test_an_unsafe_path_value_is_a_tool_error(openapi_app: Flask) -> None:
    with openapi_app.test_request_context():
        result = _run(CallTool.READ, {"op": "describe.workspace", "input": {"workspace_id": "a/b"}})

    assert result.isError is True
    assert "workspace_id" in _text(result)


@pytest.mark.usefixtures("admitted_bearer")
@pytest.mark.parametrize(
    "arguments",
    [
        {"input": {}},
        {"op": "", "input": {}},
        {"op": 3, "input": {}},
        {"op": "get.workspace"},
        {"op": "get.workspace", "input": []},
    ],
)
def test_wrong_argument_types_are_a_tool_error(openapi_app: Flask, arguments: dict[str, object]) -> None:
    with openapi_app.test_request_context():
        result = _run(CallTool.READ, arguments)

    assert result.isError is True


@pytest.mark.usefixtures("admitted_bearer")
@pytest.mark.parametrize("arguments", [{"query": 3}, {"op": 3}])
def test_find_with_wrong_argument_types_is_a_tool_error(openapi_app: Flask, arguments: dict[str, object]) -> None:
    with openapi_app.test_request_context():
        result = _run(FIND_TOOL, arguments)

    assert result.isError is True


@dataclasses.dataclass
class _PausedJob:
    app_id: str
    job_id: str


@pytest.fixture
def paused_job(
    admitted_bearer: AdmittedWorld,
    account_application_services: ApplicationServices,
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> _PausedJob:
    store = RedisRunJobStore(redis_client=InMemoryRedis())
    service = RunJobService(
        store=store,
        results=InMemoryRunResults(),
        tasks=RecordingTaskControl(),
        max_background_runs=10,
        max_waiters=4,
        sleep=lambda _seconds: time.sleep(0.01),
    )
    services = dataclasses.replace(account_application_services, run_jobs=service)
    monkeypatch.setattr(jobs, "application_services", lambda: services)
    caller = sqlite_session.scalars(select(Account).where(Account.email == "caller@example.com")).one()
    owner = JobOwner(
        tenant_id=admitted_bearer.workspace_id,
        app_id=admitted_bearer.app_id,
        caller_role=CreatorUserRole.ACCOUNT,
        caller_id=caller.id,
    )
    opened = service.open(JobOpening(owner=owner, mode=AppMode.WORKFLOW, op="start.x", idempotency_key=None))
    store.patch(opened.record.id, JobPatch(status=JobStatus.PAUSED, task_id="t1", run_id="r1", form=_PAUSED_FORM))
    return _PausedJob(app_id=admitted_bearer.app_id, job_id=opened.record.id)


def _wait_paused(paused_job: _PausedJob) -> dict[str, object]:
    arguments = {
        "op": _WAIT_JOB_OP,
        "input": {"app_id": paused_job.app_id, "job_id": paused_job.job_id, "wait_seconds": 0},
    }
    return json.loads(_text(_run(CallTool.READ, arguments)))


def test_hints_are_kept_when_the_token_can_call_their_ops(openapi_app: Flask, paused_job: _PausedJob) -> None:
    with openapi_app.test_request_context():
        body = _wait_paused(paused_job)

    assert [hint["op"] for hint in body["hints"]] == [_SUBMIT_FORM_OP, _WAIT_JOB_OP]


def test_hints_the_token_cannot_call_are_dropped_from_a_result(
    openapi_app: Flask, paused_job: _PausedJob, monkeypatch: pytest.MonkeyPatch
) -> None:
    # A workspace token cannot be admitted by the fixture, so the op set it would see
    # is stood in for: the real set without the form op.
    asked: list[str | None] = []
    real: Callable[[str | None], dict[str, Mapping[str, object]]] = callable_ops

    def without_form_op(token: str | None) -> dict[str, Mapping[str, object]]:
        asked.append(token)
        return {op: entry for op, entry in real(token).items() if op != _SUBMIT_FORM_OP}

    monkeypatch.setattr(_mcp_tools, "callable_ops", without_form_op)
    with openapi_app.test_request_context():
        body = _wait_paused(paused_job)

    assert [hint["op"] for hint in body["hints"]] == [_WAIT_JOB_OP]
    assert asked == ["dfoa_admitted"]


@pytest.mark.usefixtures("in_request")
def test_a_workspace_token_does_not_see_the_form_ops() -> None:
    listed = callable_ops(_WORKSPACE)

    assert _SUBMIT_FORM_OP not in listed
    assert _WAIT_JOB_OP in listed


_JSON_HEADERS = {"Content-Type": "application/json"}
_CALLABLE_HINT = {"summary": "wait", "op": _WAIT_JOB_OP, "input": {}, "form": None}
_UNCALLABLE_HINT = {"summary": "gone", "op": "no.such.op", "input": {}, "form": None}


def _canned(status: int, body: dict[str, object]) -> Callable[[OpCall], OpResult]:
    def answer(_call: OpCall) -> OpResult:
        return OpResult(status=status, body=body, headers=_JSON_HEADERS, is_json=True)

    return answer


@pytest.mark.usefixtures("admitted_bearer")
def test_hints_the_token_cannot_call_are_dropped_from_an_error_body(
    openapi_app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    error = {
        "code": "service_api_disabled",
        "message": "off",
        "status": 403,
        "hints": [_UNCALLABLE_HINT, _CALLABLE_HINT],
    }
    monkeypatch.setattr(_mcp_tools, "call_op", _canned(403, error))
    with openapi_app.test_request_context():
        result = _run(CallTool.READ, {"op": "get.workspace", "input": {}})

    assert result.isError is True
    assert result.structuredContent is None
    assert json.loads(_text(result))["hints"] == [_CALLABLE_HINT]


@pytest.mark.usefixtures("admitted_bearer")
def test_a_403_is_a_tool_error_not_an_exception(openapi_app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(_mcp_tools, "call_op", _canned(403, {"code": "forbidden", "message": "no", "status": 403}))
    with openapi_app.test_request_context():
        result = _run(CallTool.READ, {"op": "get.workspace", "input": {}})

    assert result.isError is True
    assert json.loads(_text(result))["status"] == 403


@pytest.mark.usefixtures("admitted_bearer")
def test_an_oversize_error_body_is_capped_after_hint_dropping(
    openapi_app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    error = {"code": "x", "message": "m" * 100, "hints": [_UNCALLABLE_HINT]}
    monkeypatch.setattr(_mcp_tools, "call_op", _canned(422, error))
    monkeypatch.setattr(_mcp_tools, "TOOL_RESULT_MAX_CHARS", 200)
    with openapi_app.test_request_context():
        kept = _run(CallTool.READ, {"op": "get.workspace", "input": {}})
        monkeypatch.setattr(_mcp_tools, "TOOL_RESULT_MAX_CHARS", 50)
        capped = _run(CallTool.READ, {"op": "get.workspace", "input": {}})

    assert json.loads(_text(kept))["hints"] == []
    assert capped.isError is True
    assert _text(capped).startswith("The result is ")
    assert "above the 50 limit" in _text(capped)


@pytest.fixture
def op_calls(monkeypatch: pytest.MonkeyPatch) -> list[OpCall]:
    seen: list[OpCall] = []
    real = _mcp_tools.call_op

    def recording(call: OpCall) -> OpResult:
        seen.append(call)
        return real(call)

    monkeypatch.setattr(_mcp_tools, "call_op", recording)
    return seen


@pytest.mark.usefixtures("admitted_bearer")
@pytest.mark.parametrize(
    ("tool", "op"),
    [
        (CallTool.READ, "no.such.op"),
        (CallTool.READ, _NEEDS_ACCOUNT_SCOPE),
        (CallTool.WRITE, _INTERNAL),
    ],
)
def test_a_refused_lookup_runs_nothing(openapi_app: Flask, op_calls: list[OpCall], tool: CallTool, op: str) -> None:
    with openapi_app.test_request_context():
        result = _run(tool, {"op": op, "input": {}})

    assert result.isError is True
    assert op_calls == []


@pytest.mark.usefixtures("admitted_bearer")
@pytest.mark.parametrize("arguments", [{"op": "", "query": "workspace"}, {"op": None, "query": "workspace"}])
def test_find_with_an_empty_op_searches_by_query(openapi_app: Flask, arguments: dict[str, object]) -> None:
    with openapi_app.test_request_context():
        result = _run(FIND_TOOL, arguments)

    assert result.isError is False
    assert "get.workspace" in [item["op"] for item in json.loads(_text(result))["ops"]]


def test_every_tool_has_a_description_and_the_call_tools_name_their_effect() -> None:
    tools = {tool.name: tool for tool in tool_list()}

    assert all(tool.description for tool in tools.values())
    for call_tool in CallTool:
        assert call_tool.effect.value in tools[call_tool].description
    assert "cannot be undone" in tools[CallTool.DESTRUCTIVE].description
    assert "cannot be undone" not in tools[CallTool.WRITE].description
