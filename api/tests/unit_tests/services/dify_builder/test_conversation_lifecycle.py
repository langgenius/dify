"""Durable clear isolates public history and fences late SQL writes."""

import importlib
from dataclasses import asdict
from functools import partial
from types import ModuleType
from typing import NoReturn

import pytest
from sqlalchemy import select

from core.dify_builder.errors import BadRequestError, ConflictError, NotFoundError
from core.dify_builder.models import (
    Actor,
    Checkpoint,
    ConversationItem,
    DifyBuilderContext,
    EntryMode,
    Run,
    Session,
    Snapshot,
    TestInput,
)
from core.dify_builder.state import PcState
from models.dify_builder import DifyBuilderConversationItem, DifyBuilderRun
from services.dify_builder.repository import SqlDifyBuilderRepository
from services.dify_builder.service import DifyBuilderService
from services.dify_builder.task_controls import ExecutionFence, execution_scope, require_active
from tests.unit_tests.services.dify_builder.test_service import ACCOUNT_ID, APP_ID, TENANT_ID, _actor

pytest_plugins = ["tests.unit_tests.services.dify_builder.test_service"]


def seed(repo: SqlDifyBuilderRepository) -> Session:
    session = Session(
        app_id=APP_ID,
        tenant_id=TENANT_ID,
        owner_account_id=ACCOUNT_ID,
        entry_mode=EntryMode.BUILD,
        current_state=PcState.BUILD_PLAN_APPROVAL,
    )
    repo.create_session(
        session,
        DifyBuilderContext(
            goal_text="private goal",
            attachment_material=[{"text": "private upload"}],
            checkpoint_id="restore",
            test_input_ref="inputs",
            task_control={"generation": 3},
        ),
        [
            ConversationItem(seq=0, kind="user", payload={"text": "private goal"}),
            ConversationItem(seq=1, kind="assistant_turn", payload={"message": "private reply"}),
        ],
    )
    return session


def lifecycle() -> ModuleType:
    return importlib.import_module("services.dify_builder.conversation_lifecycle")


def forbidden(*_args: object, **_kwargs: object) -> NoReturn:
    raise AssertionError("clear must not inspect workflow, build ordinary view, or dispatch")


def test_clear_requires_confirmation_and_permanently_hides_history_without_graph_reads(
    service: DifyBuilderService, repo: SqlDifyBuilderRepository
) -> None:
    session = seed(repo)
    service._get_app_revision_fn = forbidden
    service._read_task_dsl_fn = forbidden
    service._build_session_view = forbidden
    service._enqueue_fn = forbidden
    owner = lifecycle()
    with pytest.raises(BadRequestError):
        owner.clear(service, session.id, _actor(), base_version=1, client_action_id="clear")
    receipt = owner.clear(service, session.id, _actor(), base_version=1, client_action_id="clear", confirmed=True)
    assert receipt["conversation_cleared"] is True
    assert receipt["task_status"] == "abandoned"
    assert (
        owner.clear(service, session.id, _actor(), base_version=1, client_action_id="clear", confirmed=True) == receipt
    )
    _, context = repo.get_session(session.id)
    assert context.goal_text == ""
    assert context.attachment_material == []
    assert context.checkpoint_id == context.test_input_ref == ""
    assert owner.is_conversation_cleared(context)
    assert repo.list_conversation(session.id) == []
    assert repo.list_recent_conversation(session.id, limit=24) == []
    assert repo.list_conversation_page(session.id, limit=5, before_seq=100).data == []
    assert repo.list_conversation_page(session.id, limit=5, after_seq=-1).data == []
    assert repo.get_latest_conversation_item(session.id, frozenset({"assistant_turn"})) is None
    # Private evidence remains physically retained; public history does not revive it.
    with repo._session_factory() as sql:
        assert len(list(sql.scalars(select(DifyBuilderConversationItem)))) == 2
    with pytest.raises(ConflictError):
        repo.get_session_at_version(session.id, 1)
    with pytest.raises(ConflictError):
        repo.compare_and_advance(session.id, receipt["version"], session.current_state, DifyBuilderContext(), [])


@pytest.mark.parametrize("write", ["checkpoint", "run", "input"])
def test_clear_fences_late_insert_in_its_sql_transaction(
    service: DifyBuilderService, repo: SqlDifyBuilderRepository, write: str
) -> None:
    session = seed(repo)
    fence = ExecutionFence(session.id, 3, lambda: require_active(repo, session.id, 3), {})
    lifecycle().clear(service, session.id, _actor(), base_version=1, client_action_id="clear", confirmed=True)

    def late_insert() -> None:
        if write == "checkpoint":
            repo.create_checkpoint(
                Checkpoint(session_id=session.id, state=session.current_state), Snapshot(session_id=session.id)
            )
        elif write == "run":
            repo.save_run(session.id, Run(kind="verify", status="failed"))
        else:
            repo.save_test_input(TestInput(session_id=session.id, inputs={"private": "value"}))

    with execution_scope(fence), pytest.raises(ConflictError):
        late_insert()


@pytest.mark.parametrize("settlement", ["settled", "pending", "unknown"])
def test_clear_reload_projects_durable_settlement_without_reviving_history(
    service: DifyBuilderService, repo: SqlDifyBuilderRepository, settlement: str
) -> None:
    from copy import deepcopy

    from services.dify_builder.wiring import _public_session_view, session_view_to_dict

    session = seed(repo)
    base = session.version
    if settlement != "settled":
        run = Run(kind="verify", status="unknown" if settlement == "unknown" else "running", inputs_ref="inputs")
        repo.save_run(session.id, run)
        current, context = repo.get_session(session.id)
        context.verify_run_id = run.id
        base = repo.compare_and_advance(session.id, current.version, current.current_state, context, [])
    receipt = lifecycle().clear(
        service, session.id, _actor(), base_version=base, client_action_id="clear", confirmed=True
    )
    original = deepcopy(receipt)
    assert receipt["settlement"] == settlement
    service._get_app_revision_fn = forbidden
    service._read_task_dsl_fn = forbidden
    service._build_session_view = forbidden
    service._enqueue_fn = forbidden
    view = service.get_session_view(session.id, _actor())
    assert view.lifecycle_settlement == settlement
    assert view.conversation_cleared
    assert view.conversation_last_seq == -1
    assert view.test_execution is None
    assert view.attachments == []
    assert service.get_conversation_page(session.id, _actor(), limit=20).data == []
    streamed = service._read_stream_session_view(session.id, _actor())
    assert streamed is not None
    assert _public_session_view(streamed, include_last_command_id=False)["lifecycle_settlement"] == settlement
    assert session_view_to_dict(view)["lifecycle_settlement"] == settlement
    assert (
        lifecycle().clear(service, session.id, _actor(), base_version=base, client_action_id="clear", confirmed=True)
        == original
    )
    assert repo.get_session(session.id)[0].version == receipt["version"]
    with pytest.raises(NotFoundError):
        service.get_session_view(session.id, Actor(account_id="other", tenant_id=TENANT_ID))


@pytest.mark.parametrize("cleared", [True, False])
@pytest.mark.parametrize(
    "evidence",
    [
        {},
        {"settlement": "settled"},
        {"lifecycle_receipt": {"id": "old"}, "settlement": "settled"},
        {"lifecycle_receipt": {"id": "current"}},
        {"lifecycle_receipt": {"id": "current"}, "settlement": "unproved"},
        {"lifecycle_receipt": None, "settlement": "settled"},
        {"lifecycle_receipt": {"id": "current"}, "settlement": []},
    ],
)
def test_applicable_lifecycle_without_current_control_evidence_is_unknown(
    service: DifyBuilderService, repo: SqlDifyBuilderRepository, cleared: bool, evidence: dict[str, object]
) -> None:
    session = Session(
        app_id=APP_ID,
        tenant_id=TENANT_ID,
        owner_account_id=ACCOUNT_ID,
        entry_mode=EntryMode.BUILD,
        current_state=PcState.BUILD_PLAN_APPROVAL,
    )
    context = DifyBuilderContext(task_status="abandoned", last_command_id="current", task_control=dict(evidence))
    if cleared:
        context.task_control["conversation_clear"] = {"version": 1, "seq_floor": 0}
    repo.create_session(session, context, [])
    assert service.get_session_view(session.id, _actor()).lifecycle_settlement == "unknown"


def test_abandon_get_observes_current_settlement_without_replaying_cancel_or_old_receipt(
    service: DifyBuilderService, repo: SqlDifyBuilderRepository, monkeypatch: pytest.MonkeyPatch
) -> None:
    from copy import deepcopy

    from models.dify_builder import DifyBuilderExecutionRequest
    from services.dify_builder.native_testing.public_contracts import NativeTestPublicReceipt
    from services.dify_builder.test_actions import BuilderTestActions

    session = seed(repo)
    request_id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    with repo._session_factory() as sql, sql.begin():
        sql.add(
            DifyBuilderExecutionRequest(
                id=request_id,
                tenant_id=TENANT_ID,
                app_id=APP_ID,
                workflow_id="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                actor_id=ACCOUNT_ID,
                session_id=session.id,
                test_input_id="inputs",
                context={"policy_version": "builder-native-test-v1"},
                context_digest="a" * 64,
                state="running",
            )
        )
    current = NativeTestPublicReceipt(
        request_id=request_id,
        generation=0,
        version=1,
        status="running",
        wait_reason=None,
        native_run_id=None,
        native_status=None,
        pending=(),
        outcome=None,
        evidence_refs=(),
    )
    cancellations: list[str] = []

    def execute(**_kwargs: object) -> NativeTestPublicReceipt:
        cancellations.append("cancel")
        return current

    actions = BuilderTestActions(repo._session_factory, forbidden)
    monkeypatch.setattr(actions, "execute", execute)
    monkeypatch.setattr(actions, "current", lambda **_kwargs: current)
    service._test_actions = actions
    receipt = lifecycle().abandon(service, session.id, _actor(), base_version=1, client_action_id="abandon")
    original = deepcopy(receipt)
    assert receipt["settlement"] == "pending"
    assert service.get_session_view(session.id, _actor()).lifecycle_settlement == "pending"
    current = current.model_copy(update={"status": "terminal", "outcome": "cancelled"})
    with repo._session_factory() as sql, sql.begin():
        request = sql.get(DifyBuilderExecutionRequest, request_id)
        assert request is not None
        request.state = "sealed"
        request.completion_summary = {"outcome": "cancelled"}
    view = service.get_session_view(session.id, _actor())
    assert view.lifecycle_settlement == "settled"
    assert cancellations == ["cancel"]
    assert lifecycle().abandon(service, session.id, _actor(), base_version=1, client_action_id="abandon") == original
    assert repo.get_session(session.id)[1].task_control["lifecycle_receipt"]["receipt"] == original
    current_task, context, activated = repo.activate_abandoned_continuation(
        session.id,
        _actor(),
        base_version=view.version,
        client_turn_id="fresh",
        text="New task",
        app_revision="revision",
        dsl={"graph": {"nodes": []}},
    )
    assert activated
    assert context.task_control["lifecycle_receipt"]["receipt"] == original
    assert service.get_session_view(current_task.id, _actor()).lifecycle_settlement is None


def test_clear_keeps_run_evidence_and_rejects_cross_owner_or_key_reuse(
    service: DifyBuilderService, repo: SqlDifyBuilderRepository
) -> None:
    session = seed(repo)
    run = Run(kind="verify", status="failed", immutable=True, inputs_ref="inputs")
    repo.save_run(session.id, run)
    expected = asdict(repo.get_run(run.id))
    with pytest.raises(NotFoundError):
        lifecycle().clear(
            service,
            session.id,
            Actor(account_id="other", tenant_id=TENANT_ID),
            base_version=1,
            client_action_id="clear",
            confirmed=True,
        )
    lifecycle().clear(service, session.id, _actor(), base_version=1, client_action_id="clear", confirmed=True)
    assert asdict(repo.get_run(run.id)) == expected
    with pytest.raises(ConflictError):
        lifecycle().abandon(service, session.id, _actor(), base_version=1, client_action_id="clear")
    with repo._session_factory() as sql:
        assert sql.scalar(select(DifyBuilderRun.id)) == run.id


def test_abandon_keeps_transcript_but_invalidates_cards_and_switch_stop_is_view_free(
    service: DifyBuilderService, repo: SqlDifyBuilderRepository
) -> None:
    session = seed(repo)
    service._build_session_view = forbidden
    owner = lifecycle()
    stopped, context = owner.stop_task_for_switch(
        service, session.id, _actor(), expected_task_id=session.id + ":0", client_action_id="switch"
    )
    assert context.paused
    assert owner.observe_task_stop(service, session.id, _actor(), client_action_id="switch") == "settled"
    receipt = owner.abandon(service, session.id, _actor(), base_version=stopped.version, client_action_id="abandon")
    assert receipt["task_status"] == "abandoned"
    assert receipt["conversation_cleared"] is False
    assert len(repo.list_conversation(session.id)) == 2
    assert repo.list_conversation(session.id)[1].payload["card_state"] == "invalidated"


def test_create_fix_selects_existing_owner_session_under_app_lock(
    service: DifyBuilderService, repo: SqlDifyBuilderRepository
) -> None:
    from models.model import App, AppMode, IconType

    with repo._session_factory() as sql, sql.begin():
        sql.add(
            App(
                id=APP_ID,
                tenant_id=TENANT_ID,
                name="app",
                mode=AppMode.WORKFLOW,
                enable_api=True,
                enable_site=True,
                icon_type=IconType.EMOJI,
                icon="",
                icon_background="",
            )
        )
    first = seed(repo)
    candidate = Session(
        app_id=APP_ID,
        tenant_id=TENANT_ID,
        owner_account_id=ACCOUNT_ID,
        entry_mode=EntryMode.FIX,
        current_state=PcState.FIX_DIAGNOSE,
    )
    selected, created = repo.create_fix_session_or_select(candidate, DifyBuilderContext(), [])
    assert not created
    assert selected.id == first.id
    lifecycle().clear(service, first.id, _actor(), base_version=1, client_action_id="clear", confirmed=True)
    selected, created = repo.create_fix_session_or_select(candidate, DifyBuilderContext(), [])
    assert created
    assert selected.id == candidate.id
    assert selected.id != first.id


def test_clearing_another_conversation_does_not_hide_current_owner_history(
    service: DifyBuilderService, repo: SqlDifyBuilderRepository
) -> None:
    first = seed(repo)
    second = seed(repo)
    lifecycle().clear(service, first.id, _actor(), base_version=1, client_action_id="clear", confirmed=True)
    assert len(repo.list_conversation(second.id)) == 2
    assert repo.list_builder_material(first.id, _actor()) == []


def test_abandon_replay_does_not_release_a_later_task_writer(
    service: DifyBuilderService, repo: SqlDifyBuilderRepository
) -> None:
    from services.dify_builder.task_lifecycle import advance_task_identity

    session = seed(repo)
    original = lifecycle().abandon(service, session.id, _actor(), base_version=1, client_action_id="abandon")
    current, context = repo.get_session(session.id)
    advance_task_identity(current, context, EntryMode.EDIT)
    context.paused = False
    context.last_command_id = "new-task"
    repo.compare_and_advance(session.id, current.version, PcState.EDIT_CAPABILITY_CHECK, context, [])
    token = service._acquire_workflow_writer(session.id)
    assert token is not None
    assert lifecycle().abandon(service, session.id, _actor(), base_version=1, client_action_id="abandon") == original
    assert service._session_lock.current_owner(session.id) == token


def test_switch_stop_does_not_pause_a_task_that_completed_before_lock(
    service: DifyBuilderService, repo: SqlDifyBuilderRepository
) -> None:
    session = seed(repo)
    current, context = repo.get_session(session.id)
    repo.compare_and_advance(session.id, current.version, PcState.BUILD_COMPLETE, context, [])
    stopped, context = lifecycle().stop_task_for_switch(
        service, session.id, _actor(), expected_task_id=session.id + ":0", client_action_id="switch"
    )
    assert stopped.current_state == PcState.BUILD_COMPLETE
    assert not context.paused


def test_clear_revokes_retained_native_scope_without_claiming_cleanup(
    service: DifyBuilderService, repo: SqlDifyBuilderRepository
) -> None:
    from datetime import UTC, datetime, timedelta

    from models.dify_builder import DifyBuilderExecutionRequest
    from models.dify_builder_native_tests import NativeTestScope

    session = seed(repo)
    request_id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    with repo._session_factory() as sql, sql.begin():
        sql.add(
            DifyBuilderExecutionRequest(
                id=request_id,
                tenant_id=TENANT_ID,
                app_id=APP_ID,
                workflow_id="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                actor_id=ACCOUNT_ID,
                session_id=session.id,
                test_input_id="retained-older-input",
                context={"policy_version": "builder-native-test-v1"},
                context_digest="a" * 64,
                state="running",
            )
        )
        sql.add(
            NativeTestScope(
                request_id=request_id,
                tenant_id=TENANT_ID,
                generation=0,
                task_approved=True,
                cancelled=False,
                expires_at=datetime.now(UTC) + timedelta(minutes=5),
                budget_limits={},
                budget_spent={},
                profile={},
                max_calls=1,
                max_dispatches=1,
                max_cost_units=1,
            )
        )
    receipt = lifecycle().clear(service, session.id, _actor(), base_version=1, client_action_id="clear", confirmed=True)
    assert receipt["settlement"] == "pending"
    with repo._session_factory() as sql:
        assert sql.get(NativeTestScope, request_id).cancelled
        assert sql.get(DifyBuilderExecutionRequest, request_id).state == "running"


def test_abandoned_goal_activation_is_atomic_and_once_only(
    service: DifyBuilderService, repo: SqlDifyBuilderRepository
) -> None:
    session = seed(repo)
    receipt = lifecycle().abandon(service, session.id, _actor(), base_version=1, client_action_id="abandon")
    activate = partial(
        repo.activate_abandoned_continuation,
        session.id,
        _actor(),
        base_version=receipt["version"],
        client_turn_id="fresh-goal",
        app_revision="current-revision",
        dsl={"graph": {"nodes": list[object]()}},
    )
    current, context, activated = activate(text="New synthetic goal")
    assert activated
    assert current.current_state == PcState.EDIT_CAPABILITY_CHECK
    assert not context.paused
    assert context.task_status == "active"
    assert context.task_control["generation"] == 5
    assert context.logical_task_id.endswith(":1")
    assert context.goal_text == "New synthetic goal"
    assert context.attachment_material == []
    assert repo.list_conversation(session.id)[-1].payload["turn_id"] == "fresh-goal"
    again, _, activated = activate(text="New synthetic goal")
    assert not activated
    assert again.version == current.version
    assert len(repo.list_conversation(session.id)) == 3
    with pytest.raises(ConflictError):
        activate(text="Different goal")


@pytest.mark.parametrize("operation", ["clear", "abandon"])
def test_independent_resume_cannot_revive_closed_task(
    service: DifyBuilderService, repo: SqlDifyBuilderRepository, operation: str
) -> None:
    service._read_task_dsl_fn = forbidden
    session = seed(repo)
    if operation == "clear":
        receipt = lifecycle().clear(
            service, session.id, _actor(), base_version=1, client_action_id="close", confirmed=True
        )
    else:
        receipt = lifecycle().abandon(service, session.id, _actor(), base_version=1, client_action_id="close")
    with pytest.raises(ConflictError):
        service.resume_task(session.id, _actor(), base_version=receipt["version"], client_action_id="resume-closed")
    assert repo.get_session(session.id)[1].paused


def test_resume_rechecks_abandon_after_its_dsl_read(
    service: DifyBuilderService, repo: SqlDifyBuilderRepository
) -> None:
    session = seed(repo)
    stopped = service.stop_task(session.id, _actor(), base_version=1, client_action_id="stop")

    def read_then_abandon(*_args: object) -> tuple[dict[str, object], str]:
        lifecycle().abandon(service, session.id, _actor(), base_version=stopped.version, client_action_id="abandon")
        return dict[str, object](), "current-revision"

    service._read_task_dsl_fn = read_then_abandon
    with pytest.raises(ConflictError):
        service.resume_task(session.id, _actor(), base_version=stopped.version, client_action_id="racing-resume")
    _, context = repo.get_session(session.id)
    assert context.task_status == "abandoned"
    assert context.paused


def test_test_command_history_does_not_bypass_clear_boundary(
    service: DifyBuilderService, repo: SqlDifyBuilderRepository
) -> None:
    from services.dify_builder.test_actions import BuilderTestActions

    session = seed(repo)
    current, context = repo.get_session(session.id)
    context.next_seq = 3
    repo.compare_and_advance(
        session.id,
        current.version,
        current.current_state,
        context,
        [ConversationItem(seq=2, kind="decision", payload={"test_command_id": "old-command", "receipt": "private"})],
    )
    actions = BuilderTestActions(repo._session_factory, lambda **_: forbidden())
    lifecycle().clear(service, session.id, _actor(), base_version=1, client_action_id="clear", confirmed=True)
    assert actions.find_command(actor=_actor(), session_id=session.id, command_id="old-command") is None


def test_abandoned_goal_rejects_autosave_after_dsl_capture(
    service: DifyBuilderService, repo: SqlDifyBuilderRepository
) -> None:
    import json

    from models.workflow import Workflow
    from services.dify_builder.task_controls import draft_binding

    session = seed(repo)
    closed = lifecycle().abandon(service, session.id, _actor(), base_version=1, client_action_id="abandon")
    with repo._session_factory() as sql, sql.begin():
        workflow = Workflow.new(
            tenant_id=TENANT_ID,
            app_id=APP_ID,
            type="workflow",
            version="draft",
            created_by=ACCOUNT_ID,
            graph=json.dumps({"nodes": list[object](), "edges": []}),
            features="{}",
            environment_variables=[],
            conversation_variables=[],
            rag_pipeline_variables=[],
        )
        sql.add(workflow)
        sql.flush()
        workflow_id, captured = workflow.id, draft_binding(workflow)
    with repo._session_factory() as sql, sql.begin():
        workflow = sql.get(Workflow, workflow_id)
        assert workflow is not None
        workflow.features = '{"edited":true}'
    with pytest.raises(ConflictError, match="synchronizing"):
        repo.activate_abandoned_continuation(
            session.id,
            _actor(),
            base_version=closed["version"],
            client_turn_id="stale-goal",
            text="Fresh goal",
            app_revision="captured",
            dsl={"_draft_binding": {"workflow_id": workflow_id, "digest": captured}},
        )
    assert repo.get_session(session.id)[1].task_status == "abandoned"
    assert len(repo.list_conversation(session.id)) == 2


def test_immutable_unknown_run_cannot_be_erased_by_abandon_and_fresh_goal(
    service: DifyBuilderService, repo: SqlDifyBuilderRepository
) -> None:
    session = seed(repo)
    run = Run(kind="verify", status="unknown", immutable=True)
    repo.save_run(session.id, run)
    current, context = repo.get_session(session.id)
    context.verify_run_id = run.id
    version = repo.compare_and_advance(session.id, current.version, current.current_state, context, [])
    receipt = lifecycle().abandon(service, session.id, _actor(), base_version=version, client_action_id="abandon")
    current, context = repo.get_session(session.id)
    assert receipt["settlement"] == "unknown"
    assert context.task_control["settlement"] == "unknown"
    with pytest.raises(ConflictError):
        repo.activate_abandoned_continuation(
            session.id,
            _actor(),
            base_version=current.version,
            client_turn_id="fresh-after-unknown",
            text="Fresh goal",
            app_revision="current",
            dsl={},
        )
    assert repo.get_run(run.id).status == "unknown"


def test_clear_never_replays_an_older_abandon_receipt(
    service: DifyBuilderService, repo: SqlDifyBuilderRepository
) -> None:
    session = seed(repo)
    abandoned = lifecycle().abandon(service, session.id, _actor(), base_version=1, client_action_id="old-abandon")
    lifecycle().clear(
        service, session.id, _actor(), base_version=abandoned["version"], client_action_id="clear", confirmed=True
    )
    with pytest.raises(ConflictError):
        lifecycle().abandon(service, session.id, _actor(), base_version=1, client_action_id="old-abandon")
