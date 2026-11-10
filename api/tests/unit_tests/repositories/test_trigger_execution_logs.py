"""Producer log transactions are scoped and preserve all-or-nothing failure records."""

from uuid import uuid4

import pytest
from sqlalchemy import Table, select
from sqlalchemy.exc import OperationalError

from models.enums import CreatorUserRole, WorkflowTriggerStatus
from models.trigger import WorkflowTriggerLog
from models.workflow import WorkflowAppLog, WorkflowRun
from repositories.app_definition_query_repository import AppDefinitionQueryRepository
from repositories.sqlalchemy_workflow_trigger_log_repository import SQLAlchemyWorkflowTriggerDispatchRepository
from services.workflow.entities import ScheduleTriggerData, TriggerActor
from tests.unit_tests.controllers.console.workspace.test_trigger_oauth_client import _Harness
from tests.unit_tests.tasks import test_trigger_processing_tasks as worker_tests
from tests.unit_tests.tasks.test_trigger_processing_tasks import _Dispatch

application_redis = worker_tests.application_redis
harness = worker_tests.harness
dispatch = worker_tests.dispatch


@pytest.mark.parametrize("scope", ["tenant", "app"])
def test_status_write_does_not_update_log_outside_owner_scope(
    harness: _Harness,
    dispatch: _Dispatch,
    scope: str,
) -> None:
    store = SQLAlchemyWorkflowTriggerDispatchRepository(session_factory=harness.session_factory)
    data = ScheduleTriggerData(tenant_id=harness.tenant_id, app_id=dispatch.app_id, root_node_id="node", inputs={})
    workflow = AppDefinitionQueryRepository(session_factory=harness.session_factory).get_trigger_workflow(
        tenant_id=harness.tenant_id, app_id=dispatch.app_id, workflow_id=None
    )
    log_id = store.create_pending(
        actor=TriggerActor(id=harness.account_id, role=CreatorUserRole.ACCOUNT),
        trigger_data=data,
        workflow_id=workflow.id,
        queue="workflow_sandbox",
    )
    tenant_id = str(uuid4()) if scope == "tenant" else harness.tenant_id
    app_id = str(uuid4()) if scope == "app" else dispatch.app_id
    store.mark_failed(
        tenant_id=tenant_id, app_id=app_id, log_id=log_id, status=WorkflowTriggerStatus.FAILED, error="foreign"
    )
    store.mark_queued(tenant_id=tenant_id, app_id=app_id, log_id=log_id, task_id="foreign")
    with harness.session_factory() as session:
        log = session.get(WorkflowTriggerLog, log_id)
        assert log is not None
        assert log.status == WorkflowTriggerStatus.PENDING
        assert log.error is None
        assert log.celery_task_id is None


def test_three_failure_records_rollback_together_when_app_log_write_fails(
    harness: _Harness,
    dispatch: _Dispatch,
) -> None:
    store = SQLAlchemyWorkflowTriggerDispatchRepository(session_factory=harness.session_factory)
    workflow = AppDefinitionQueryRepository(session_factory=harness.session_factory).get_trigger_workflow(
        tenant_id=harness.tenant_id, app_id=dispatch.app_id, workflow_id=None
    )
    data = ScheduleTriggerData(tenant_id=harness.tenant_id, app_id=dispatch.app_id, root_node_id="node", inputs={})
    with harness.session_factory() as session:
        engine = session.get_bind()
    app_logs = WorkflowAppLog.__table__
    assert isinstance(app_logs, Table)
    app_logs.drop(engine)
    try:
        with pytest.raises(OperationalError, match="workflow_app_logs"):
            store.record_invocation_failure(
                workflow=workflow,
                actor=TriggerActor(id=harness.account_id, role=CreatorUserRole.ACCOUNT),
                trigger_data=data,
                failure_inputs={"event_name": "push"},
                error="provider rejected",
                queue="workflow",
            )
        with harness.session_factory() as session:
            assert session.scalar(select(WorkflowRun)) is None
            assert session.scalar(select(WorkflowTriggerLog)) is None
    finally:
        app_logs.create(engine)
