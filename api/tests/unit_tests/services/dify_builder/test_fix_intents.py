"""Fix intake persists separately from an active worker's session CAS."""

from dataclasses import replace
from datetime import datetime
from uuid import uuid4

import pytest
from typing_extensions import TypedDict

from core.dify_builder.contract import RunContextCard
from core.dify_builder.errors import ConflictError, NotFoundError
from core.dify_builder.models import Action, Actor, DifyBuilderContext, EntryMode, Session
from core.dify_builder.state import PcState
from graphon.enums import WorkflowExecutionStatus
from models.dify_builder import DifyBuilderRun, DifyBuilderSession
from models.enums import CreatorUserRole
from models.workflow import WorkflowRun, WorkflowRunTriggeredFrom, WorkflowType
from services.dify_builder.fix_intents import FixIntent
from services.dify_builder.repository import SqlDifyBuilderRepository
from services.dify_builder.service import DifyBuilderService
from tests.unit_tests.services.dify_builder.test_service import ACCOUNT_ID, APP_ID, TENANT_ID, Enqueued

pytest_plugins = ["tests.unit_tests.services.dify_builder.test_service"]

ACTOR = Actor(account_id=ACCOUNT_ID, tenant_id=TENANT_ID)


class _FixControlQuery(TypedDict, closed=True):
    operation: str
    client_action_id: str
    base_version: int
    fix_intent_id: str
    expected_task_id: str


def seed(repo: SqlDifyBuilderRepository, state: PcState = PcState.BUILD_PLAN_APPROVAL) -> Session:
    session = Session(
        app_id=APP_ID,
        tenant_id=TENANT_ID,
        owner_account_id=ACCOUNT_ID,
        entry_mode=EntryMode.BUILD,
        current_state=state,
    )
    repo.create_session(session, DifyBuilderContext(goal_text="Keep the original goal"), [])
    return session


def native_run(repo: SqlDifyBuilderRepository, *, app_id: str = APP_ID) -> str:
    run_id = str(uuid4())
    with repo._session_factory() as sql, sql.begin():
        sql.add(
            WorkflowRun(
                id=run_id,
                tenant_id=TENANT_ID,
                app_id=app_id,
                workflow_id=str(uuid4()),
                type=WorkflowType.WORKFLOW,
                triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
                version="draft",
                status=WorkflowExecutionStatus.FAILED,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=ACCOUNT_ID,
            )
        )
    return run_id


def queue(repo: SqlDifyBuilderRepository, session: Session, run_id: str, *, key: str = "fix-one") -> FixIntent:
    from services.dify_builder.fix_intent_repository import SqlFixIntentRepository

    return SqlFixIntentRepository(repo).prepare(
        ACTOR,
        session.id,
        client_action_id=key,
        expected_task_id=f"{session.id}:0",
        source={"kind": "run", "failed_run_id": run_id},
        model_config={},
    )


def test_prepare_keeps_worker_head_generation_and_writer(repo: SqlDifyBuilderRepository) -> None:
    session = seed(repo, PcState.BUILD_EXECUTION)
    run_id = native_run(repo)
    assert repo.reserve_workflow_writer(session.id, "old-worker", 0, 90)
    first = queue(repo, session, run_id)
    assert first.status == "awaiting_confirmation"
    assert queue(repo, session, run_id).id == first.id
    current, context = repo.get_session(session.id)
    assert current.version == 1
    assert not context.paused
    assert context.task_control == {}
    assert context.goal_text == "Keep the original goal"
    assert repo.is_task_active(session.id, 0, "old-worker")


def test_prepare_refuses_another_source_without_losing_pending_intent(repo: SqlDifyBuilderRepository) -> None:
    session = seed(repo)
    first = queue(repo, session, native_run(repo))
    with pytest.raises(ConflictError):
        queue(repo, session, native_run(repo), key="different-fix")
    from services.dify_builder.fix_intent_repository import SqlFixIntentRepository

    pending = SqlFixIntentRepository(repo).pending(ACTOR, session.id)
    assert pending is not None
    assert pending.id == first.id


def test_prepare_binds_key_and_validates_native_app_owner(repo: SqlDifyBuilderRepository) -> None:
    session = seed(repo)
    queue(repo, session, native_run(repo))
    with pytest.raises(ConflictError):
        queue(repo, session, native_run(repo))
    other = seed(repo)
    with pytest.raises(NotFoundError):
        queue(repo, other, native_run(repo, app_id=str(uuid4())))


def test_first_conversation_source_validation_uses_native_owner_without_session(repo: SqlDifyBuilderRepository) -> None:
    from services.dify_builder.fix_intent_repository import SqlFixIntentRepository

    adapter = SqlFixIntentRepository(repo)
    source = {"kind": "run", "failed_run_id": native_run(repo)}
    adapter.validate_source(ACTOR, APP_ID, source)
    with pytest.raises(NotFoundError):
        adapter.validate_source(ACTOR, str(uuid4()), source)
    with pytest.raises(NotFoundError):
        adapter.validate_source(replace(ACTOR, tenant_id=str(uuid4())), APP_ID, source)


def test_current_task_origin_is_related_but_old_task_history_is_not(repo: SqlDifyBuilderRepository) -> None:
    session = seed(repo)
    related = native_run(repo)
    old = native_run(repo)
    with repo._session_factory() as sql, sql.begin():
        for run_id, origin in [(related, f"{session.id}:0"), (old, f"{session.id}:previous")]:
            sql.add(
                DifyBuilderRun(
                    session_id=session.id,
                    kind="verify",
                    dify_run_id=run_id,
                    origin_task_id=origin,
                    status="failed",
                    immutable=True,
                )
            )
    assert queue(repo, session, related).status == "related"
    assert queue(repo, session, old, key="old-run-fix").status == "awaiting_confirmation"


def test_conversation_selection_prefers_owned_writer_and_excludes_cleared(repo: SqlDifyBuilderRepository) -> None:
    from services.dify_builder.fix_intent_repository import SqlFixIntentRepository

    older = seed(repo)
    latest = seed(repo)
    with repo._session_factory() as sql, sql.begin():
        sql.get(DifyBuilderSession, older.id).updated_at = datetime(2026, 10, 29)
        sql.get(DifyBuilderSession, latest.id).updated_at = datetime(2026, 10, 30)
    assert repo.reserve_workflow_writer(older.id, "writer", 0, 90)
    adapter = SqlFixIntentRepository(repo)
    assert adapter.select_conversation(ACTOR, APP_ID) == older.id
    repo.release_workflow_writer(older.id, token="writer")
    assert adapter.select_conversation(ACTOR, APP_ID) == latest.id
    _, context = repo.get_session(latest.id)
    context.task_control["conversation_clear"] = {"version": 2, "seq_floor": 0}
    repo.compare_and_advance(latest.id, 1, latest.current_state, context, [])
    assert adapter.select_conversation(ACTOR, APP_ID) == older.id
    with pytest.raises(NotFoundError):
        adapter.select_conversation(replace(ACTOR, account_id=str(uuid4())), APP_ID, older.id)
    with pytest.raises(ConflictError):
        adapter.select_conversation(ACTOR, APP_ID, latest.id)


def test_completed_activation_is_one_new_task_with_immutable_source_run(repo: SqlDifyBuilderRepository) -> None:
    from services.dify_builder.fix_intent_repository import SqlFixIntentRepository

    session = seed(repo, PcState.BUILD_COMPLETE)
    source_run = native_run(repo)
    intent = queue(repo, session, source_run)
    adapter = SqlFixIntentRepository(repo)
    activated = adapter.activate(ACTOR, session.id, intent.id, dsl={}, revision="current-draft")
    current, context = repo.get_session(session.id)
    assert activated.status == "activated"
    assert current.current_state == PcState.FIX_DIAGNOSE
    assert context.logical_task_id == f"{session.id}:1"
    assert context.task_control["generation"] == 1
    assert context.last_snapshot_hash == "current-draft"
    assert context.task_status == "active"
    assert repo.get_session_at_version(session.id, 1)[0].current_state == PcState.BUILD_COMPLETE
    failed = repo.get_run(context.failed_run_id)
    assert failed.immutable
    assert failed.status == "failed"
    assert failed.dify_run_id == source_run
    assert adapter.activate(ACTOR, session.id, intent.id, dsl={}, revision="changed").activated_version == 2
    assert repo.get_session(session.id)[0].version == 2
    assert len(repo.list_conversation(session.id)) == 1


@pytest.mark.parametrize("settlement", ["pending", "unknown"])
def test_unsettled_stop_never_activates(repo: SqlDifyBuilderRepository, settlement: str) -> None:
    from services.dify_builder.fix_intent_repository import SqlFixIntentRepository

    session = seed(repo)
    intent = queue(repo, session, native_run(repo))
    adapter = SqlFixIntentRepository(repo)
    adapter.decide(
        ACTOR,
        session.id,
        intent.id,
        expected_task_id=f"{session.id}:0",
        kind="stop_and_switch_fix",
        client_action_id="confirm",
    )
    _, context = repo.get_session(session.id)
    context.paused = True
    context.task_control["settlement"] = settlement
    repo.compare_and_advance(session.id, 1, session.current_state, context, [])
    assert adapter.activate(ACTOR, session.id, intent.id, dsl={}, revision="new").status == "stopping"
    current, context = repo.get_session(session.id)
    assert current.version == 2
    assert current.current_state == PcState.BUILD_PLAN_APPROVAL
    assert context.failed_run_id == ""
    assert context.paused


def test_dismiss_does_not_stop_or_replace_original_task(repo: SqlDifyBuilderRepository) -> None:
    from services.dify_builder.fix_intent_repository import SqlFixIntentRepository

    session = seed(repo)
    intent = queue(repo, session, native_run(repo))
    adapter = SqlFixIntentRepository(repo)
    dismissed = adapter.decide(
        ACTOR, session.id, intent.id, expected_task_id=f"{session.id}:0", kind="dismiss_fix", client_action_id="dismiss"
    )
    assert dismissed.status == "dismissed"
    assert adapter.pending(ACTOR, session.id) is None
    assert repo.get_session(session.id)[0].version == 1
    with pytest.raises(ConflictError):
        adapter.decide(
            ACTOR,
            session.id,
            intent.id,
            expected_task_id=f"{session.id}:0",
            kind="stop_and_switch_fix",
            client_action_id="dismiss",
        )


def test_enqueue_unknown_never_becomes_claimable_again(repo: SqlDifyBuilderRepository) -> None:
    from services.dify_builder.fix_intent_repository import SqlFixIntentRepository

    session = seed(repo, PcState.EDIT_COMPLETE)
    intent = queue(repo, session, native_run(repo))
    adapter = SqlFixIntentRepository(repo)
    adapter.activate(ACTOR, session.id, intent.id, dsl={}, revision="draft")
    assert adapter.reserve_dispatch(ACTOR, session.id, intent.id)
    adapter.finish_dispatch(ACTOR, session.id, intent.id, outcome="unknown")
    assert not adapter.reserve_dispatch(ACTOR, session.id, intent.id)
    assert adapter.get(ACTOR, session.id, intent.id).enqueue == "unknown"


def test_stale_offer_cannot_stop_replacement_task(repo: SqlDifyBuilderRepository) -> None:
    from services.dify_builder.fix_intent_repository import SqlFixIntentRepository
    from services.dify_builder.task_lifecycle import advance_task_identity

    session = seed(repo)
    intent = queue(repo, session, native_run(repo))
    _, context = repo.get_session(session.id)
    advance_task_identity(session, context, EntryMode.EDIT)
    repo.compare_and_advance(session.id, 1, PcState.EDIT_IMPACT_ANALYSIS, context, [])
    adapter = SqlFixIntentRepository(repo)
    with pytest.raises(ConflictError):
        adapter.decide(
            ACTOR,
            session.id,
            intent.id,
            expected_task_id=f"{session.id}:0",
            kind="stop_and_switch_fix",
            client_action_id="stale-confirm",
        )
    assert not repo.get_session(session.id)[1].paused


def test_activation_refuses_active_task_without_explicit_stop(repo: SqlDifyBuilderRepository) -> None:
    from services.dify_builder.fix_intent_repository import SqlFixIntentRepository

    session = seed(repo)
    intent = queue(repo, session, native_run(repo))
    with pytest.raises(ConflictError):
        SqlFixIntentRepository(repo).activate(ACTOR, session.id, intent.id, dsl={}, revision="draft")
    assert repo.get_session(session.id)[0].version == 1


def test_stopped_task_activation_discards_old_permissions_and_keeps_history(repo: SqlDifyBuilderRepository) -> None:
    from services.dify_builder.fix_intent_repository import SqlFixIntentRepository

    session = seed(repo)
    source_run = native_run(repo)
    intent = queue(repo, session, source_run)
    adapter = SqlFixIntentRepository(repo)
    adapter.decide(
        ACTOR,
        session.id,
        intent.id,
        expected_task_id=f"{session.id}:0",
        kind="stop_and_switch_fix",
        client_action_id="confirm",
    )
    _, context = repo.get_session(session.id)
    context.paused = True
    context.task_control = {"generation": 5, "settlement": "settled"}
    context.effect_confirmation = {"old-node": "old-consent"}
    context.confirmed_consent_id = "old-real-call"
    context.attachment_material = [{"text": "unconsumed old source"}]
    repo.compare_and_advance(session.id, 1, session.current_state, context, [])
    adapter.activate(ACTOR, session.id, intent.id, dsl={}, revision="draft")
    _, current = repo.get_session(session.id)
    assert current.logical_task_id == f"{session.id}:1"
    assert current.task_control["generation"] == 6
    assert current.effect_confirmation == {}
    assert current.confirmed_consent_id == ""
    assert current.attachment_material == []
    assert repo.get_session_at_version(session.id, 2)[1].confirmed_consent_id == "old-real-call"


def test_dispatch_reservation_cannot_adopt_a_resumed_generation(repo: SqlDifyBuilderRepository) -> None:
    from services.dify_builder.fix_intent_repository import SqlFixIntentRepository

    session = seed(repo, PcState.SUCCESS)
    intent = queue(repo, session, native_run(repo))
    adapter = SqlFixIntentRepository(repo)
    adapter.activate(ACTOR, session.id, intent.id, dsl={}, revision="draft")
    current, context = repo.get_session(session.id)
    context.task_control["generation"] = 2
    repo.compare_and_advance(session.id, current.version, current.current_state, context, [])
    with pytest.raises(ConflictError):
        adapter.reserve_dispatch(ACTOR, session.id, intent.id)


def test_legacy_run_fallback_requires_exact_current_reference(repo: SqlDifyBuilderRepository) -> None:
    from services.dify_builder.fix_intent_repository import SqlFixIntentRepository

    session = seed(repo)
    source_run = native_run(repo)
    with repo._session_factory() as sql, sql.begin():
        row = DifyBuilderRun(
            session_id=session.id, kind="verify", dify_run_id=source_run, status="failed", immutable=True
        )
        sql.add(row)
        sql.flush()
        builder_run_id = row.id
    _, context = repo.get_session(session.id)
    context.verify_run_id = builder_run_id
    repo.compare_and_advance(session.id, 1, session.current_state, context, [])
    assert queue(repo, session, source_run).status == "related"
    adapter = SqlFixIntentRepository(repo)
    assert adapter.pending(ACTOR, session.id) is None


def configure(service: DifyBuilderService, repo: SqlDifyBuilderRepository) -> None:
    from services.dify_builder.fix_intent_repository import SqlFixIntentRepository

    service._fix_intent_repo = SqlFixIntentRepository(repo)
    service._read_task_dsl_fn = lambda _app, _actor: ({}, "latest-draft")


def test_explicit_confirmation_switches_same_conversation_once(
    service: DifyBuilderService,
    repo: SqlDifyBuilderRepository,
    enqueued: list[Enqueued],
) -> None:
    from services.dify_builder.fix_intents import pending_fix_projection, prepare_fix_intent, submit_fix_intent

    configure(service, repo)
    session = seed(repo)
    receipt = prepare_fix_intent(service, session.id, ACTOR, failed_run_id=native_run(repo), client_action_id="offer")
    assert receipt.status == "awaiting_confirmation"
    assert enqueued == []
    assert repo.get_session(session.id)[0].version == 1
    current, context = repo.get_session(session.id)
    projection = pending_fix_projection(service, current, context, ACTOR)
    assert projection is not None
    actions, decision, run_context = projection
    assert decision.default_option_id == "dismiss_fix"
    assert isinstance(run_context, RunContextCard)
    assert run_context.run_id
    payload = actions[1].payload
    confirm = Action(kind="stop_and_switch_fix", command_id="confirm", payload=payload)
    view = submit_fix_intent(service, session.id, ACTOR, confirm)
    assert view.session_id == session.id
    assert len(enqueued) == 1
    assert enqueued[0][1].kind == "request_fix"
    assert repo.get_session(session.id)[1].logical_task_id == f"{session.id}:1"
    submit_fix_intent(service, session.id, ACTOR, confirm)
    assert len(enqueued) == 1


def test_completed_intake_starts_fix_without_stop(
    service: DifyBuilderService,
    repo: SqlDifyBuilderRepository,
    enqueued: list[Enqueued],
) -> None:
    from services.dify_builder.fix_intents import prepare_fix_intent

    configure(service, repo)
    session = seed(repo, PcState.BUILD_COMPLETE)
    receipt = prepare_fix_intent(service, session.id, ACTOR, failed_run_id=native_run(repo), client_action_id="new-fix")
    assert receipt.status == "activated"
    assert len(enqueued) == 1
    previous, context = repo.get_session_at_version(session.id, 1)
    assert previous.current_state == PcState.BUILD_COMPLETE
    assert not context.paused
    assert context.task_status != "abandoned"
    assert repo.get_session(session.id)[0].version == 2


def test_task_that_completed_after_offer_does_not_get_stopped(
    service: DifyBuilderService,
    repo: SqlDifyBuilderRepository,
    enqueued: list[Enqueued],
) -> None:
    from services.dify_builder.fix_intents import prepare_fix_intent, submit_fix_intent

    configure(service, repo)
    session = seed(repo)
    receipt = prepare_fix_intent(service, session.id, ACTOR, failed_run_id=native_run(repo), client_action_id="offer")
    _, context = repo.get_session(session.id)
    context.task_status = "completed"
    repo.compare_and_advance(session.id, 1, PcState.BUILD_COMPLETE, context, [])
    submit_fix_intent(
        service,
        session.id,
        ACTOR,
        Action(
            kind="stop_and_switch_fix",
            command_id="confirm",
            payload={"fix_intent_id": receipt.fix_intent_id, "expected_task_id": f"{session.id}:0"},
        ),
    )
    assert repo.get_session(session.id)[0].version == 3
    _, previous = repo.get_session_at_version(session.id, 2)
    assert previous.task_status == "completed"
    assert not previous.paused
    assert len(enqueued) == 1


def test_unknown_enqueue_confirmation_is_not_replayed_after_lease_loss(
    service: DifyBuilderService,
    repo: SqlDifyBuilderRepository,
) -> None:
    from services.dify_builder.errors import EnqueueAcknowledgementError
    from services.dify_builder.fix_intents import prepare_fix_intent, submit_fix_intent

    configure(service, repo)
    attempted: list[str] = []

    def lose_ack(session_id: str, _action: Action, _actor: Actor, _token: str) -> None:
        attempted.append(session_id)
        raise RuntimeError("ack unavailable")

    service._enqueue_fn = lose_ack
    session = seed(repo)
    receipt = prepare_fix_intent(service, session.id, ACTOR, failed_run_id=native_run(repo), client_action_id="offer")
    confirm = Action(
        kind="stop_and_switch_fix",
        command_id="confirm",
        payload={
            "fix_intent_id": receipt.fix_intent_id,
            "expected_task_id": f"{session.id}:0",
        },
    )
    with pytest.raises(EnqueueAcknowledgementError):
        submit_fix_intent(service, session.id, ACTOR, confirm)
    token = service._session_lock.current_owner(session.id)
    assert token is not None
    service._release_workflow_writer(session.id, token)
    submit_fix_intent(service, session.id, ACTOR, confirm)
    assert attempted == [session.id]


def test_prepare_api_replays_original_base_after_activation_but_rejects_changed_body(
    service: DifyBuilderService,
    repo: SqlDifyBuilderRepository,
    enqueued: list[Enqueued],
) -> None:
    configure(service, repo)
    session = seed(repo, PcState.BUILD_COMPLETE)
    source_run = native_run(repo)
    first = service.prepare_fix_intent(
        session.id,
        ACTOR,
        base_version=1,
        failed_run_id=source_run,
        client_action_id="request",
    )
    replay = service.prepare_fix_intent(
        session.id,
        ACTOR,
        base_version=1,
        failed_run_id=source_run,
        client_action_id="request",
    )
    assert replay.fix_intent_id == first.fix_intent_id
    assert len(enqueued) == 1
    with pytest.raises(ConflictError):
        service.prepare_fix_intent(
            session.id,
            ACTOR,
            base_version=1,
            failed_run_id=native_run(repo),
            client_action_id="request",
        )
    with pytest.raises(ConflictError):
        service.prepare_fix_intent(
            session.id,
            ACTOR,
            base_version=1,
            failed_run_id=source_run,
            client_action_id="stale-new-request",
        )


@pytest.mark.parametrize("state", [PcState.FAILED, PcState.BUILD_COMPLETE])
@pytest.mark.parametrize("settlement", ["pending", "unknown"])
def test_terminal_intake_never_bypasses_unsettled_effects(
    service: DifyBuilderService,
    repo: SqlDifyBuilderRepository,
    enqueued: list[Enqueued],
    state: PcState,
    settlement: str,
) -> None:
    from services.dify_builder.fix_intents import prepare_fix_intent

    configure(service, repo)
    session = seed(repo, state)
    _, context = repo.get_session(session.id)
    context.task_control["settlement"] = settlement
    repo.compare_and_advance(session.id, 1, state, context, [])
    receipt = prepare_fix_intent(
        service,
        session.id,
        ACTOR,
        failed_run_id=native_run(repo),
        client_action_id="fix-after-terminal",
    )
    assert receipt.status == "awaiting_confirmation"
    assert enqueued == []
    assert repo.get_session(session.id)[0].version == 2
    assert repo.get_session(session.id)[1].failed_run_id == ""


def test_new_task_intake_can_supersede_unconfirmed_offer_for_old_task(repo: SqlDifyBuilderRepository) -> None:
    from services.dify_builder.fix_intent_repository import SqlFixIntentRepository
    from services.dify_builder.task_lifecycle import advance_task_identity

    session = seed(repo)
    previous = queue(repo, session, native_run(repo))
    _, context = repo.get_session(session.id)
    advance_task_identity(session, context, EntryMode.EDIT)
    repo.compare_and_advance(session.id, 1, PcState.EDIT_IMPACT_ANALYSIS, context, [])
    adapter = SqlFixIntentRepository(repo)
    current = adapter.prepare(
        ACTOR,
        session.id,
        client_action_id="new-task-fix",
        expected_task_id=f"{session.id}:1",
        source={"kind": "run", "failed_run_id": native_run(repo)},
        model_config={},
    )
    assert current.status == "awaiting_confirmation"
    assert adapter.get(ACTOR, session.id, previous.id).status == "superseded"
    assert repo.get_session(session.id)[0].version == 2


def test_same_source_can_be_offered_again_after_another_logical_task(repo: SqlDifyBuilderRepository) -> None:
    from services.dify_builder.fix_intent_repository import SqlFixIntentRepository
    from services.dify_builder.task_lifecycle import advance_task_identity, task_identity

    session = seed(repo, PcState.BUILD_COMPLETE)
    repository = SqlFixIntentRepository(repo)
    source = {"kind": "run", "failed_run_id": native_run(repo)}
    first = repository.prepare(
        ACTOR, session.id, client_action_id="first", expected_task_id=f"{session.id}:0", source=source, model_config={}
    )
    first = repository.activate(ACTOR, session.id, first.id, dsl={}, revision="revision")
    assert repository.reserve_dispatch(ACTOR, session.id, first.id)
    repository.finish_dispatch(ACTOR, session.id, first.id, outcome="dispatched")
    head, context = repo.get_session(session.id)
    advance_task_identity(head, context, EntryMode.EDIT)
    repo.compare_and_advance(session.id, head.version, PcState.EDIT_PLAN_APPROVAL, context, [])
    second = repository.prepare(
        ACTOR,
        session.id,
        client_action_id="later-explicit-fix",
        expected_task_id=task_identity(head, context),
        source=source,
        model_config={},
    )
    assert second.id != first.id
    assert second.status == "awaiting_confirmation"
    assert second.target_task_id == task_identity(head, context)
    pending = repository.pending(ACTOR, session.id)
    assert pending is not None
    assert pending.id == second.id


def test_control_receipt_reads_exact_intake_and_decision_without_dispatch(
    service: DifyBuilderService, repo: SqlDifyBuilderRepository, enqueued: list[Enqueued]
) -> None:
    from services.dify_builder.fix_intent_repository import SqlFixIntentRepository

    configure(service, repo)
    session = seed(repo)
    intent = queue(repo, session, native_run(repo), key="lost-offer")
    before = repo.get_session(session.id)[0].version
    receipt = service.get_fix_control_receipt(
        session.id, ACTOR, operation="fix", client_action_id="lost-offer", base_version=1
    )
    assert receipt["acknowledged"] is True
    assert receipt["target_task_id"] == f"{session.id}:0"
    assert receipt["fix_intent_id"] == intent.id
    assert not ({"source", "payload", "model_config", "response"} & receipt.keys())
    adapter = SqlFixIntentRepository(repo)
    adapter.decide(
        ACTOR,
        session.id,
        intent.id,
        expected_task_id=f"{session.id}:0",
        kind="dismiss_fix",
        client_action_id="lost-dismiss",
    )
    decision: _FixControlQuery = {
        "operation": "dismiss_fix",
        "client_action_id": "lost-dismiss",
        "base_version": 1,
        "fix_intent_id": intent.id,
        "expected_task_id": f"{session.id}:0",
    }
    assert service.get_fix_control_receipt(session.id, ACTOR, **decision)["acknowledged"] is True
    forged_action = decision.copy()
    forged_action["client_action_id"] = "other"
    forged_task = decision.copy()
    forged_task["expected_task_id"] = "other-task"
    forged_operation = decision.copy()
    forged_operation["operation"] = "stop_and_switch_fix"
    for forged in (forged_action, forged_task, forged_operation):
        with pytest.raises((ConflictError, NotFoundError)):
            service.get_fix_control_receipt(session.id, ACTOR, **forged)
    with pytest.raises(NotFoundError):
        service.get_fix_control_receipt(session.id, replace(ACTOR, account_id=str(uuid4())), **decision)
    with pytest.raises(NotFoundError):
        service.get_fix_control_receipt(session.id, replace(ACTOR, tenant_id=str(uuid4())), **decision)
    with pytest.raises(NotFoundError):
        service.get_fix_control_receipt(session.id, ACTOR, operation="fix", client_action_id="missing", base_version=1)
    assert repo.get_session(session.id)[0].version == before
    assert enqueued == []


def test_switch_control_receipt_remains_unacknowledged_until_activation(
    service: DifyBuilderService, repo: SqlDifyBuilderRepository, enqueued: list[Enqueued]
) -> None:
    from services.dify_builder.fix_intent_repository import SqlFixIntentRepository

    configure(service, repo)
    session = seed(repo)
    intent = queue(repo, session, native_run(repo))
    adapter = SqlFixIntentRepository(repo)
    adapter.decide(
        ACTOR,
        session.id,
        intent.id,
        expected_task_id=f"{session.id}:0",
        kind="stop_and_switch_fix",
        client_action_id="lost-switch",
    )
    query: _FixControlQuery = {
        "operation": "stop_and_switch_fix",
        "client_action_id": "lost-switch",
        "base_version": 1,
        "fix_intent_id": intent.id,
        "expected_task_id": f"{session.id}:0",
    }
    assert service.get_fix_control_receipt(session.id, ACTOR, **query)["acknowledged"] is False
    repo.stop_task_for_switch(session.id, ACTOR, expected_task_id=f"{session.id}:0", client_action_id="settled-stop")
    adapter.activate(ACTOR, session.id, intent.id, dsl={}, revision="draft")
    assert service.get_fix_control_receipt(session.id, ACTOR, **query)["acknowledged"] is True
    assert enqueued == []


def test_clear_fences_source_dedup_alias_and_late_intake_activation(
    service: DifyBuilderService, repo: SqlDifyBuilderRepository, enqueued: list[Enqueued]
) -> None:
    from services.dify_builder.fix_intent_repository import SqlFixIntentRepository

    configure(service, repo)
    session = seed(repo)
    source = native_run(repo)
    intent = queue(repo, session, source, key="known-offer")
    assert queue(repo, session, source, key="lost-alias").id == intent.id
    with pytest.raises(NotFoundError):
        service.get_fix_control_receipt(
            session.id, ACTOR, operation="fix", client_action_id="lost-alias", base_version=1
        )
    for foreign in (replace(ACTOR, account_id=str(uuid4())), replace(ACTOR, tenant_id=str(uuid4()))):
        with pytest.raises(NotFoundError):
            repo.conversation_lifecycle(
                session.id,
                foreign,
                operation="clear",
                base_version=1,
                client_action_id="escape-clear",
                expected_task_id=f"{session.id}:0",
            )
    repo.conversation_lifecycle(
        session.id,
        ACTOR,
        operation="clear",
        base_version=1,
        client_action_id="escape-clear",
        expected_task_id=f"{session.id}:0",
    )
    adapter = SqlFixIntentRepository(repo)
    with pytest.raises(ConflictError):
        queue(repo, session, source, key="lost-alias")
    with pytest.raises(ConflictError):
        service.prepare_fix_intent(
            session.id, ACTOR, base_version=1, client_action_id="lost-alias", failed_run_id=source
        )
    with pytest.raises(ConflictError):
        adapter.activate(ACTOR, session.id, intent.id, dsl={}, revision="draft")
    with pytest.raises(ConflictError):
        adapter.reserve_dispatch(ACTOR, session.id, intent.id)
    assert repo.get_session(session.id)[0].version == 2
    assert enqueued == []
