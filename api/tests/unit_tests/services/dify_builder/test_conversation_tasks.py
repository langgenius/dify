"""Completed task continuations retain owned history and require fresh approvals."""

from datetime import datetime

import pytest

from core.dify_builder.models import (
    Action,
    Actor,
    ConversationItem,
    DifyBuilderContext,
    EntryMode,
    Run,
    Session,
    TestInput,
    Turn,
)
from core.dify_builder.state import PcState
from services.dify_builder.application.handlers_build import build_registry
from services.dify_builder.application.handlers_edit import edit_registry
from services.dify_builder.application.runner import Env, Runner
from services.dify_builder.service import _internal_action_allowed
from tests.unit_tests.core.dify_builder.fakes import FakeDifyPort, InMemoryRepository, StubAgent


def setup_task(intent: str = "test") -> tuple[Env, InMemoryRepository, Session]:
    class Agent(StubAgent):
        def continuation_intent(self, _context: object, _graph: object, _text: object) -> str:
            return intent

    repo = InMemoryRepository()
    port = FakeDifyPort()
    port.graph = {
        "nodes": [
            {
                "id": "start",
                "data": {
                    "type": "start",
                    "variables": [{"variable": "order_id", "type": "text-input", "required": True}],
                },
            }
        ],
        "edges": [],
    }
    env = Env(dify=port, agent=Agent(), repo=repo, now=lambda: datetime.min)
    session = Session(
        app_id="app",
        tenant_id="t",
        owner_account_id="u",
        entry_mode=EntryMode.BUILD,
        current_state=PcState.BUILD_COMPLETE,
    )
    repo.create_session(
        session,
        DifyBuilderContext(
            next_seq=1,
            goal_text="Original requirements",
            requirements={"format": "uppercase"},
            reply_language="zh-Hans",
            effect_confirmation={"old-node": "old-approval"},
        ),
        [ConversationItem(seq=0, kind="user", payload={"text": "Original requirements"}, at_version=1)],
    )
    return env, repo, session


def continue_task(env: Env, session: Session) -> Session:
    return Runner(env, build_registry() | edit_registry()).advance(
        session.id,
        Turn(
            actor=Actor(account_id="u", tenant_id="t"),
            action=Action(
                kind="message",
                payload={"text": "Continue the task", "client_turn_id": "followup-1"},
                base_version=session.version,
            ),
        ),
    )


def test_terminal_message_is_admitted_without_reopening_failed_or_paused_task() -> None:
    assert _internal_action_allowed(PcState.BUILD_COMPLETE, DifyBuilderContext(), "message")
    assert not _internal_action_allowed(PcState.FAILED, DifyBuilderContext(), "message")
    assert not _internal_action_allowed(PcState.BUILD_COMPLETE, DifyBuilderContext(paused=True), "message")


def test_request_test_retains_history_inputs_and_opens_fresh_confirmation() -> None:
    env, repo, session = setup_task()
    ti = TestInput(session_id=session.id, inputs={"order_id": "A123"}, source="user")
    repo.save_test_input(ti)
    _, fc = repo.get_session(session.id)
    fc.test_input_ref = ti.id
    repo.compare_and_advance(session.id, session.version, session.current_state, fc, [])
    session, _ = repo.get_session(session.id)
    out = continue_task(env, session)
    assert out.id == session.id
    assert out.current_state == PcState.BUILD_AWAIT_TESTDATA
    _, current = repo.get_session(session.id)
    assert current.requirements == {"format": "uppercase"}
    assert current.effect_confirmation == {}
    assert repo.get_test_input(current.test_input_ref).inputs == {"order_id": "A123"}
    rows = repo.list_conversation(session.id)
    assert rows[0].payload["text"] == "Original requirements"
    form = next(row for row in rows if row.kind == "form")
    assert form.payload["values"]["order_id"] == "A123"
    assert any(row.kind == "assistant_turn" and row.payload.get("turn_id") == "followup-1" for row in rows)
    assert not repo._runs


def test_edit_followup_enters_existing_plan_flow_in_same_session() -> None:
    env, repo, session = setup_task("edit")
    out = continue_task(env, session)
    assert out.id == session.id
    assert out.current_state == PcState.EDIT_IMPACT_ANALYSIS
    _, context = repo.get_session(session.id)
    assert context.active_entry_mode == EntryMode.EDIT
    assert context.requirements == {"format": "uppercase"}
    assert repo.list_conversation(session.id)[0].payload["text"] == "Original requirements"
    assert not repo._runs


def test_unknown_run_is_not_discarded_or_retested_by_followup() -> None:
    env, repo, session = setup_task()
    run = Run(session_id=session.id, status="unknown", kind="verify")
    repo.save_run(session.id, run)
    _, fc = repo.get_session(session.id)
    fc.verify_run_id = run.id
    repo.compare_and_advance(session.id, session.version, session.current_state, fc, [])
    session, _ = repo.get_session(session.id)
    out = continue_task(env, session)
    assert out.current_state == PcState.BUILD_COMPLETE
    _, current = repo.get_session(session.id)
    assert current.verify_run_id == run.id
    assert not any(row.kind == "form" for row in repo.list_conversation(session.id))
    assert len(repo._runs) == 1


def test_real_agent_classifies_only_preparation_intent(monkeypatch: pytest.MonkeyPatch) -> None:
    from services.dify_builder.agent import chat
    from services.dify_builder.agent.llm_agent import LlmBuilderAgent

    seen = []

    def invoke(_model: object, *, user: str, **kwargs: object) -> dict[str, str]:
        seen.append({**kwargs, "user": user})
        return {"intent": "test"}

    monkeypatch.setattr(chat.llm, "invoke_json", invoke)
    agent = LlmBuilderAgent("t")
    monkeypatch.setattr(agent, "model_or_none", lambda: object())
    assert (
        agent.continuation_intent(DifyBuilderContext(goal_text="Original workflow"), {"nodes": []}, "测试当前工作流")
        == "test"
    )
    user = seen[0]["user"]
    assert isinstance(user, str)
    assert "Original workflow" in user
    assert "测试当前工作流" in user
    monkeypatch.setattr(chat.llm, "invoke_json", lambda *_a, **_k: {"intent": "run", "approved": True})
    assert agent.continuation_intent(DifyBuilderContext(), {}, "run") == "chat"


def test_changed_start_schema_drops_removed_inputs_from_new_form() -> None:
    env, repo, session = setup_task()
    ti = TestInput(session_id=session.id, inputs={"removed_field": "old", "order_id": "keep"}, source="user")
    repo.save_test_input(ti)
    _, context = repo.get_session(session.id)
    context.test_input_ref = ti.id
    repo.compare_and_advance(session.id, session.version, session.current_state, context, [])
    session, _ = repo.get_session(session.id)
    continue_task(env, session)
    form = next(row for row in repo.list_conversation(session.id) if row.kind == "form")
    assert form.payload["values"] == {"order_id": "keep"}
    assert not repo._runs


def test_continuation_mode_survives_context_reload() -> None:
    from services.dify_builder.conversation_tasks import active_entry_mode
    from services.dify_builder.serde import context_from_dict, context_to_dict

    _, _, session = setup_task()
    context = DifyBuilderContext(active_entry_mode=str(EntryMode.EDIT))
    restored = context_from_dict(context_to_dict(context))
    assert active_entry_mode(session, restored) == EntryMode.EDIT
    assert session.entry_mode == EntryMode.BUILD


def test_completed_task_test_form_rebases_current_read_without_running() -> None:
    env, repo, session = setup_task()
    out = continue_task(env, session)
    _, context = repo.get_session(session.id)
    assert isinstance(env.dify, FakeDifyPort)
    assert context.last_snapshot_hash == env.dify.hash
    assert out.current_state == PcState.BUILD_AWAIT_TESTDATA
    assert not repo._runs


def test_test_continuation_undo_is_scoped_to_current_task_graph_and_history() -> None:
    import copy

    from services.dify_builder.application.handlers_fix import mint_checkpoint, perform_revert

    env, repo, session = setup_task()
    _, context = repo.get_session(session.id)
    assert isinstance(env.dify, FakeDifyPort)
    mint_checkpoint(env, session, context, {"nodes": [], "edges": []}, "old", PcState.BUILD_PLAN_APPROVAL)
    old_checkpoint = context.checkpoint_id
    context.checkpoint_seq = 0
    context.next_seq = 3
    prior_items = [
        ConversationItem(seq=1, kind="assistant_turn", payload={"card_state": "approved", "cards": ["form"]}),
        ConversationItem(seq=2, kind="form", payload={"frozen": True, "values": {"order_id": "prior"}}),
    ]
    repo.compare_and_advance(session.id, session.version, session.current_state, context, prior_items)
    session, _ = repo.get_session(session.id)
    baseline = copy.deepcopy(env.dify.graph)
    out = continue_task(env, session)
    _, current = repo.get_session(session.id)
    assert current.checkpoint_id != old_checkpoint
    assert repo.get_checkpoint(current.checkpoint_id)[1].graph == baseline
    assert current.checkpoint_seq == 4
    env.dify.graph = {"nodes": [], "edges": []}
    perform_revert(env, Turn(actor=Actor(account_id="u", tenant_id="t")), out, current)
    assert env.dify.graph == baseline
    rows = repo.list_conversation(session.id)
    assert next(row for row in rows if row.seq == 1).payload == prior_items[0].payload
    assert next(row for row in rows if row.seq == 2).payload == prior_items[1].payload
    assert all(
        row.payload["card_state"] == "invalidated" for row in rows if row.seq >= 4 and row.kind == "assistant_turn"
    )
    assert not repo._runs


@pytest.mark.parametrize(
    ("variable", "value"),
    [
        ({"variable": "field", "type": "select", "options": ["current"]}, "removed"),
        ({"variable": "field", "type": "text-input", "max_length": 3}, "too long"),
        ({"variable": "field", "type": "file"}, "old text"),
        ({"variable": "field", "type": "file-list", "max_length": 1}, [{}, {}]),
        ({"variable": "field", "type": "file-list"}, ["old text"]),
        ({"variable": "field", "type": "external_data_tool"}, "old text"),
    ],
)
def test_continuation_drops_values_incompatible_with_current_schema(variable: dict[str, object], value: object) -> None:
    from services.dify_builder.test_input_continuity import reusable_values

    assert reusable_values({"variables": [variable]}, {"field": value}) == {}


def test_duplicate_continuation_does_not_create_another_checkpoint_or_form() -> None:
    env, repo, session = setup_task()
    out = continue_task(env, session)
    _, first = repo.get_session(session.id)
    history = repo.list_conversation(session.id)
    continue_task(env, out)
    _, current = repo.get_session(session.id)
    assert current.checkpoint_id == first.checkpoint_id
    assert repo.list_conversation(session.id) == history
    assert not repo._runs


def test_compatible_defaults_keep_zero_false_and_valid_file_shapes() -> None:
    from services.dify_builder.test_input_continuity import reusable_values

    schema = {
        "variables": [
            {"variable": "n", "type": "number"},
            {"variable": "yes", "type": "checkbox"},
            {"variable": "f", "type": "file"},
            {"variable": "fs", "type": "file-list", "max_length": 1},
            {"variable": "s", "type": "select", "options": ["active"]},
        ]
    }
    values = {"n": 0, "yes": False, "f": {"upload_file_id": "file"}, "fs": [{"upload_file_id": "file2"}], "s": "active"}
    assert reusable_values(schema, values) == values


def test_edit_continuation_does_not_inherit_previous_task_restore_point() -> None:
    env, repo, session = setup_task("edit")
    _, context = repo.get_session(session.id)
    context.checkpoint_id = "old-task"
    context.checkpoint_seq = 0
    repo.compare_and_advance(session.id, session.version, session.current_state, context, [])
    session, _ = repo.get_session(session.id)
    continue_task(env, session)
    _, current = repo.get_session(session.id)
    assert not current.checkpoint_id
    assert current.checkpoint_seq >= 2


def test_known_failed_run_allows_fresh_form_without_reusing_consent() -> None:
    from core.dify_builder.models import RunVerification
    from runtime_contracts.builder.execution import ExecutionEvidenceSummary

    env, repo, session = setup_task()
    evidence = ExecutionEvidenceSummary(
        request_id="request",
        policy_version="builder-confirmed-run-v1",
        mode="confirmed_run",
        sealed=True,
        safety_outcome="native_failed",
        sandbox_profile="native",
        native_run_id="native",
    )
    run = Run(
        session_id=session.id,
        status="failed",
        kind="verify",
        verification=RunVerification(
            execution_revision="old",
            executed_graph_revision="old",
            terminal_outputs=None,
            output_findings=[],
            executed_node_ids=["start"],
            no_output_dead_branch=False,
            execution_evidence=evidence,
        ),
    )
    repo.save_run(session.id, run)
    _, context = repo.get_session(session.id)
    context.verify_run_id = run.id
    context.confirmed_consent_id = "old-consent"
    context.confirmed_command_id = "old-command"
    repo.compare_and_advance(session.id, session.version, session.current_state, context, [])
    session, _ = repo.get_session(session.id)
    out = continue_task(env, session)
    _, context = repo.get_session(session.id)
    assert out.current_state == PcState.BUILD_AWAIT_TESTDATA
    assert context.confirmed_consent_id == context.confirmed_command_id == ""
    assert len(repo._runs) == 1


def test_retained_inputs_are_prefill_only_after_edit_invalidates_active_input() -> None:
    env, repo, session = setup_task()
    ti = TestInput(
        session_id=session.id, source="user", inputs={"order_id": "A123", "removed": "old", "count": "not-a-number"}
    )
    repo.save_test_input(ti)
    _, context = repo.get_session(session.id)
    context.retained_test_input_ref = ti.id
    repo.compare_and_advance(session.id, session.version, session.current_state, context, [])
    session, _ = repo.get_session(session.id)
    assert isinstance(env.dify, FakeDifyPort)
    env.dify.graph["nodes"][0]["data"]["variables"].append({"variable": "count", "type": "number", "required": True})
    continue_task(env, session)
    _, stored = repo.get_session(session.id)
    form = next(item for item in reversed(repo.list_conversation(session.id)) if item.kind == "form")
    assert form.payload["values"] == {"order_id": "A123"}
    assert not stored.test_input_ref
    assert not stored.effect_confirmation
    assert any(field["key"] == "count" and field["required"] for field in form.payload["fields"])
