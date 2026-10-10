import copy
from datetime import datetime

import pytest

from core.dify_builder import handlers_build, handlers_edit, handlers_fix
from core.dify_builder.handlers_fix import build_form_fields
from core.dify_builder.models import Action, Actor, DifyBuilderContext, EntryMode, Session, TestInput, Turn
from core.dify_builder.runner import Env
from core.dify_builder.state import PcState
from tests.unit_tests.core.dify_builder.fakes import FakeDifyPort, InMemoryRepository, StubAgent


def test_build_form_fields_preserves_supported_scalar_and_json_types():
    fields = build_form_fields(
        [
            {"key": "enabled", "type": "bool"},
            {"key": "count", "type": "number"},
            {"key": "items", "type": "json"},
            {"key": "config", "type": "json_object"},
        ]
    )

    assert [field.type for field in fields] == ["bool", "number", "json", "json_object"]


def test_build_form_fields_carries_the_hint_that_explains_a_blank_field():
    """A requirements field left blank on purpose has to say why, or the user
    sees an unexplained empty box (PM report 2026-09-29). ``testdata_form_fields``
    already carries a hint; this form dropped it on the floor."""
    fields = build_form_fields(
        [{"key": "bocha_api_key", "label": "博查 API 密钥", "type": "text", "hint": "Not stated in your request."}]
    )

    assert fields[0].hint == "Not stated in your request."


_FLOWS = [
    (
        handlers_build.handle_execution,
        "run_test",
        handlers_build.handle_await_testdata,
        handlers_build.handle_test_and_repair,
        PcState.BUILD_AWAIT_TESTDATA,
        PcState.BUILD_REVIEW,
    ),
    (
        handlers_edit.handle_apply_changes,
        "run_affected_tests",
        handlers_edit.handle_await_testdata,
        handlers_edit.handle_test_affected_paths,
        PcState.EDIT_AWAIT_TESTDATA,
        PcState.EDIT_REVIEW,
    ),
    (
        handlers_fix.handle_await_verify,
        "run_verify",
        handlers_fix.handle_await_testdata,
        handlers_fix.handle_verify,
        PcState.FIX_AWAIT_TESTDATA,
        PcState.FIX_AWAIT_DECISION,
    ),
]


def _query_env(mode="advanced-chat", variables=None):
    dify = FakeDifyPort()
    dify.app_mode = mode
    dify.graph = {"nodes": [{"id": "start", "data": {"type": "start", "variables": variables or []}}]}
    agent = StubAgent()
    agent.generate_mock_inputs = lambda schema, _prior: {
        v["variable"]: "mock message" for v in schema["variables"] if v["type"] not in {"file", "file-list"}
    }
    repo = InMemoryRepository()
    env = Env(dify=dify, agent=agent, repo=repo, now=lambda: datetime.min)
    return (
        env,
        repo,
        Session(
            app_id="app",
            tenant_id="tenant",
            owner_account_id="actor",
            entry_mode=EntryMode.BUILD,
            current_state=PcState.BUILD_EXECUTION,
        ),
        DifyBuilderContext(),
    )


def _query_turn(kind="provide_testdata", inputs=None, mode="upload"):
    return Turn(
        actor=Actor(account_id="actor", tenant_id="tenant"),
        action=Action(kind=kind, payload={"mode": mode, "inputs": inputs or {}}),
    )


def _form(result):
    return next(item.payload for item in result.items if item.kind == "form")


@pytest.mark.parametrize("flow", _FLOWS)
@pytest.mark.parametrize("variables", [[], [{"variable": "query", "type": "text-input", "required": True}]])
def test_chatflow_form_has_a_distinct_required_system_message(flow, variables):
    gate, action, _prepare, _run, _await_state, _success = flow
    env, _, session, fc = _query_env(variables=variables)
    before = copy.deepcopy(env.dify.graph)
    result = gate(env, _query_turn(action), session, fc)
    fields = _form(result)["fields"]
    query = next(field for field in fields if field["key"] == "sys.query")
    assert query["required"] is True
    assert query["type"] == "paragraph"
    assert query["label"] == "User message"
    assert len(fields) == len(variables) + 1
    assert env.dify.graph == before


@pytest.mark.parametrize("flow", _FLOWS)
@pytest.mark.parametrize("query", [None, "  ", 7])
def test_invalid_chatflow_query_returns_to_inputs_before_launch(flow, query):
    _gate, _action, prepare, run, await_state, _success = flow
    env, repo, session, fc = _query_env(
        variables=[
            {"variable": "report_pdf", "type": "file", "required": True},
            {"variable": "endpoint", "type": "text-input"},
        ]
    )
    supplied = {"sys.query": query, "report_pdf": {"id": "file-1"}, "endpoint": "https://example.com"}
    prepared = prepare(env, _query_turn(inputs=supplied), session, fc)
    assert prepared.next == await_state
    assert fc.test_input_ref == ""
    assert _form(prepared)["values"] == supplied
    env.dify.run_draft = lambda *_args, **_kwargs: pytest.fail("invalid query reached runtime")
    ti = TestInput(session_id=session.id, inputs=supplied)
    repo.save_test_input(ti)
    fc.test_input_ref = ti.id
    result = run(env, _query_turn(), session, fc)
    assert result.next in {PcState.BUILD_AWAIT_REPAIR, PcState.EDIT_AWAIT_REPAIR, PcState.FIX_AWAIT_DECISION}
    assert fc.test_input_ref != ""
    assert fc.staged_repair == []
    assert result.run.verification is None


@pytest.mark.parametrize("flow", _FLOWS)
@pytest.mark.parametrize("mode", ["advanced-chat", "workflow"])
def test_mock_and_manual_inputs_share_mode_aware_schema_hash(flow, mode):
    _gate, _action, prepare, run, _await_state, success = flow
    env, repo, session, fc = _query_env(
        mode=mode, variables=[{"variable": "query", "type": "text-input"}, {"variable": "report_pdf", "type": "file"}]
    )
    prepared = prepare(env, _query_turn(mode="mock"), session, fc)
    mocked = repo.get_test_input(fc.test_input_ref)
    assert mocked.start_schema_hash
    assert ("sys.query" in mocked.inputs) == (mode == "advanced-chat")
    mock_hash = mocked.start_schema_hash
    supplied = {"query": "custom", "report_pdf": {"id": "file-1"}}
    if mode == "advanced-chat":
        supplied["sys.query"] = "system message"
    prepare(env, _query_turn(inputs=supplied), session, fc)
    assert repo.get_test_input(fc.test_input_ref).start_schema_hash == mock_hash
    result = run(env, _query_turn(), session, fc)
    assert result.next == success
    assert env.dify.run_draft_inputs == supplied


@pytest.mark.parametrize("flow", _FLOWS)
def test_chatflow_saved_workflow_inputs_are_stale(flow):
    _gate, _action, prepare, run, await_state, _success = flow
    env, repo, session, fc = _query_env(mode="workflow")
    prepare(env, _query_turn(inputs={"query": "custom"}), session, fc)
    old_hash = repo.get_test_input(fc.test_input_ref).start_schema_hash
    env.dify.app_mode = "advanced-chat"
    env.dify.run_draft = lambda *_args, **_kwargs: pytest.fail("stale inputs reached runtime")
    result = run(env, _query_turn(), session, fc)
    assert result.next in {PcState.BUILD_AWAIT_REPAIR, PcState.EDIT_AWAIT_REPAIR, PcState.FIX_AWAIT_DECISION}
    assert fc.test_input_ref != ""
    assert old_hash


@pytest.mark.parametrize(
    "error",
    ["query is required", "query is required [invalid_param]", "sys.query is required", "query must be a string"],
)
def test_known_query_argument_errors_are_input_failures(error):
    from core.dify_builder.models import Run

    assert handlers_fix.is_input_failure(Run(status="failed", error=error))


@pytest.mark.parametrize(
    "error", ["SQL query is required by code node", "query parser configuration is required", "node query is required"]
)
def test_query_related_graph_errors_still_need_repair(error):
    from core.dify_builder.models import Run

    assert not handlers_fix.is_input_failure(Run(status="failed", error=error))


@pytest.mark.parametrize("flow", _FLOWS)
def test_chatflow_rejects_a_stale_schema_even_when_query_is_valid(flow):
    _gate, _action, prepare, run, await_state, _success = flow
    env, repo, session, fc = _query_env()
    prepare(env, _query_turn(inputs={"sys.query": "message", "report_pdf": {"id": "file-1"}}), session, fc)
    env.dify.graph["nodes"][0]["data"]["variables"] = [{"variable": "topic", "type": "text-input", "required": True}]
    env.dify.run_draft = lambda *_args, **_kwargs: pytest.fail("stale input contract reached runtime")
    result = run(env, _query_turn(), session, fc)
    assert result.next in {PcState.BUILD_AWAIT_REPAIR, PcState.EDIT_AWAIT_REPAIR, PcState.FIX_AWAIT_DECISION}
    assert "no longer matches" in result.run.error
    assert repo.get_test_input(fc.test_input_ref).inputs["report_pdf"] == {"id": "file-1"}


@pytest.mark.parametrize("flow", _FLOWS)
def test_workflow_legacy_inputs_and_reserved_looking_variable_remain_ordinary(flow):
    _gate, _action, _prepare, run, _await_state, success = flow
    env, repo, session, fc = _query_env(mode="workflow", variables=[{"variable": "sys.query", "type": "text-input"}])
    saved = TestInput(session_id=session.id, inputs={"sys.query": 7, "query": "custom"})
    repo.save_test_input(saved)
    fc.test_input_ref = saved.id
    result = run(env, _query_turn(), session, fc)
    assert result.next == success
    assert env.dify.run_draft_inputs == saved.inputs


def test_workflow_fix_input_failures_keep_the_existing_decision_route():
    from core.dify_builder.models import Run

    env, repo, session, fc = _query_env(mode="workflow")
    prepare = handlers_fix.handle_await_testdata
    prepare(env, _query_turn(inputs={"query": "custom"}), session, fc)
    env.dify.run_draft = lambda *_args, **_kwargs: Run(status="failed", error="missing input: custom field")
    result = handlers_fix.handle_verify(env, _query_turn(), session, fc)
    assert result.next == PcState.FIX_AWAIT_DECISION
