"""Which catalog operations a bearer's token can call, found and described over MCP.

Every test runs against the real app's catalog and handler specs.
"""

from __future__ import annotations

import pytest
from flask import Flask

from controllers.openapi._catalog import Bind
from controllers.openapi._mcp_call import UnknownOp, op_entry
from controllers.openapi._mcp_tools import (
    FIND_LIMIT,
    CallTool,
    FoundOps,
    callable_ops,
    describe_op,
    find_ops,
)
from controllers.openapi.auth.spec import Effect

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
