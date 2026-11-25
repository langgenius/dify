"""The MCP tools over the op catalog: which ops a bearer can find and call, and how a call's result maps.

Tests run against the real app's catalog, handler specs and in-process calls. A few replace
`call_op` or `callable_ops` on the tools module with plain functions, to prove nothing ran or to
feed a response no fixture can produce.
"""

from __future__ import annotations

import json
import operator
import re
import uuid
from collections.abc import Callable, Iterator, Mapping

import pytest
from flask import Flask

from configs import dify_config
from controllers.openapi import _mcp_tools, jobs
from controllers.openapi._catalog import Bind, build_catalog, op_registry
from controllers.openapi._contract import op_of
from controllers.openapi._mcp_call import OpCall, OpResult, UnknownOp
from controllers.openapi._mcp_tools import (
    FIND_TOOL,
    MCP_INSTRUCTIONS,
    CallTool,
    McpCaller,
    Unauthenticated,
    callable_ops,
    describe_op,
    find_ops,
    run_tool,
    tool_list,
)
from controllers.openapi.auth.spec import Effect
from controllers.openapi.human_input_form import OpenApiWorkflowHumanInputFormSubmitApi
from core.mcp import types as mcp_types
from tests.unit_tests.controllers.openapi.conftest import AdmittedWorld

_PERSONAL = "dpat_x"
_WORKSPACE = "sk-x"
_ACCOUNT = "dfoa_x"
_UNKNOWN_PREFIX = "zz-x"
_STREAMS = ("run.console_app.workflow", "test.console_app.workflow", "get.run.event")
_FILE_RESULT = "export.skill"
_INTERNAL = "switch.workspace"
_ACCOUNT_ONLY = "describe.account"
_NEEDS_ACCOUNT_SCOPE = "invite.workspace.member"
_RUN_WORKFLOW = "run.console_app.workflow"
_LIST_APPS = "get.console_app"
_FILE_REQUIRED = "upload.console_app.file"
_SUBMIT_FORM_OP = "submit.run.form"
_WAIT_JOB_OP = "wait.job"
_CHECK_DSL = "check.console_app.dsl"
_CHECK_DEPENDENCY = "check.console_app.dependency"


@pytest.fixture
def in_request(openapi_app: Flask) -> Iterator[None]:
    with openapi_app.test_request_context():
        yield


def _ids(found: Mapping[str, list[dict[str, str]]]) -> list[str]:
    return [item["op"] for item in found["ops"]]


@pytest.mark.usefixtures("in_request")
@pytest.mark.parametrize("token", [None, _PERSONAL, _WORKSPACE, _ACCOUNT, _UNKNOWN_PREFIX])
def test_file_ops_are_never_listed(token: str | None) -> None:
    assert _FILE_RESULT not in callable_ops(token)


@pytest.mark.usefixtures("in_request")
def test_stream_ops_are_listed_as_they_answer_a_job() -> None:
    listed = callable_ops(_ACCOUNT)
    assert set(_STREAMS) <= set(listed)


@pytest.mark.usefixtures("in_request")
def test_ops_with_a_required_file_input_are_never_listed() -> None:
    assert _FILE_REQUIRED not in callable_ops(None)


@pytest.mark.usefixtures("in_request")
@pytest.mark.parametrize(
    ("token", "seen", "hidden", "against_account"),
    [
        (_PERSONAL, {_ACCOUNT_ONLY}, {_NEEDS_ACCOUNT_SCOPE}, operator.lt),
        (
            _WORKSPACE,
            {_RUN_WORKFLOW, _LIST_APPS, _WAIT_JOB_OP},
            {_ACCOUNT_ONLY, _NEEDS_ACCOUNT_SCOPE, _SUBMIT_FORM_OP},
            operator.lt,
        ),
        (_ACCOUNT, {_ACCOUNT_ONLY, _NEEDS_ACCOUNT_SCOPE}, set(), operator.eq),
        (None, {_ACCOUNT_ONLY}, set(), operator.ge),
        (_UNKNOWN_PREFIX, {_ACCOUNT_ONLY}, set(), operator.ge),
    ],
)
def test_a_token_sees_the_ops_that_admit_its_kind(
    token: str | None, seen: set[str], hidden: set[str], against_account: Callable[[set[str], set[str]], bool]
) -> None:
    listed = set(callable_ops(token))
    assert seen <= listed
    assert not hidden & listed
    assert against_account(listed, set(callable_ops(_ACCOUNT)))


@pytest.mark.usefixtures("in_request")
def test_deprecated_ops_are_hidden() -> None:
    listed = callable_ops(None)
    assert not [op for op, entry in listed.items() if entry["deprecated"] or entry["internal"]]


@pytest.mark.usefixtures("in_request")
def test_find_matches_words_in_id_or_summary_and_reports_the_total() -> None:
    found = find_ops("CURRENT account", token=_ACCOUNT)
    assert _ACCOUNT_ONLY in _ids(found)
    assert found["total"] == len(found["ops"])
    by_id_words = find_ops("describe account", token=_ACCOUNT)
    assert _ACCOUNT_ONLY in _ids(by_id_words)


@pytest.mark.usefixtures("in_request")
def test_a_word_that_matches_nothing_does_not_empty_the_result() -> None:
    assert _ACCOUNT_ONLY in _ids(find_ops("current nonexistentword", token=_ACCOUNT))


@pytest.mark.usefixtures("in_request")
@pytest.mark.parametrize("query", ["nonexistentword", "nonexistentword zzzz", "工作流"])
def test_a_query_with_no_matching_word_finds_nothing(query: str) -> None:
    assert find_ops(query, token=_ACCOUNT) == {"total": 0, "ops": []}


@pytest.mark.usefixtures("in_request")
@pytest.mark.parametrize("query", ["", "   ", "?!-"])
def test_a_query_without_words_lists_every_op_by_id(query: str) -> None:
    assert find_ops(query, token=_ACCOUNT) == find_ops("", token=_ACCOUNT)


@pytest.mark.usefixtures("in_request")
@pytest.mark.parametrize(
    ("query", "first"),
    [
        ("check DSL before import validate import operation inputs", _CHECK_DSL),
        ("DSL import check validate", _CHECK_DSL),
        ("import DSL", _CHECK_DSL),
        ("read-only checks before importing DSL what does each check", _CHECK_DSL),
        ("dependencies plugins operation", _CHECK_DEPENDENCY),
        ("list app plugins dependency", _CHECK_DEPENDENCY),
        ("plugin dependencies operation app dependencies what information does it take", _CHECK_DEPENDENCY),
    ],
)
def test_a_natural_question_finds_its_op_first(query: str, first: str) -> None:
    assert _ids(find_ops(query, token=_ACCOUNT))[0] == first


@pytest.mark.usefixtures("in_request")
def test_a_question_lists_every_op_it_is_about() -> None:
    found = _ids(find_ops("read-only checks before importing DSL what does each check", token=_ACCOUNT))
    assert {_CHECK_DSL, _CHECK_DEPENDENCY} <= set(found)


@pytest.mark.usefixtures("in_request")
@pytest.mark.parametrize("query", ["list app plugins dependency", "current account", "run a workflow app"])
def test_find_orders_by_score_then_op_id(query: str) -> None:
    entries = callable_ops(_ACCOUNT)
    words = _mcp_tools._words(query)
    keys = [(-_mcp_tools._score(words, op, entries[op]), op) for op in _ids(find_ops(query, token=_ACCOUNT))]
    assert keys == sorted(keys)
    assert all(score < 0 for score, _ in keys)


@pytest.mark.parametrize(
    ("text", "words"),
    [
        ("Check plugin dependencies", {"check", "plugin", "dependency"}),
        ("check.console_app.dsl", {"check", "console", "app", "dsl"}),
        ("access address class", {"access", "address", "class"}),
        ("apps and runs; s", {"app", "and", "run"}),
        ("", set()),
    ],
)
def test_words_split_on_non_letters_and_drop_plural_endings(text: str, words: set[str]) -> None:
    assert _mcp_tools._words(text) == words


@pytest.mark.parametrize(
    ("one", "other", "matches"),
    [
        ("plugin", "plugin", True),
        ("depend", "dependency", True),
        ("dependency", "depend", True),
        ("impo", "import", True),
        ("app", "apply", False),
        ("dsl", "dsls", False),
        ("import", "export", False),
    ],
)
def test_words_match_when_equal_or_one_begins_the_other(one: str, other: str, matches: bool) -> None:
    assert _mcp_tools._words_match(one, other) is matches


@pytest.mark.usefixtures("in_request")
def test_find_returns_one_page_and_where_the_next_starts() -> None:
    page_size = dify_config.OPENAPI_MCP_FIND_PAGE_SIZE
    found = find_ops("", token=_ACCOUNT)
    assert len(found["ops"]) == page_size
    assert found["total"] == len(callable_ops(_ACCOUNT))
    assert found["total"] > page_size
    assert found["next_offset"] == page_size
    assert _ids(found) == sorted(_ids(found))


@pytest.mark.usefixtures("in_request")
def test_reading_on_by_next_offset_lists_every_op_once() -> None:
    seen: list[str] = []
    page = find_ops("", token=_ACCOUNT)
    seen.extend(_ids(page))
    pages = 1
    while "next_offset" in page:
        page = find_ops("", token=_ACCOUNT, offset=page["next_offset"])
        seen.extend(_ids(page))
        pages += 1

    assert seen == sorted(callable_ops(_ACCOUNT))
    assert pages == -(-len(seen) // dify_config.OPENAPI_MCP_FIND_PAGE_SIZE)


@pytest.mark.usefixtures("in_request")
def test_the_page_size_is_the_setting(config_overrides: Callable[..., None]) -> None:
    config_overrides(OPENAPI_MCP_FIND_PAGE_SIZE=3)

    found = find_ops("", token=_ACCOUNT, offset=3)

    assert _ids(found) == sorted(callable_ops(_ACCOUNT))[3:6]
    assert found["next_offset"] == 6


@pytest.mark.usefixtures("in_request")
def test_the_last_page_has_no_next_offset() -> None:
    total = find_ops("", token=_ACCOUNT)["total"]

    last = find_ops("", token=_ACCOUNT, offset=total - 1)
    past = find_ops("", token=_ACCOUNT, offset=total)

    assert (len(last["ops"]), "next_offset" in last) == (1, False)
    assert (past["ops"], "next_offset" in past) == ([], False)


@pytest.mark.usefixtures("in_request")
def test_describe_returns_schema_and_examples_without_file_fields() -> None:
    before = op_registry()[_RUN_WORKFLOW].entry
    file_names = {name for name, bind in before["bind"].items() if bind == Bind.FILE}
    assert file_names

    described = describe_op(_RUN_WORKFLOW, token=_ACCOUNT)

    assert set(described) == {"op", "summary", "effect", "tool", "input", "examples"}
    assert described["op"] == _RUN_WORKFLOW
    assert not file_names & set(described["input"]["properties"])
    assert not file_names & set(described["input"]["required"])
    assert described["input"]["properties"]
    assert described["examples"] == before["examples"]
    assert op_registry()[_RUN_WORKFLOW].entry["input"] == before["input"]


@pytest.mark.usefixtures("in_request")
@pytest.mark.parametrize("op", _STREAMS)
def test_a_stream_op_shows_its_job_fields_without_requiring_them(op: str) -> None:
    described = describe_op(op, token=_ACCOUNT)

    assert {"wait_seconds", "idempotency_key"} <= set(described["input"]["properties"])
    assert not {"wait_seconds", "idempotency_key"} & set(described["input"]["required"])
    assert op_registry()[op].entry["input"]["properties"].keys().isdisjoint({"wait_seconds", "idempotency_key"})


@pytest.mark.usefixtures("in_request")
def test_an_op_of_another_kind_shows_no_job_fields() -> None:
    described = describe_op(_LIST_APPS, token=_ACCOUNT)

    assert not {"wait_seconds", "idempotency_key"} & set(described["input"]["properties"])


@pytest.mark.usefixtures("in_request")
def test_every_example_names_every_required_input() -> None:
    for op in callable_ops(_ACCOUNT):
        described = describe_op(op, token=_ACCOUNT)
        for example in described["examples"]:
            assert set(described["input"]["required"]) <= set(example["input"]), op


@pytest.mark.usefixtures("in_request")
def test_a_required_input_an_example_leaves_out_is_a_placeholder() -> None:
    ops = op_registry()
    op, name = next(
        (op, name)
        for op in callable_ops(_ACCOUNT)
        for example in ops[op].entry["examples"]
        for name in ops[op].entry["input"]["required"]
        if name not in example["input"]
    )

    described = describe_op(op, token=_ACCOUNT)

    assert all(example["input"][name] == f"<{name}>" for example in described["examples"])


@pytest.mark.usefixtures("in_request")
@pytest.mark.parametrize("op", [_FILE_RESULT, _INTERNAL, "no.such.op"])
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
    for item in find_ops("", token=_ACCOUNT)["ops"]:
        by_effect.setdefault(item["effect"], set()).add(item["tool"])
        assert item["tool"] == CallTool.for_effect(Effect(listed[item["op"]]["effect"]))
        assert set(item) == {"op", "summary", "effect", "tool"}
    assert all(len(tools) == 1 for tools in by_effect.values())


_TOKEN = "dfoa_admitted"
_LATEST = "2025-06-18"
_OLDER = "2025-03-26"


def _run(
    name: str,
    arguments: Mapping[str, object],
    *,
    token: str | None = _TOKEN,
    protocol_version: str = _LATEST,
) -> mcp_types.CallToolResult:
    caller = McpCaller(
        authorization=None if token is None else f"Bearer {token}",
        token=token,
        trace_id="t1",
        protocol_version=protocol_version,
    )
    return run_tool(name, arguments, caller)


def _text(result: mcp_types.CallToolResult) -> str:
    assert len(result.content) == 1
    block = result.content[0]
    assert isinstance(block, mcp_types.TextContent)
    return block.text


def test_the_tool_list_has_four_tools_with_the_right_annotations() -> None:
    tools = {tool.name: tool for tool in tool_list()}

    assert set(tools) == {FIND_TOOL, *CallTool}
    hints = {name: tool.annotations for name, tool in tools.items()}
    assert None not in hints.values()
    assert [
        (annotations.readOnlyHint, annotations.destructiveHint)
        for name in (FIND_TOOL, CallTool.READ, CallTool.WRITE, CallTool.DESTRUCTIVE)
        if (annotations := hints[name]) is not None
    ] == [(True, None), (True, False), (False, False), (False, True)]
    for tool in (tools[CallTool.READ], tools[CallTool.WRITE], tools[CallTool.DESTRUCTIVE]):
        assert tool.inputSchema["required"] == ["op", "input"]
    assert set(tools[FIND_TOOL].inputSchema["properties"]) == {"query", "op", "offset"}
    assert tools[FIND_TOOL].inputSchema["additionalProperties"] is False


_MAX_DESCRIPTION_WORDS = 70


def test_each_tool_description_is_short_and_every_input_is_described() -> None:
    for tool in tool_list():
        assert tool.description is not None
        assert len(tool.description.split()) < _MAX_DESCRIPTION_WORDS
        assert all(schema.get("description") for schema in tool.inputSchema["properties"].values())


def test_each_call_tool_says_what_its_effect_does_to_the_data() -> None:
    descriptions = {tool: tool.description for tool in CallTool}

    assert "effect is read: it changes nothing." in descriptions[CallTool.READ]
    assert "effect is write: it creates or updates data." in descriptions[CallTool.WRITE]
    assert "cannot be undone. Confirm with the human first." in descriptions[CallTool.DESTRUCTIVE]
    assert all("get.workspace" in description for description in descriptions.values())


def test_every_effect_has_exactly_one_call_tool() -> None:
    for effect in Effect:
        assert [tool for tool in CallTool if tool.effect is effect] == [CallTool.for_effect(effect)]


# An op id as the instructions write one: dotted lower-case words.
_NAMED_OP = re.compile(r"\b[a-z_]+(?:\.[a-z_]+)+\b")


def test_every_op_the_instructions_and_job_hints_name_is_in_the_catalog(openapi_app: Flask) -> None:
    ops = set(build_catalog(openapi_app)["ops"])
    named = set(_NAMED_OP.findall(MCP_INSTRUCTIONS))
    hinted = {jobs.WAIT_JOB_OP, jobs.STOP_JOB_OP, op_of(OpenApiWorkflowHumanInputFormSubmitApi.post)}

    assert named - ops == set()
    assert hinted - ops == set()
    assert {jobs.WAIT_JOB_OP, jobs.STOP_JOB_OP} <= named


@pytest.mark.usefixtures("admitted_bearer", "in_request")
def test_find_without_op_searches_and_with_op_describes() -> None:
    found = _run(FIND_TOOL, {"query": "workspace"})
    described = _run(FIND_TOOL, {"op": "get.workspace"})
    unknown = _run(FIND_TOOL, {"op": "no.such.op"})

    assert found.isError is False
    assert "get.workspace" in [item["op"] for item in json.loads(_text(found))["ops"]]
    assert json.loads(_text(described))["op"] == "get.workspace"
    assert described.structuredContent is not None
    assert described.structuredContent["op"] == "get.workspace"
    assert unknown.isError is True
    assert _text(unknown) == "No operation `no.such.op`. Use dify_find to search."


@pytest.mark.usefixtures("admitted_bearer", "in_request")
def test_read_runs_a_read_op_and_returns_its_json_as_text(admitted_bearer: AdmittedWorld) -> None:
    result = _run(CallTool.READ, {"op": "get.workspace", "input": {}})

    assert result.isError is False
    body = json.loads(_text(result))
    assert [row["id"] for row in body["data"]] == [admitted_bearer.workspace_id]
    assert _text(result) == json.dumps(body, separators=(",", ":"), ensure_ascii=False)


@pytest.mark.usefixtures("admitted_bearer", "in_request")
def test_structured_content_is_added_from_2025_06_18_on() -> None:
    new = _run(CallTool.READ, {"op": "get.workspace", "input": {}}, protocol_version=_LATEST)
    old = _run(CallTool.READ, {"op": "get.workspace", "input": {}}, protocol_version=_OLDER)

    assert new.structuredContent == json.loads(_text(new))
    assert old.structuredContent is None


@pytest.mark.usefixtures("admitted_bearer", "in_request")
def test_an_op_error_becomes_a_tool_error_with_its_body() -> None:
    missing = _run(CallTool.READ, {"op": "describe.workspace", "input": {"workspace_id": str(uuid.uuid4())}})
    invalid = _run(CallTool.READ, {"op": "get.workspace", "input": {"pg": 2}})

    for result in (missing, invalid):
        assert result.isError is True
        assert {"code", "message", "status"} <= set(json.loads(_text(result)))
    assert json.loads(_text(missing))["status"] == 404
    assert json.loads(_text(invalid))["status"] == 422


@pytest.mark.usefixtures("in_request")
def test_a_401_from_the_op_raises_unauthenticated_with_its_headers() -> None:
    with pytest.raises(Unauthenticated) as caught:
        _run(CallTool.READ, {"op": "get.workspace", "input": {}}, token=None)

    assert set(caught.value.headers) <= {"WWW-Authenticate", "Cache-Control"}
    assert "WWW-Authenticate" in caught.value.headers


@pytest.mark.usefixtures("admitted_bearer", "in_request")
def test_an_unsafe_path_value_is_a_tool_error() -> None:
    result = _run(CallTool.READ, {"op": "describe.workspace", "input": {"workspace_id": "a/b"}})

    assert result.isError is True
    assert "workspace_id" in _text(result)


@pytest.mark.usefixtures("admitted_bearer", "in_request")
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
def test_wrong_argument_types_are_a_tool_error(arguments: dict[str, object]) -> None:
    result = _run(CallTool.READ, arguments)

    assert result.isError is True


@pytest.mark.usefixtures("admitted_bearer", "in_request")
@pytest.mark.parametrize(
    "arguments",
    [{"query": 3}, {"op": 3}, {"offset": -1}, {"offset": "20"}, {"offset": True}, {"offset": 1.5}],
)
def test_find_with_wrong_argument_types_is_a_tool_error(arguments: dict[str, object]) -> None:
    result = _run(FIND_TOOL, arguments)

    assert result.isError is True


@pytest.mark.usefixtures("admitted_bearer", "in_request")
def test_find_reads_on_from_the_offset_it_is_given() -> None:
    first = json.loads(_blocks(_run(FIND_TOOL, {"query": ""}))[0])
    second = json.loads(_blocks(_run(FIND_TOOL, {"query": "", "offset": first["next_offset"]}))[0])
    null_offset = json.loads(_blocks(_run(FIND_TOOL, {"query": "", "offset": None}))[0])

    assert second["ops"][0]["op"] not in {item["op"] for item in first["ops"]}
    assert null_offset == first


_JSON_HEADERS = {"Content-Type": "application/json"}
_CALLABLE_HINT = {"summary": "wait", "op": _WAIT_JOB_OP, "input": {}, "form": None}
_UNCALLABLE_HINT = {"summary": "gone", "op": "no.such.op", "input": {}, "form": None}


def _canned(
    status: int, body: dict[str, object], headers: Mapping[str, str] = _JSON_HEADERS
) -> Callable[[OpCall], OpResult]:
    def answer(_call: OpCall) -> OpResult:
        return OpResult(status=status, body=body, headers=headers, is_json=True)

    return answer


@pytest.mark.usefixtures("admitted_bearer", "in_request")
@pytest.mark.parametrize(("status", "is_error"), [(200, False), (403, True)], ids=["result", "error body"])
def test_hints_the_token_cannot_call_are_dropped_from_a_result_and_an_error_body(
    monkeypatch: pytest.MonkeyPatch, status: int, is_error: bool
) -> None:
    body: dict[str, object] = {
        "code": "x",
        "message": "m",
        "status": status,
        "hints": [_UNCALLABLE_HINT, _CALLABLE_HINT],
    }
    monkeypatch.setattr(_mcp_tools, "call_op", _canned(status, body))
    result = _run(CallTool.READ, {"op": "get.workspace", "input": {}})

    assert result.isError is is_error
    assert (result.structuredContent is None) is is_error
    assert json.loads(_text(result))["hints"] == [_CALLABLE_HINT]


# A small limit, and bodies whose compact JSON text is exactly that long or one character longer.
_CUT_LIMIT = 30
_BODY_OVERHEAD = len('{"v":""}')
_BODY_AT_LIMIT: dict[str, object] = {"v": "x" * (_CUT_LIMIT - _BODY_OVERHEAD)}
_BODY_OVER_LIMIT: dict[str, object] = {"v": "x" * (_CUT_LIMIT - _BODY_OVERHEAD + 1)}


def _blocks(result: mcp_types.CallToolResult) -> list[str]:
    return [block.text for block in result.content if isinstance(block, mcp_types.TextContent)]


@pytest.mark.usefixtures("admitted_bearer", "in_request")
def test_a_result_exactly_at_the_limit_is_untouched(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(OPENAPI_MCP_RESULT_MAX_CHARS=_CUT_LIMIT)
    monkeypatch.setattr(_mcp_tools, "call_op", _canned(200, _BODY_AT_LIMIT))
    result = _run(CallTool.READ, {"op": "get.workspace", "input": {}})

    assert _blocks(result) == [json.dumps(_BODY_AT_LIMIT, separators=(",", ":"))]
    assert len(_blocks(result)[0]) == _CUT_LIMIT
    assert result.isError is False
    assert result.structuredContent == _BODY_AT_LIMIT


@pytest.mark.usefixtures("admitted_bearer", "in_request")
def test_a_result_one_character_over_is_cut_with_a_note_and_no_structured_content(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(OPENAPI_MCP_RESULT_MAX_CHARS=_CUT_LIMIT)
    monkeypatch.setattr(_mcp_tools, "call_op", _canned(200, _BODY_OVER_LIMIT))
    result = _run(CallTool.READ, {"op": "get.workspace", "input": {}})
    full = json.dumps(_BODY_OVER_LIMIT, separators=(",", ":"))

    cut, note = _blocks(result)
    assert cut == full[:_CUT_LIMIT]
    assert len(cut) == _CUT_LIMIT
    assert note == (
        f"The result was cut at {_CUT_LIMIT} of {_CUT_LIMIT + 1} characters. The operation ran; calling it again "
        "with the same input will not return the rest. Narrow the request with `limit`, a filter, or a more "
        "specific operation."
    )
    assert result.isError is False
    assert result.structuredContent is None


def test_the_cut_note_names_the_real_limit_and_length_with_thousands_separators() -> None:
    result = _mcp_tools._json_result({"v": "x" * 50_000}, protocol_version=_LATEST)

    assert _blocks(result)[1].startswith("The result was cut at 40,000 of 50,008 characters.")


@pytest.mark.usefixtures("admitted_bearer", "in_request")
def test_a_successful_write_with_a_long_result_is_not_an_error(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(OPENAPI_MCP_RESULT_MAX_CHARS=_CUT_LIMIT)
    monkeypatch.setattr(_mcp_tools, "call_op", _canned(200, _BODY_OVER_LIMIT))
    result = _run(CallTool.WRITE, {"op": _RUN_WORKFLOW, "input": {}})

    assert result.isError is False
    assert len(_blocks(result)) == 2
    assert result.structuredContent is None


@pytest.mark.usefixtures("admitted_bearer", "in_request")
def test_an_error_body_over_the_limit_is_cut_and_stays_an_error(
    monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    body: dict[str, object] = {"code": "x", "message": "m" * _CUT_LIMIT, "status": 422}
    config_overrides(OPENAPI_MCP_RESULT_MAX_CHARS=_CUT_LIMIT)
    monkeypatch.setattr(_mcp_tools, "call_op", _canned(422, body))
    result = _run(CallTool.READ, {"op": "get.workspace", "input": {}})

    cut, note = _blocks(result)
    assert len(cut) == _CUT_LIMIT
    assert note.startswith(f"The result was cut at {_CUT_LIMIT} of ")
    assert result.isError is True
    assert result.structuredContent is None


_RATE_LIMITED: dict[str, object] = {
    "code": "rate_limited",
    "message": "slow down",
    "status": 429,
    "hints": [_UNCALLABLE_HINT],
}


@pytest.mark.usefixtures("admitted_bearer", "in_request")
def test_a_429_with_retry_after_adds_the_wait_as_a_second_block(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(_mcp_tools, "call_op", _canned(429, _RATE_LIMITED, {**_JSON_HEADERS, "Retry-After": "30"}))
    result = _run(CallTool.READ, {"op": "get.workspace", "input": {}})

    assert result.isError is True
    assert [block.text for block in result.content if isinstance(block, mcp_types.TextContent)][1:] == [
        "Retry after 30 seconds."
    ]
    first = result.content[0]
    assert isinstance(first, mcp_types.TextContent)
    assert json.loads(first.text) == {**_RATE_LIMITED, "hints": []}


@pytest.mark.usefixtures("admitted_bearer", "in_request")
@pytest.mark.parametrize(
    ("status", "retry_after"),
    [
        (429, None),
        *((429, value) for value in ("Wed, 21 Oct 2026 07:28:00 GMT", "-5", "1.5", "", "abc")),
        (503, "30"),
    ],
)
def test_a_429_without_whole_retry_seconds_or_another_status_has_one_block(
    monkeypatch: pytest.MonkeyPatch, status: int, retry_after: str | None
) -> None:
    headers = _JSON_HEADERS if retry_after is None else {**_JSON_HEADERS, "Retry-After": retry_after}
    monkeypatch.setattr(_mcp_tools, "call_op", _canned(status, _RATE_LIMITED, headers))
    result = _run(CallTool.READ, {"op": "get.workspace", "input": {}})

    assert result.isError is True
    assert len(result.content) == 1


@pytest.fixture
def op_calls(monkeypatch: pytest.MonkeyPatch) -> list[OpCall]:
    seen: list[OpCall] = []
    real = _mcp_tools.call_op

    def recording(call: OpCall) -> OpResult:
        seen.append(call)
        return real(call)

    monkeypatch.setattr(_mcp_tools, "call_op", recording)
    return seen


@pytest.mark.usefixtures("admitted_bearer", "in_request")
@pytest.mark.parametrize(
    ("tool", "op", "text"),
    [
        (CallTool.READ, "no.such.op", "No operation `no.such.op`. Use dify_find to search."),
        (
            CallTool.READ,
            _NEEDS_ACCOUNT_SCOPE,
            f"`{_NEEDS_ACCOUNT_SCOPE}` is a write operation. Call it with dify_write.",
        ),
        (CallTool.WRITE, _INTERNAL, f"No operation `{_INTERNAL}`. Use dify_find to search."),
    ],
)
def test_a_refused_lookup_runs_nothing(op_calls: list[OpCall], tool: CallTool, op: str, text: str) -> None:
    result = _run(tool, {"op": op, "input": {}})

    assert result.isError is True
    assert _text(result) == text
    assert op_calls == []


@pytest.mark.usefixtures("admitted_bearer", "in_request")
@pytest.mark.parametrize("arguments", [{"op": "", "query": "workspace"}, {"op": None, "query": "workspace"}])
def test_find_with_an_empty_op_searches_by_query(arguments: dict[str, object]) -> None:
    result = _run(FIND_TOOL, arguments)

    assert result.isError is False
    assert "get.workspace" in [item["op"] for item in json.loads(_text(result))["ops"]]
