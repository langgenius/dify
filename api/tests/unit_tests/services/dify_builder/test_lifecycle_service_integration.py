"""Service integration keeps cleared reads and lifecycle controls graph-free."""

from typing import NoReturn

import pytest

from core.dify_builder.contract import RunStatus
from core.dify_builder.errors import ConflictError
from core.dify_builder.models import Action, Actor, ConversationItem, DifyBuilderContext, EntryMode, Session
from core.dify_builder.state import PcState
from services.dify_builder.repository import SqlDifyBuilderRepository
from services.dify_builder.service import DifyBuilderService
from tests.unit_tests.services.dify_builder.test_service import (
    ACCOUNT_ID,
    APP_ID,
    TENANT_ID,
    FakeSessionLock,
)

pytest_plugins = ["tests.unit_tests.services.dify_builder.test_service"]


def test_cleared_session_read_is_empty_and_does_not_read_the_workflow(repo: SqlDifyBuilderRepository) -> None:
    def forbidden(*_args: object, **_kwargs: object) -> NoReturn:
        pytest.fail("cleared projection must not read workflow or enqueue")

    session = Session(
        app_id=APP_ID,
        tenant_id=TENANT_ID,
        owner_account_id=ACCOUNT_ID,
        entry_mode=EntryMode.BUILD,
        current_state=PcState.BUILD_PLAN_APPROVAL,
    )
    context = DifyBuilderContext(
        paused=True,
        next_seq=3,
        task_status="abandoned",
        task_control={"conversation_clear": {"version": 1, "seq_floor": 3}},
    )
    repo.create_session(session, context, [ConversationItem(seq=0, kind="user", payload={"text": "old secret"})])
    service = DifyBuilderService(
        repo,
        FakeSessionLock(),
        forbidden,
        get_app_revision_fn=forbidden,
        get_verification_identity_fn=forbidden,
        read_task_dsl_fn=forbidden,
    )
    actor = Actor(account_id=ACCOUNT_ID, tenant_id=TENANT_ID)
    view = service.get_session_view(session.id, actor)
    assert view.conversation_cleared
    assert view.task_status == "abandoned"
    assert view.run_status == RunStatus.COMPLETE
    assert view.actions == []
    assert view.diagnostics == []
    assert view.attachments == []
    assert view.app_revision is None
    assert service.get_conversation_page(session.id, actor, limit=20).data == []
    with pytest.raises(ConflictError, match="clear"):
        service.submit_action(session.id, actor, Action(kind="check_recovery", base_version=1))


def test_service_task_metadata_uses_logical_identity_not_execution_generation(repo: SqlDifyBuilderRepository) -> None:
    session = Session(
        app_id=APP_ID,
        tenant_id=TENANT_ID,
        owner_account_id=ACCOUNT_ID,
        entry_mode=EntryMode.BUILD,
        current_state=PcState.BUILD_PLAN_APPROVAL,
    )
    repo.create_session(session, DifyBuilderContext(logical_task_id="logical-1", task_control={"generation": 9}), [])
    service = DifyBuilderService(repo, FakeSessionLock(), lambda *_args: None)
    view = service.get_session_view(session.id, Actor(account_id=ACCOUNT_ID, tenant_id=TENANT_ID))
    assert view.task_id == "logical-1"
    assert view.task_status == "active"


def test_cleared_stream_never_emits_preexisting_payload() -> None:
    from services.dify_builder.wiring import stream_advance_frames

    frames = list(
        stream_advance_frames(
            {"session_id": "s1", "version": 2, "run_status": "processing"},
            None,
            True,
            initial_items=[ConversationItem(seq=0, kind="user", payload={"text": "private old text"})],
            conversation_cleared=lambda: True,
            read_session_view=lambda: {"session_id": "s1", "version": 3, "conversation_cleared": True},
        )
    )
    assert len(frames) == 1
    assert '"conversation_cleared": true' in frames[0]
    assert "private old text" not in frames[0]


def test_abandoned_message_starts_one_fresh_task_before_worker_dispatch(repo: SqlDifyBuilderRepository) -> None:
    from services.dify_builder.task_controls import generation

    session = Session(
        app_id=APP_ID,
        tenant_id=TENANT_ID,
        owner_account_id=ACCOUNT_ID,
        entry_mode=EntryMode.BUILD,
        current_state=PcState.BUILD_EXECUTION,
    )
    old = DifyBuilderContext(
        paused=True,
        task_status="abandoned",
        logical_task_id="old-task",
        goal_text="old",
        task_control={"generation": 4, "settlement": "settled"},
    )
    repo.create_session(session, old, [])
    enqueued = []
    service = DifyBuilderService(
        repo,
        FakeSessionLock(),
        lambda *args: enqueued.append(args),
        read_task_dsl_fn=lambda *_args: ({"workflow": {"graph": {"nodes": [], "edges": []}}}, "revision-1"),
    )
    actor = Actor(account_id=ACCOUNT_ID, tenant_id=TENANT_ID)
    view = service.submit_action(
        session.id,
        actor,
        Action(kind="message", base_version=1, payload={"text": "new goal", "client_turn_id": "new-turn"}),
    )
    head, context = repo.get_session(session.id)
    assert view.task_id != "old-task"
    assert context.task_status == "active"
    assert not context.paused
    assert generation(context) == 5
    assert len(enqueued) == 1
    dispatched_action = enqueued[0][1]
    assert isinstance(dispatched_action, Action)
    assert dispatched_action.kind == "send_edit_goal"
    assert dispatched_action.execution_generation == 5
    assert [item.payload["text"] for item in repo.list_conversation(session.id) if item.kind == "user"] == ["new goal"]
    replay = service.submit_action(
        session.id,
        actor,
        Action(kind="message", base_version=1, payload={"text": "new goal", "client_turn_id": "new-turn"}),
    )
    assert replay.task_id == view.task_id
    assert len(enqueued) == 1
    assert repo.get_session(session.id)[0].version == head.version


def test_existing_create_fix_reuses_conversation_and_sees_atomic_source_run(repo: SqlDifyBuilderRepository) -> None:
    from models.model import App, AppMode
    from services.dify_builder.fix_intent_repository import SqlFixIntentRepository
    from tests.unit_tests.services.dify_builder.test_fix_intents import native_run

    with repo._session_factory() as sql, sql.begin():
        sql.add(
            App(
                id=APP_ID,
                tenant_id=TENANT_ID,
                name="Synthetic continuity",
                mode=AppMode.WORKFLOW,
                enable_site=False,
                enable_api=False,
            )
        )
    failed = native_run(repo)
    enqueued = []
    service = DifyBuilderService(
        repo, FakeSessionLock(), lambda *args: enqueued.append(args), fix_intent_repo=SqlFixIntentRepository(repo)
    )
    actor = Actor(account_id=ACCOUNT_ID, tenant_id=TENANT_ID)
    first = service.create_fix_session(APP_ID, actor, failed_run_id=failed)
    second = service.create_fix_session(APP_ID, actor, failed_run_id=failed)
    assert first.session_id == second.session_id
    assert len(enqueued) == 1
    assert second.pending_fix_context is None
    source = repo.get_run(repo.get_session(first.session_id)[1].failed_run_id)
    assert source.dify_run_id == failed
    assert source.origin_task_id == first.task_id


def test_abandoned_goal_stream_replay_emits_terminal_without_dispatch(repo: SqlDifyBuilderRepository) -> None:
    session = Session(
        app_id=APP_ID,
        tenant_id=TENANT_ID,
        owner_account_id=ACCOUNT_ID,
        entry_mode=EntryMode.BUILD,
        current_state=PcState.BUILD_EXECUTION,
    )
    repo.create_session(
        session,
        DifyBuilderContext(
            paused=True, task_status="abandoned", task_control={"generation": 4, "settlement": "settled"}
        ),
        [],
    )
    enqueued = []
    service = DifyBuilderService(
        repo,
        FakeSessionLock(),
        lambda *args: enqueued.append(args),
        read_task_dsl_fn=lambda *_args: ({"workflow": {"graph": {"nodes": [], "edges": []}}}, "revision-1"),
    )
    actor = Actor(account_id=ACCOUNT_ID, tenant_id=TENANT_ID)
    payload = {"text": "fresh synthetic goal", "client_turn_id": "stream-new-goal"}
    service.submit_action(session.id, actor, Action(kind="message", base_version=1, payload=payload))
    frames = list(
        service.submit_action_stream(session.id, actor, Action(kind="message", base_version=1, payload=payload))
    )
    assert any('"event": "command_finished"' in frame for frame in frames)
    assert len(enqueued) == 1
