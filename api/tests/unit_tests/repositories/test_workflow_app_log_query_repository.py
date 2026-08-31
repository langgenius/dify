import json
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.orm import Session, sessionmaker

from graphon.enums import WorkflowExecutionStatus
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.enums import (
    AppTriggerType,
    CreatorUserRole,
    EndUserType,
    WorkflowRunTriggeredFrom,
    WorkflowTriggerStatus,
)
from models.model import EndUser
from models.trigger import WorkflowTriggerLog
from models.workflow import WorkflowAppLog, WorkflowAppLogCreatedFrom, WorkflowRun, WorkflowType
from repositories.workflow_app_log_query_repository import WorkflowAppLogQueryRepository
from services.workflow_app_log_query_service import WorkflowAppLogAccount, WorkflowAppLogEndUser


def _log(
    log_id: str,
    *,
    created_by: str,
    created_by_role: CreatorUserRole,
    created_at: datetime,
) -> WorkflowAppLog:
    log = WorkflowAppLog(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        workflow_run_id=f"run-{log_id}",
        created_from=WorkflowAppLogCreatedFrom.SERVICE_API,
        created_by_role=created_by_role,
        created_by=created_by,
    )
    log.id = log_id
    log.created_at = created_at
    return log


def _run(
    run_id: str,
    *,
    tenant_id: str = "tenant-1",
    app_id: str = "app-1",
    triggered_from: WorkflowRunTriggeredFrom = WorkflowRunTriggeredFrom.APP_RUN,
) -> WorkflowRun:
    created_at = datetime(2026, 1, 1, tzinfo=UTC)
    return WorkflowRun(
        id=run_id,
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id="workflow-1",
        type=WorkflowType.WORKFLOW,
        triggered_from=triggered_from,
        version="2026-01-01",
        graph=json.dumps({"nodes": [], "edges": []}),
        inputs=json.dumps({"input": "value"}),
        status=WorkflowExecutionStatus.SUCCEEDED,
        outputs=json.dumps({"output": "value"}),
        error=None,
        elapsed_time=0.5,
        total_tokens=10,
        total_steps=2,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="actor-1",
        created_at=created_at,
        finished_at=created_at + timedelta(seconds=1),
        exceptions_count=0,
    )


def test_get_paginated_returns_detached_actor_records_by_role_when_ids_overlap(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    created_at = datetime(2026, 1, 1)
    tenant = Tenant(name="Workspace")
    tenant.id = "tenant-1"
    account = Account(name="Account", email="account@example.com")
    account.id = "actor-1"
    end_user = EndUser(
        id="actor-1",
        tenant_id=tenant.id,
        app_id="app-1",
        type=EndUserType.BROWSER,
        session_id="session-1",
    )
    sqlite_session.add_all(
        [
            tenant,
            account,
            end_user,
            TenantAccountJoin(
                tenant_id=tenant.id,
                account_id=account.id,
                role=TenantAccountRole.OWNER,
            ),
            _log(
                "account-log",
                created_by=account.id,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_at=created_at,
            ),
            _log(
                "end-user-log",
                created_by=end_user.id,
                created_by_role=CreatorUserRole.END_USER,
                created_at=created_at + timedelta(seconds=1),
            ),
        ]
    )
    sqlite_session.commit()
    sqlite_session.close()

    result = WorkflowAppLogQueryRepository(session_factory=sqlite_session_factory).get_paginated(
        tenant_id=tenant.id,
        app_id="app-1",
    )

    assert result.total == 2
    assert [record.id for record in result.data] == ["end-user-log", "account-log"]
    by_id = {record.id: record for record in result.data}
    assert by_id["account-log"].created_by_account == WorkflowAppLogAccount(
        id=account.id,
        name=account.name,
        email=account.email,
    )
    assert by_id["account-log"].created_by_end_user is None
    assert by_id["end-user-log"].created_by_account is None
    assert by_id["end-user-log"].created_by_end_user == WorkflowAppLogEndUser(
        id=end_user.id,
        type=end_user.type.value,
        is_anonymous=False,
        session_id=end_user.session_id,
    )


def test_get_paginated_preserves_missing_account_filter_error(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = WorkflowAppLogQueryRepository(session_factory=sqlite_session_factory)

    with pytest.raises(ValueError, match=r"^Account not found: missing@example\.com$"):
        repository.get_paginated(
            tenant_id="tenant-1",
            app_id="app-1",
            created_by_account="missing@example.com",
        )


def test_get_paginated_projects_plugin_workflow_run_summary(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    log = _log(
        "plugin-log",
        created_by="actor-1",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    run = _run(log.workflow_run_id, triggered_from=WorkflowRunTriggeredFrom.PLUGIN)
    sqlite_session.add_all([run, log])
    sqlite_session.commit()

    result = WorkflowAppLogQueryRepository(session_factory=sqlite_session_factory).get_paginated(
        tenant_id="tenant-1",
        app_id="app-1",
    )

    assert result.total == 1
    summary = result.data[0].workflow_run
    assert summary is not None
    assert summary.id == run.id
    assert summary.status == WorkflowExecutionStatus.SUCCEEDED.value
    assert summary.triggered_from == WorkflowRunTriggeredFrom.PLUGIN.value
    assert summary.version == run.version
    assert summary.total_tokens == run.total_tokens


def test_get_paginated_keeps_log_when_workflow_run_is_missing(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    log = _log(
        "orphan-log",
        created_by="actor-1",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    sqlite_session.add(log)
    sqlite_session.commit()

    repository = WorkflowAppLogQueryRepository(session_factory=sqlite_session_factory)
    result = repository.get_paginated(tenant_id="tenant-1", app_id="app-1")

    assert result.total == 1
    assert result.data[0].workflow_run is None
    assert (
        repository.get_paginated(
            tenant_id="tenant-1",
            app_id="app-1",
            status=WorkflowExecutionStatus.SUCCEEDED,
        ).total
        == 0
    )


def test_get_paginated_includes_trigger_metadata_only_with_detail(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    log = _log(
        "trigger-log",
        created_by="actor-1",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    trigger_metadata = json.dumps({"type": AppTriggerType.TRIGGER_SCHEDULE.value})
    sqlite_session.add_all(
        [
            _run(log.workflow_run_id),
            log,
            WorkflowTriggerLog(
                tenant_id="tenant-1",
                app_id="app-1",
                workflow_id="workflow-1",
                workflow_run_id=log.workflow_run_id,
                root_node_id=None,
                trigger_metadata=trigger_metadata,
                trigger_type=AppTriggerType.TRIGGER_SCHEDULE,
                trigger_data="{}",
                inputs="{}",
                outputs=None,
                status=WorkflowTriggerStatus.SUCCEEDED,
                error=None,
                queue_name="default",
                celery_task_id=None,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by="actor-1",
                retry_count=0,
            ),
        ]
    )
    sqlite_session.commit()

    repository = WorkflowAppLogQueryRepository(session_factory=sqlite_session_factory)

    assert repository.get_paginated(tenant_id="tenant-1", app_id="app-1").data[0].details is None
    assert repository.get_paginated(
        tenant_id="tenant-1",
        app_id="app-1",
        detail=True,
    ).data[0].details == {"trigger_metadata": trigger_metadata}


@pytest.mark.parametrize(
    ("run_tenant_id", "run_app_id"),
    [
        ("tenant-2", "app-1"),
        ("tenant-1", "app-2"),
    ],
)
def test_get_paginated_does_not_attach_workflow_run_from_another_scope(
    run_tenant_id: str,
    run_app_id: str,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    log = _log(
        "mismatched-log",
        created_by="actor-1",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    sqlite_session.add_all(
        [
            _run(log.workflow_run_id, tenant_id=run_tenant_id, app_id=run_app_id),
            log,
        ]
    )
    sqlite_session.commit()

    repository = WorkflowAppLogQueryRepository(session_factory=sqlite_session_factory)
    result = repository.get_paginated(tenant_id="tenant-1", app_id="app-1")

    assert result.total == 1
    assert result.data[0].workflow_run is None
    assert (
        repository.get_paginated(
            tenant_id="tenant-1",
            app_id="app-1",
            status=WorkflowExecutionStatus.SUCCEEDED,
        ).total
        == 0
    )
