"""Real PostgreSQL/Redis races for independent Fix intake and task fencing."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest

from core.dify_builder.contract import SessionView
from core.dify_builder.errors import ConflictError
from core.dify_builder.models import Action, Actor
from core.dify_builder.state import PcState
from graphon.enums import WorkflowExecutionStatus
from models.base import Base
from models.dify_builder import DifyBuilderFixIntent
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.workflow import WorkflowRun, WorkflowType
from services.dify_builder.fix_intent_repository import SqlFixIntentRepository
from services.dify_builder.fix_intents import FixIntentReceipt, prepare_fix_intent, submit_fix_intent
from services.dify_builder.service import DifyBuilderService
from services.dify_builder.task_controls import ExecutionFence, execution_scope, require_active
from tests.e2e_tests.containers.services.test_builder_workflow_writer_admission import Harness

pytest_plugins = ["tests.e2e_tests.containers.services.test_builder_workflow_writer_admission"]


def setup(harness: Harness) -> tuple[DifyBuilderService, Actor, str, str]:
    tenant = harness.create_tenant()
    actor = harness.create_actor(tenant)
    app = harness.create_app(actor)
    with harness.factory() as sql:
        Base.metadata.create_all(
            sql.get_bind(),
            tables=[
                Base.metadata.tables[DifyBuilderFixIntent.__tablename__],
                Base.metadata.tables[WorkflowRun.__tablename__],
            ],
        )
    service = harness.service
    service._fix_intent_repo = SqlFixIntentRepository(harness.repo)
    service._read_task_dsl_fn = lambda _app, _actor: ({}, "synthetic-draft-revision")
    session_id, action = service._prepare_build_session(app, actor, "Original goal")
    assert action is not None
    service.dispatch(session_id, action, actor)
    native_id = str(uuid4())
    with harness.factory() as sql, sql.begin():
        sql.add(
            WorkflowRun(
                id=native_id,
                tenant_id=tenant,
                app_id=app,
                workflow_id=str(uuid4()),
                type=WorkflowType.WORKFLOW,
                triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
                version="draft",
                status=WorkflowExecutionStatus.FAILED,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=actor.account_id,
            )
        )
    return service, actor, session_id, native_id


def test_preparing_fix_does_not_break_worker_cas_but_confirmation_fences_late_write(harness: Harness) -> None:
    service, actor, sid, native_id = setup(harness)
    token = harness.queued[0][3]
    before, _ = harness.repo.get_session(sid)
    receipt = prepare_fix_intent(service, sid, actor, failed_run_id=native_id, client_action_id="offer")
    assert harness.repo.get_session(sid)[0].version == before.version
    fence = ExecutionFence(sid, 0, lambda: require_active(harness.repo, sid, 0), {}, writer_token=token)
    with execution_scope(fence):
        current, context = harness.repo.get_session(sid)
        harness.repo.compare_and_advance(sid, current.version, PcState.BUILD_PLAN_APPROVAL, context, [])
    submit_fix_intent(
        service,
        sid,
        actor,
        Action(
            kind="stop_and_switch_fix",
            command_id="confirm",
            payload={"fix_intent_id": receipt.fix_intent_id, "expected_task_id": sid + ":0"},
        ),
    )
    current, context = harness.repo.get_session(sid)
    with execution_scope(fence), pytest.raises(ConflictError):
        harness.repo.compare_and_advance(sid, current.version, current.current_state, context, [])
    assert len(harness.queued) == 2


def test_simultaneous_prepare_keeps_one_intent_and_original_session_head(harness: Harness) -> None:
    service, actor, sid, native_id = setup(harness)
    barrier = Barrier(2, timeout=15)

    def prepare(_index: int) -> FixIntentReceipt:
        barrier.wait()
        return prepare_fix_intent(service, sid, actor, failed_run_id=native_id, client_action_id="same-offer")

    with ThreadPoolExecutor(max_workers=2) as pool:
        receipts = list(pool.map(prepare, [0, 1]))
    assert receipts[0].fix_intent_id == receipts[1].fix_intent_id
    assert harness.repo.get_session(sid)[0].version == 1
    assert len(harness.queued) == 1


def test_simultaneous_confirmation_creates_and_dispatches_one_fix_task(harness: Harness) -> None:
    service, actor, sid, native_id = setup(harness)
    receipt = prepare_fix_intent(service, sid, actor, failed_run_id=native_id, client_action_id="offer")
    barrier = Barrier(2, timeout=15)

    def confirm(_index: int) -> SessionView:
        barrier.wait()
        return submit_fix_intent(
            service,
            sid,
            actor,
            Action(
                kind="stop_and_switch_fix",
                command_id="same-confirm",
                payload={"fix_intent_id": receipt.fix_intent_id, "expected_task_id": sid + ":0"},
            ),
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        views = list(pool.map(confirm, [0, 1]))
    assert all(view.session_id == sid for view in views)
    assert len(harness.queued) == 2
    assert harness.repo.get_session(sid)[1].logical_task_id == sid + ":1"
    assert len(harness.repo.list_conversation(sid)) == 2  # original user plus one Run Context
