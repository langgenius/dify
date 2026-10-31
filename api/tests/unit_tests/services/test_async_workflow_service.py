"""Real producer persistence, Billing HTTP and Celery transport contracts."""

from contextvars import Context
from uuid import uuid4

import pytest
from celery import Celery
from kombu.exceptions import SerializerNotInstalled
from kombu.simple import SimpleQueue
from sqlalchemy import select

from enums import DeploymentEdition
from extensions.ext_application_services import application_services
from models.enums import CreatorUserRole, WorkflowTriggerStatus
from models.model import App
from models.trigger import WorkflowTriggerLog
from models.workflow import Workflow
from services.errors.app import IsDraftWorkflowError, QuotaExceededError, WorkflowNotFoundError
from services.workflow.entities import AsyncTriggerResponse, ScheduleTriggerData, TriggerActor
from tasks.async_workflow_tasks import execute_workflow_professional, execute_workflow_sandbox, execute_workflow_team
from tasks.workflow_cfs_scheduler.entities import AsyncWorkflowQueue
from tests.unit_tests.config_override import config_overrides_context
from tests.unit_tests.controllers.console.workspace.test_trigger_oauth_client import _Harness
from tests.unit_tests.tasks import test_trigger_processing_tasks as worker_tests
from tests.unit_tests.tasks.test_trigger_processing_tasks import _Billing, _Dispatch

application_redis = worker_tests.application_redis
harness = worker_tests.harness
billing = worker_tests.billing
dispatch = worker_tests.dispatch


def _run(
    harness: _Harness,
    dispatch: _Dispatch,
    *,
    app_id: str | None = None,
    tenant_id: str | None = None,
    workflow_id: str | None = None,
    actor: TriggerActor | None = None,
) -> AsyncTriggerResponse:
    def invoke() -> AsyncTriggerResponse:
        with harness.app.app_context(), config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD):
            return application_services().workspaces.workflow_dispatch.trigger_workflow_async(
                actor=actor or TriggerActor(id=harness.account_id, role=CreatorUserRole.ACCOUNT),
                trigger_data=ScheduleTriggerData(
                    tenant_id=tenant_id or harness.tenant_id,
                    app_id=app_id or dispatch.app_id,
                    workflow_id=workflow_id,
                    root_node_id="push-node",
                    inputs={"text": "hello"},
                ),
            )

    return Context().run(invoke)


@pytest.mark.parametrize("role", [CreatorUserRole.ACCOUNT, CreatorUserRole.END_USER])
@pytest.mark.parametrize("plan", ["sandbox", "professional", "team", "unknown-plan"])
def test_records_actor_and_publishes_lightweight_task(
    harness: _Harness,
    dispatch: _Dispatch,
    billing: _Billing,
    role: CreatorUserRole,
    plan: str,
) -> None:
    billing.plan = plan
    expected_task = {"professional": execute_workflow_professional, "team": execute_workflow_team}.get(
        plan, execute_workflow_sandbox
    )
    previous = execute_workflow_sandbox.app
    celery = Celery("workflow-producer-test", broker="memory://", set_as_current=False)
    celery.conf.update(task_always_eager=False, task_serializer="json")
    celery.set_current()
    actor = TriggerActor(id=str(uuid4()), role=role)
    try:
        with (
            celery.connection_for_write() as connection,
            SimpleQueue(connection.channel(), AsyncWorkflowQueue.SANDBOX_QUEUE) as queue,
        ):
            queue.clear()
            try:
                result = _run(harness, dispatch, actor=actor)
                message = queue.get(block=False)
                with harness.session_factory() as session:
                    log = session.get(WorkflowTriggerLog, result.workflow_trigger_log_id)
                    assert log is not None
                    assert log.created_by == actor.id
                    assert log.created_by_role == role
                    assert log.status == WorkflowTriggerStatus.QUEUED
                    assert log.celery_task_id == result.task_id
                    assert log.triggered_at is not None
                    assert message.payload[0] == [{"workflow_trigger_log_id": log.id}]
                    assert message.headers["id"] == log.celery_task_id
                    assert message.headers["task"] == expected_task.name
                    assert result.queue == f"workflow_{plan if plan != 'unknown-plan' else 'sandbox'}"
                message.ack()
                assert queue.qsize() == 0
            finally:
                queue.clear()
    finally:
        previous.set_current()
        celery.close()
    assert [(path, payload["feature_key"]) for path, payload in billing.requests] == [
        ("/quota/reserve", "api_rate_limit"),
        ("/quota/commit", "api_rate_limit"),
    ]
    assert all(not session.in_transaction() for session in harness.metadata.sessions)
    assert billing.open_transactions
    assert not any(billing.open_transactions)


def test_quota_failure_persists_rate_limited_log_without_dispatch(
    harness: _Harness,
    dispatch: _Dispatch,
    billing: _Billing,
) -> None:
    billing.exhausted = True
    with pytest.raises(QuotaExceededError):
        _run(harness, dispatch)
    with harness.session_factory() as session:
        log = session.scalar(select(WorkflowTriggerLog))
        assert log is not None
        assert log.status == WorkflowTriggerStatus.RATE_LIMITED
        assert log.error is not None
        assert log.error.startswith("Quota limit reached:")
        assert log.celery_task_id is None
    assert [path for path, _ in billing.requests] == ["/quota/reserve"]


def test_serialization_failure_records_failed_log_and_refunds_quota(
    harness: _Harness,
    dispatch: _Dispatch,
    billing: _Billing,
) -> None:
    previous = execute_workflow_sandbox.app
    celery = Celery("workflow-producer-failure", broker="memory://", set_as_current=False)
    celery.conf.update(task_always_eager=False, task_serializer="unregistered-trigger-test-serializer")
    celery.set_current()
    try:
        with pytest.raises(SerializerNotInstalled):
            _run(harness, dispatch)
    finally:
        previous.set_current()
        celery.close()
    with harness.session_factory() as session:
        log = session.scalar(select(WorkflowTriggerLog))
        assert log is not None
        assert log.status == WorkflowTriggerStatus.FAILED
        assert log.error is not None
        assert log.error.startswith("Failed to dispatch workflow task:")
        assert log.celery_task_id is None
    assert [path for path, _ in billing.requests] == ["/quota/reserve", "/quota/release"]
    assert all(not session.in_transaction() for session in harness.metadata.sessions)
    assert billing.open_transactions
    assert not any(billing.open_transactions)


@pytest.mark.parametrize("missing", ["app", "tenant", "workflow", "selected-workflow", "default-workflow"])
def test_missing_or_foreign_ownership_is_rejected_before_billing(
    harness: _Harness,
    dispatch: _Dispatch,
    billing: _Billing,
    missing: str,
) -> None:
    app_id, tenant_id, workflow_id = dispatch.app_id, harness.tenant_id, None
    if missing == "app":
        app_id = str(uuid4())
    elif missing == "tenant":
        tenant_id = str(uuid4())
    elif missing == "workflow":
        workflow_id = str(uuid4())
    else:
        with harness.session_factory.begin() as session:
            app = session.get(App, dispatch.app_id)
            assert app is not None
            if missing == "default-workflow":
                app.workflow_id = None
            else:
                workflow_id = app.workflow_id
                workflow = session.get(Workflow, workflow_id)
                assert workflow is not None
                workflow.app_id = str(uuid4())
    with pytest.raises(WorkflowNotFoundError):
        _run(harness, dispatch, app_id=app_id, tenant_id=tenant_id, workflow_id=workflow_id)
    assert billing.requests == []
    with harness.session_factory() as session:
        assert session.scalar(select(WorkflowTriggerLog)) is None


def test_explicit_draft_workflow_preserves_domain_error(
    harness: _Harness,
    dispatch: _Dispatch,
    billing: _Billing,
) -> None:
    with harness.session_factory.begin() as session:
        workflow = session.scalar(select(Workflow).where(Workflow.app_id == dispatch.app_id))
        assert workflow is not None
        workflow.version = Workflow.VERSION_DRAFT
        workflow_id = workflow.id
    with pytest.raises(IsDraftWorkflowError, match="Cannot use draft workflow version"):
        _run(harness, dispatch, workflow_id=workflow_id)
    assert billing.requests == []
