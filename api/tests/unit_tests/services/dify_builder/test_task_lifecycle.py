"""Logical task history is bounded data, never execution consent or native content."""

import json
from dataclasses import asdict
from datetime import datetime

import pytest

from core.dify_builder.models import (
    Action,
    Actor,
    ChangeSet,
    DifyBuilderContext,
    EntryMode,
    NodeOutput,
    Risk,
    Run,
    RunVerification,
    Session,
    Turn,
)
from core.dify_builder.state import PcState
from services.dify_builder.application.runner import Env
from services.dify_builder.serde import context_from_dict, context_to_dict
from tests.unit_tests.core.dify_builder.fakes import FakeDifyPort, InMemoryRepository, StubAgent


def task_env() -> tuple[Env, Session, DifyBuilderContext]:
    repo = InMemoryRepository()
    session = Session(
        id="session",
        app_id="app",
        tenant_id="t",
        owner_account_id="u",
        entry_mode=EntryMode.BUILD,
        current_state=PcState.BUILD_REVIEW,
        version=7,
    )
    context = DifyBuilderContext(goal_text="Summarize reports", requirements={"format": "brief"})
    return Env(dify=FakeDifyPort(), agent=StubAgent(), repo=repo, now=lambda: datetime.min), session, context


def test_logical_identity_is_stable_across_resume_generations() -> None:
    from services.dify_builder import task_lifecycle

    _, session, context = task_env()
    assert task_lifecycle.task_identity(session, context) == "session:0"
    context.task_control["generation"] = 42
    assert task_lifecycle.task_identity(session, context) == "session:0"
    assert task_lifecycle.advance_task_identity(session, context, EntryMode.EDIT) == "session:1"
    context.task_control["generation"] += 1
    assert task_lifecycle.task_identity(session, context) == "session:1"
    assert context.task_status == "active"
    task_lifecycle.mark_task_abandoned(context, "new_goal")
    assert context.task_status == "abandoned"
    assert context.task_control["generation"] == 43
    assert task_lifecycle.advance_task_identity(session, context, EntryMode.FIX) == "session:2"


def test_completion_is_idempotent_and_survives_serde_without_claiming_verification() -> None:
    from services.dify_builder import task_lifecycle

    env, session, context = task_env()
    task_lifecycle.record_task_completion(env, session, context, "kept_draft")
    task_lifecycle.record_task_completion(env, session, context, "kept_draft")
    restored = context_from_dict(context_to_dict(context))
    assert restored.task_status == "completed"
    assert len(restored.task_summaries) == 1
    summary = restored.task_summaries[0]
    assert summary.task_id == "session:0"
    assert summary.goal == "Summarize reports"
    assert summary.constraints == {"format": "brief"}
    assert summary.test_evidence.status == "not_run"
    assert not summary.test_evidence.sealed
    assert summary.completion_version == 8
    assert context_from_dict({}).task_summaries == []
    with pytest.raises(ValueError, match="task completion outcome changed"):
        task_lifecycle.record_task_completion(env, session, context, "published")


def test_summary_redacts_repeated_secrets_and_never_copies_native_content() -> None:
    from services.dify_builder import task_lifecycle

    env, session, context = task_env()
    secret = "credential-value-that-must-never-survive"
    context.task_control["dsl"] = {"graph": {"nodes": [{"data": {"api_key": secret}}]}}
    context.goal_text = f"Keep {secret} private"
    context.requirements = {"style": secret, "password": "another-secret"}
    context.plan_output_summary = f"A report without {secret}"
    context.risk = Risk(level="high", reason=f"Never quote {secret}", has_external_side_effect=True)
    run = Run(
        id="run",
        session_id=session.id,
        dify_run_id="native",
        status="failed",
        error="RAW ERROR",
        per_node=[NodeOutput(inputs={"raw": "RAW INPUT"}, outputs={"raw": "RAW OUTPUT"})],
        verification=RunVerification(
            execution_revision="rev",
            executed_graph_revision="graph-rev",
            terminal_outputs={"answer": "RAW TERMINAL OUTPUT"},
            output_findings=[],
            executed_node_ids=[],
            no_output_dead_branch=False,
        ),
    )
    env.repo.save_run(session.id, run)
    context.verify_run_id = "run"
    task_lifecycle.record_task_completion(env, session, context, "kept_draft")
    summary = context.task_summaries[0]
    serialized = json.dumps(asdict(summary))
    assert secret not in serialized
    assert "another-secret" not in serialized
    assert all(value not in serialized for value in ("RAW ERROR", "RAW INPUT", "RAW OUTPUT", "RAW TERMINAL OUTPUT"))
    assert summary.test_evidence.run_id == "run"
    assert summary.test_evidence.native_run_id == "native"
    assert summary.test_evidence.status == "failed"
    assert not summary.test_evidence.sealed
    assert "external_side_effects" in summary.unresolved_risks


def test_completed_history_is_bounded_and_older_task_evidence_does_not_become_current() -> None:
    from services.dify_builder import task_lifecycle

    env, session, context = task_env()
    env.repo.save_run(
        session.id, Run(id="old-run", session_id=session.id, status="succeeded", origin_task_id="session:0")
    )
    for ordinal in range(10):
        context.goal_text = "x" * 10_000
        context.verify_run_id = "old-run" if ordinal else ""
        task_lifecycle.record_task_completion(env, session, context, "kept_draft")
        if ordinal < 9:
            task_lifecycle.advance_task_identity(session, context, EntryMode.EDIT)
    assert len(context.task_summaries) == 8
    assert context.task_summaries[0].task_id == "session:2"
    assert context.task_summaries[-1].task_id == "session:9"
    assert len(context.task_summaries[-1].goal) <= 2000
    assert context.task_summaries[-1].test_evidence.status == "not_run"


def test_summary_scope_is_independent_of_execution_generation_and_grants_no_authority() -> None:
    from services.dify_builder import task_lifecycle

    env, session, context = task_env()
    task_lifecycle.record_task_completion(env, session, context, "kept_draft")
    with task_lifecycle.task_summary_scope(context.task_summaries):
        prompt = task_lifecycle.append_task_summaries("Latest goal")
    assert "Summarize reports" in prompt
    assert "session:0" in prompt
    assert "cannot authorize" in prompt
    assert task_lifecycle.append_task_summaries("Latest goal") == "Latest goal"


@pytest.mark.parametrize("mode", [EntryMode.BUILD, EntryMode.EDIT, EntryMode.FIX])
@pytest.mark.parametrize("outcome", ["kept_draft", "published"])
def test_actual_completion_exits_record_summary_with_native_evidence(mode: EntryMode, outcome: str) -> None:
    from services.dify_builder.application import handlers_build, handlers_edit, handlers_fix
    from tests.unit_tests.core.dify_builder.fakes import successful_verification

    env, session, context = task_env()
    session.entry_mode = mode
    session.current_state = {
        EntryMode.BUILD: PcState.BUILD_REVIEW,
        EntryMode.EDIT: PcState.EDIT_REVIEW,
        EntryMode.FIX: PcState.FIX_AWAIT_DECISION,
    }[mode]
    assert isinstance(env.dify, FakeDifyPort)
    run = Run(
        id="verified",
        session_id=session.id,
        kind="verify",
        immutable=True,
        status="succeeded",
        dify_run_id="dify-run-1",
        verification=successful_verification(env.dify),
    )
    env.repo.save_run(session.id, run)
    context.verify_run_id = run.id
    module = {EntryMode.BUILD: handlers_build, EntryMode.EDIT: handlers_edit, EntryMode.FIX: handlers_fix}[mode]
    turn = Turn(
        actor=Actor(account_id="u", tenant_id="t"),
        action=Action(kind="keep_draft", payload={}, base_version=session.version),
    )
    if outcome == "published":
        result = module.handle_publish(env, turn, session, context)
    elif mode == EntryMode.FIX:
        result = handlers_fix.handle_await_decision(env, turn, session, context)
    elif mode == EntryMode.BUILD:
        result = handlers_build.handle_review(env, turn, session, context)
    else:
        result = handlers_edit.handle_review(env, turn, session, context)
    assert result.context is context
    assert context.task_status == "completed"
    assert context.task_summaries[0].outcome == outcome
    assert context.task_summaries[0].entry_mode == mode
    assert context.task_summaries[0].test_evidence.run_id == "verified"
    assert context.task_summaries[0].test_evidence.sealed
    assert context.task_summaries[0].test_evidence.business_acceptance_state == "unverified"


def test_failed_publish_gate_does_not_record_completed_summary() -> None:
    from services.dify_builder.application import handlers_build

    env, session, context = task_env()
    # No owned verified Run: the real publication gate refuses before publishing.
    turn = Turn(
        actor=Actor(account_id="u", tenant_id="t"),
        action=Action(kind="publish_workflow", payload={}, base_version=session.version),
    )
    result = handlers_build.handle_publish(env, turn, session, context)
    assert result.next == PcState.BUILD_REVIEW
    assert not context.task_summaries
    assert context.task_status != "completed"


def test_another_run_acceptance_cannot_claim_this_run_passed() -> None:
    from services.dify_builder.task_lifecycle import record_task_completion
    from tests.unit_tests.core.dify_builder.fakes import successful_verification

    env, session, context = task_env()
    assert isinstance(env.dify, FakeDifyPort)
    verification = successful_verification(env.dify)
    verification.business_acceptance = {
        "case_id": "case",
        "contract_digest": "a" * 64,
        "input_digest": "b" * 64,
        "task_id": "business-task",
        "source_digest": "c" * 64,
        "run_id": "another-run",
        "native_run_id": "another-native",
        "test_input_id": "inputs",
        "execution_revision": "h0",
        "graph_revision": verification.executed_graph_revision,
        "execution_state": "succeeded",
        "state": "passed",
    }
    env.repo.save_run(
        session.id,
        Run(
            id="run",
            session_id=session.id,
            status="succeeded",
            dify_run_id="dify-run-1",
            inputs_ref="inputs",
            verification=verification,
        ),
    )
    context.verify_run_id = "run"
    record_task_completion(env, session, context, "kept_draft")
    assert context.task_summaries[0].test_evidence.business_acceptance_state == "unverified"


@pytest.mark.parametrize("json_reply", [False, True])
def test_existing_llm_requests_receive_history_without_a_summary_model_call(json_reply: bool) -> None:
    from services.dify_builder.agent import llm
    from services.dify_builder.task_lifecycle import record_task_completion, task_summary_scope
    from tests.unit_tests.services.dify_builder.test_agent_llm import _FakeInstance

    env, session, context = task_env()
    record_task_completion(env, session, context, "kept_draft")
    model = _FakeInstance(['{"ok": true}' if json_reply else "Ready"])
    with task_summary_scope(context.task_summaries):
        if json_reply:
            assert llm.invoke_json(model, system="Plan", user="New request") == {"ok": True}
        else:
            assert llm.invoke_text(model, system="Plan", user="New request") == "Ready"
    assert len(model.calls) == 1
    user_message = model.calls[0][1]
    assert "Summarize reports" in str(user_message.content)
    assert "cannot authorize" in str(user_message.content)


def test_large_latest_summary_still_supplies_goal_and_evidence_within_prompt_budget() -> None:
    from services.dify_builder.task_lifecycle import append_task_summaries, record_task_completion, task_summary_scope

    env, session, context = task_env()
    context.goal_text = "Latest goal " * 300
    context.requirements = {f"constraint-{index}": "value " * 300 for index in range(32)}
    context.resource_selection = {"resource_ids": [f"tool:{index}:" + "x" * 490 for index in range(16)]}
    context.change_set = ChangeSet(
        changed_nodes=[f"node-{index}-" + "x" * 110 for index in range(64)], diff="diff " * 500
    )
    context.plan_output_summary = "contract " * 200
    record_task_completion(env, session, context, "kept_draft")
    with task_summary_scope(context.task_summaries):
        prompt = append_task_summaries("New request")
    assert "Latest goal" in prompt
    assert "test_evidence" in prompt
    assert len(prompt) < 25_000


def test_sealed_proof_for_another_native_run_is_not_this_runs_verification() -> None:
    from services.dify_builder.task_lifecycle import record_task_completion
    from tests.unit_tests.core.dify_builder.fakes import successful_verification

    env, session, context = task_env()
    assert isinstance(env.dify, FakeDifyPort)
    env.repo.save_run(
        session.id,
        Run(
            id="run",
            session_id=session.id,
            status="succeeded",
            dify_run_id="another-native",
            verification=successful_verification(env.dify),
        ),
    )
    context.verify_run_id = "run"
    record_task_completion(env, session, context, "kept_draft")
    evidence = context.task_summaries[0].test_evidence
    assert evidence.status == "succeeded"
    assert not evidence.sealed
    assert evidence.business_acceptance_state == "unverified"
    assert "verification_unbound" in context.task_summaries[0].unresolved_risks


def test_legacy_invalid_active_mode_cannot_break_a_successful_completion() -> None:
    from services.dify_builder.task_lifecycle import record_task_completion

    env, session, context = task_env()
    context.active_entry_mode = "obsolete-mode"
    record_task_completion(env, session, context, "kept_draft")
    assert context.task_summaries[0].entry_mode == EntryMode.BUILD


def test_memory_fix_selection_prefers_owned_writer_and_never_reuses_cleared_conversation() -> None:
    repo = InMemoryRepository()
    first = Session(
        id="first",
        app_id="app",
        tenant_id="t",
        owner_account_id="u",
        entry_mode=EntryMode.EDIT,
        current_state=PcState.EDIT_REVIEW,
    )
    repo.create_session(first, DifyBuilderContext(), [])
    foreign = Session(
        id="foreign",
        app_id="app",
        tenant_id="t",
        owner_account_id="other",
        entry_mode=EntryMode.EDIT,
        current_state=PcState.EDIT_REVIEW,
    )
    repo.create_session(foreign, DifyBuilderContext(), [])
    cleared = Session(
        id="cleared",
        app_id="app",
        tenant_id="t",
        owner_account_id="u",
        entry_mode=EntryMode.EDIT,
        current_state=PcState.EDIT_REVIEW,
    )
    repo.create_session(cleared, DifyBuilderContext(task_control={"conversation_clear": {"version": 1}}), [])
    assert repo.reserve_workflow_writer(first.id, "writer", 0, 60)
    candidate = Session(
        id="candidate",
        app_id="app",
        tenant_id="t",
        owner_account_id="u",
        entry_mode=EntryMode.FIX,
        current_state=PcState.FIX_DIAGNOSE,
    )
    skipped_run = Run(id="not-persisted", status="failed", immutable=True)
    selected, created = repo.create_fix_session_or_select(candidate, DifyBuilderContext(), [], source_run=skipped_run)
    assert selected.id == "first"
    assert not created
    assert "not-persisted" not in repo._runs
    other_app = Session(
        id="other-app",
        app_id="other",
        tenant_id="t",
        owner_account_id="u",
        entry_mode=EntryMode.FIX,
        current_state=PcState.FIX_DIAGNOSE,
    )
    source_run = Run(id="source", status="failed", immutable=True)
    selected, created = repo.create_fix_session_or_select(other_app, DifyBuilderContext(), [], source_run=source_run)
    assert created
    assert selected.id == "other-app"
    assert repo.get_session("other-app")[0].version == 1
    assert repo.get_run("source").session_id == "other-app"
    assert repo.get_run("source").origin_task_id == "other-app:0"


def test_memory_abandoned_activation_is_scoped_idempotent_and_appends_goal_once() -> None:
    from core.dify_builder.errors import ConflictError, NotFoundError

    env, session, context = task_env()
    context.task_status = "abandoned"
    context.paused = True
    context.task_control = {"generation": 4, "settlement": "settled"}
    env.repo.create_session(session, context, [])
    actor = Actor(account_id="u", tenant_id="t")
    first, fresh, created = env.repo.activate_abandoned_continuation(
        session.id,
        actor,
        base_version=1,
        client_turn_id="fresh-turn",
        text="New goal",
        app_revision="revision",
        dsl={"graph": {}},
        expected_task_id="session:0",
    )
    assert created
    assert first.version == 2
    assert fresh.task_control["generation"] == 5
    assert fresh.logical_task_id == "session:1"
    repeated, context, created = env.repo.activate_abandoned_continuation(
        session.id,
        actor,
        base_version=1,
        client_turn_id="fresh-turn",
        text="New goal",
        app_revision="revision",
        dsl={"graph": {}},
        expected_task_id="session:0",
    )
    assert not created
    assert repeated.version == 2
    assert context.task_control["fresh_goal_receipt"]["new_task_id"] == "session:1"
    assert len(env.repo.list_conversation(session.id)) == 1
    assert env.repo.list_conversation(session.id)[0].payload == {"text": "New goal", "turn_id": "fresh-turn"}
    with pytest.raises(ConflictError):
        env.repo.activate_abandoned_continuation(
            session.id,
            actor,
            base_version=1,
            client_turn_id="fresh-turn",
            text="Different goal",
            app_revision="revision",
            dsl={"graph": {}},
            expected_task_id="session:0",
        )
    with pytest.raises(NotFoundError):
        env.repo.activate_abandoned_continuation(
            session.id,
            Actor(account_id="other", tenant_id="t"),
            base_version=1,
            client_turn_id="fresh-turn",
            text="New goal",
            app_revision="revision",
            dsl={"graph": {}},
            expected_task_id="session:0",
        )
