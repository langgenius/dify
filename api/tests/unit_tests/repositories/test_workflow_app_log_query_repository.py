import csv
import json
from datetime import UTC, datetime, timedelta
from io import StringIO

import pytest
from psycopg2 import OperationalError as PostgresOperationalError
from psycopg2 import errors as postgres_errors
from sqlalchemy import Connection, Engine, event
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool

from graphon.enums import WorkflowExecutionStatus
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.enums import (
    AppTriggerType,
    CreatorUserRole,
    EndUserType,
    WorkflowRunTriggeredFrom,
    WorkflowTriggerStatus,
)
from models.evaluation import EvaluationRun, EvaluationRunItem, EvaluationRunStatus, EvaluationTargetType
from models.model import EndUser
from models.trigger import WorkflowTriggerLog
from models.workflow import WorkflowAppLog, WorkflowAppLogCreatedFrom, WorkflowRun, WorkflowType
from repositories import log_export_queries, workflow_app_log_query_repository
from repositories.workflow_app_log_query_repository import WorkflowAppLogQueryRepository
from services.retention.workflow_run.log_export_csv import WorkflowLogCsvWriter
from services.retention.workflow_run.log_export_service import WorkflowLogExportFilters, WorkflowLogExportScope
from services.workflow_app_log_query_service import (
    WorkflowAppLogAccount,
    WorkflowAppLogEndUser,
    WorkflowAppLogQueryService,
)


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
    run = WorkflowRun(
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
        finished_at=created_at + timedelta(seconds=1),
        exceptions_count=0,
    )
    run.created_at = created_at
    return run


def test_export_counts_and_reads_live_runs_once_across_batches(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Cross empty pages and use the earliest matching log for each live run."""
    monkeypatch.setattr(workflow_app_log_query_repository, "_LOG_EXPORT_BATCH_SIZE", 1)
    timestamp = datetime(2026, 1, 1)
    user_log = _log("user", created_by="user-id", created_by_role=CreatorUserRole.END_USER, created_at=timestamp)
    user_log.created_from = WorkflowAppLogCreatedFrom.WEB_APP
    duplicate_log = _log(
        "duplicate", created_by="user-id", created_by_role=CreatorUserRole.END_USER, created_at=timestamp
    )
    duplicate_log.workflow_run_id = user_log.workflow_run_id
    old_log = _log(
        "old", created_by="user-id", created_by_role=CreatorUserRole.END_USER, created_at=timestamp - timedelta(days=1)
    )
    old_log.workflow_run_id = user_log.workflow_run_id
    wrong_actor_log = _log(
        "a-other", created_by="other-user", created_by_role=CreatorUserRole.END_USER, created_at=timestamp
    )
    wrong_actor_log.workflow_run_id = user_log.workflow_run_id
    wrong_actor_log.created_from = WorkflowAppLogCreatedFrom.INSTALLED_APP
    orphan_log = _log("a-orphan", created_by="user-id", created_by_role=CreatorUserRole.END_USER, created_at=timestamp)
    account_log = _log(
        "account",
        created_by="account-id",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_at=timestamp + timedelta(days=1),
    )
    foreign_log = _log("foreign", created_by="user-id", created_by_role=CreatorUserRole.END_USER, created_at=timestamp)
    foreign_run = _run(foreign_log.workflow_run_id, tenant_id="other-workspace")
    account_run = _run(account_log.workflow_run_id, triggered_from=WorkflowRunTriggeredFrom.SCHEDULE)
    account_run.status = WorkflowExecutionStatus.FAILED
    account_run.outputs = json.dumps({"output": "account-search-token"})

    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                user_log,
                duplicate_log,
                old_log,
                wrong_actor_log,
                orphan_log,
                account_log,
                foreign_log,
                foreign_run,
                _run(user_log.workflow_run_id),
                account_run,
                _run("unlogged-debug-run"),
            ]
        )
    scope = WorkflowLogExportScope(tenant_id="tenant-1", app_id="app-1")
    repository = WorkflowAppLogQueryRepository(session_factory=sqlite_session_factory)
    filters = WorkflowLogExportFilters(
        created_at_after=timestamp, end_user_ids=("user-id",), account_ids=("account-id",)
    )
    assert repository.count_log_export_rows(scope=scope, filters=filters) == 2
    assert isinstance(sqlite_engine.pool, QueuePool)
    rows = []
    for row in repository.iter_log_export_rows(scope=scope, filters=filters):
        assert sqlite_engine.pool.checkedout() == 0
        rows.append(row)
    assert [(row.run_id, row.created_at, row.status, row.trigger_by) for row in rows] == [
        (user_log.workflow_run_id, timestamp, "succeeded", "service-api"),
        (account_log.workflow_run_id, account_log.created_at, "failed", "schedule"),
    ]
    assert rows[1].account_id == "account-id"
    assert json.loads(rows[0].inputs or "{}") == {"input": "value"}

    failed = WorkflowLogExportFilters(status=WorkflowExecutionStatus.FAILED)
    assert [row.run_id for row in repository.iter_log_export_rows(scope=scope, filters=failed)] == [
        account_log.workflow_run_id
    ]
    keyword = WorkflowLogExportFilters(keyword="account-search-token")
    assert [row.run_id for row in repository.iter_log_export_rows(scope=scope, filters=keyword)] == [
        account_log.workflow_run_id
    ]
    after = WorkflowLogExportFilters(created_at_after=timestamp + timedelta(days=1))
    rows_after = list(repository.iter_log_export_rows(scope=scope, filters=after))
    assert [(row.run_id, row.created_at) for row in rows_after] == [
        (account_log.workflow_run_id, account_log.created_at)
    ]
    assert (
        repository.count_log_export_rows(
            scope=scope,
            filters=WorkflowLogExportFilters(
                keyword="value",
                status=WorkflowExecutionStatus.SUCCEEDED,
                created_at_before=timestamp,
            ),
        )
        == 1
    )
    assert (
        repository.count_log_export_rows(
            scope=scope,
            filters=WorkflowLogExportFilters(created_at_after=timestamp + timedelta(days=1), end_user_ids=("user-id",)),
        )
        == 0
    )


@pytest.mark.parametrize("standby_disconnect", [False, True], ids=["recovery-conflict", "standby-disconnect"])
def test_workflow_csv_retries_the_same_page_without_rewriting_rows(
    standby_disconnect: bool,
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Recover the failed page on a new connection and keep exactly one CSV row per run."""
    monkeypatch.setattr(workflow_app_log_query_repository, "_LOG_EXPORT_BATCH_SIZE", 1)
    timestamp = datetime(2026, 1, 1)
    logs = [
        _log(log_id, created_by="actor-1", created_by_role=CreatorUserRole.ACCOUNT, created_at=timestamp)
        for log_id in ("a", "b", "c")
    ]
    with sqlite_session_factory.begin() as session:
        session.add_all([*reversed(logs), *(_run(log.workflow_run_id) for log in logs)])

    repository = WorkflowAppLogQueryRepository(session_factory=sqlite_session_factory)
    writer = WorkflowLogCsvWriter(logs=WorkflowAppLogQueryService(logs=repository))
    scope = WorkflowLogExportScope(tenant_id="tenant-1", app_id="app-1")
    filters = WorkflowLogExportFilters()
    baseline = StringIO(newline="")
    assert writer.write_scoped_csv(scope=scope, filters=filters, output=baseline) == 3
    reader = csv.DictReader(StringIO(baseline.getvalue().removeprefix("\ufeff")))
    assert [row["run_id"] for row in reader] == [log.workflow_run_id for log in logs]

    progress: list[int] = []
    attempts: list[tuple[str, tuple[object, ...], int]] = []
    connections: list[object] = []
    connections_held_during_retry: list[int] = []
    pool = sqlite_engine.pool
    assert isinstance(pool, QueuePool)
    monkeypatch.setattr(
        log_export_queries, "sleep", lambda _delay: connections_held_during_retry.append(pool.checkedout())
    )
    monkeypatch.setattr(log_export_queries, "_log_export_requires_standby", lambda _session: standby_disconnect)

    def interrupt_second_page(
        connection: Connection,
        _cursor: object,
        statement: str,
        parameters: tuple[object, ...],
        _context: object,
        _executemany: object,
    ) -> None:
        if "WITH workflow_export_candidates AS" not in statement:
            return
        attempts.append((statement, parameters, len(progress)))
        connections.append(connection.connection.dbapi_connection)
        if len(attempts) == 2:
            error: PostgresOperationalError
            if standby_disconnect:
                error = PostgresOperationalError("connection reset by peer")
            else:
                error = postgres_errors.SerializationFailure("canceling statement due to conflict with recovery")
                error.__setstate__({"pgcode": "40001"})
            raise OperationalError(statement, parameters, error, connection_invalidated=standby_disconnect)

    output = StringIO(newline="")
    event.listen(sqlite_engine, "before_cursor_execute", interrupt_second_page)
    try:
        assert writer.write_scoped_csv(scope=scope, filters=filters, output=output, report_rows=progress.append) == 3
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", interrupt_second_page)

    assert attempts[1] == attempts[2]
    assert attempts[1][2] == 1
    assert connections[1] is not connections[2]
    assert connections_held_during_retry == [0]
    assert progress == [1, 2, 3]
    assert output.getvalue() == baseline.getvalue()
    reason = "standby disconnect" if standby_disconnect else "recovery conflict"
    assert f"Retrying workflow log export page after PostgreSQL {reason}: app=app-1 page=run" in caplog.text


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


def test_enum_value_rejects_missing_required_value() -> None:
    with pytest.raises(ValueError, match="Required enum value is missing"):
        WorkflowAppLogQueryRepository._enum_value(None)


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


@pytest.mark.parametrize("include_evaluation", [True, False])
def test_get_paginated_attaches_completed_evaluation_metrics_when_enabled(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    include_evaluation: bool,
) -> None:
    log = _log(
        "evaluated-log",
        created_by="actor-1",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    evaluation_run = EvaluationRun(
        id="evaluation-run-1",
        tenant_id="tenant-1",
        target_type=EvaluationTargetType.APPS,
        target_id="app-1",
        evaluation_config_id="evaluation-config-1",
        config_snapshot="{}",
        status=EvaluationRunStatus.COMPLETED,
        total_items=1,
        completed_items=1,
        failed_items=0,
        created_by="actor-1",
    )
    metric_details: dict[str, object] = {}
    metrics = {
        "name": "faithfulness",
        "value": 0.9,
        "details": metric_details,
        "node_info": {"node_id": "llm-1", "type": "llm", "title": "Answer"},
    }
    evaluation_item = EvaluationRunItem(
        evaluation_run_id=evaluation_run.id,
        workflow_run_id=log.workflow_run_id,
        item_index=1,
        metrics=json.dumps([metrics]),
    )
    sqlite_session.add_all([_run(log.workflow_run_id), log, evaluation_run, evaluation_item])
    sqlite_session.commit()

    repository = WorkflowAppLogQueryRepository(
        session_factory=sqlite_session_factory, include_evaluation=include_evaluation
    )
    result = repository.get_paginated(tenant_id="tenant-1", app_id="app-1")

    assert result.data[0].evaluation == ((metrics,) if include_evaluation else ())


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
