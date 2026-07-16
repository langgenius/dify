"""Tests for workflow-run archive command database boundaries.

Planning deliberately creates a fresh session for every tenant prefix and for
every database retry.  SQLite-backed tests keep the query, filtering, counting,
and session lifecycle real while clocks, billing lookup, and command failures
remain narrow external-boundary substitutions.
"""

import datetime
import logging
from dataclasses import dataclass
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock
from uuid import uuid4

import click
import pytest
from click.testing import CliRunner
from sqlalchemy import Engine, event, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, scoped_session, sessionmaker

from commands import retention
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus
from models.base import TypeBase
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.workflow import (
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionTriggeredFrom,
    WorkflowRun,
    WorkflowType,
)
from services.retention.workflow_run import bundle_archive_maintenance
from services.retention.workflow_run.bundle_archive_maintenance import (
    BundleOperationResult,
    BundleOperationSummary,
)

_CURSOR_0 = "00000000-0000-0000-0000-000000000000"
_CURSOR_1 = "00000000-0000-0000-0000-000000000001"
_CURSOR_2 = "00000000-0000-0000-0000-000000000002"


def _db_disconnect_error() -> OperationalError:
    return OperationalError(
        "select 1",
        {},
        RuntimeError("server closed the connection unexpectedly"),
        connection_invalidated=True,
    )


@dataclass(frozen=True)
class ArchiveDatabase:
    """Creates archive candidates and their node executions in SQLite."""

    session_maker: sessionmaker[Session]
    end_before: datetime.datetime

    def add_run(
        self,
        tenant_id: str,
        *,
        created_at: datetime.datetime | None = None,
        status: WorkflowExecutionStatus = WorkflowExecutionStatus.SUCCEEDED,
        run_type: WorkflowType = WorkflowType.WORKFLOW,
    ) -> str:
        run_id = str(uuid4())
        with self.session_maker.begin() as session:
            session.add(
                WorkflowRun(
                    id=run_id,
                    tenant_id=tenant_id,
                    app_id=str(uuid4()),
                    workflow_id=str(uuid4()),
                    type=run_type,
                    triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
                    version="1",
                    graph="{}",
                    inputs="{}",
                    status=status,
                    outputs="{}",
                    error=None,
                    elapsed_time=0,
                    total_tokens=0,
                    total_steps=1,
                    created_by_role=CreatorUserRole.ACCOUNT,
                    created_by=str(uuid4()),
                    created_at=created_at or self.end_before - datetime.timedelta(days=1),
                )
            )
        return run_id

    def add_node(self, run_id: str, tenant_id: str, *, index: int) -> None:
        with self.session_maker.begin() as session:
            session.add(
                WorkflowNodeExecutionModel(
                    id=str(uuid4()),
                    tenant_id=tenant_id,
                    app_id=str(uuid4()),
                    workflow_id=str(uuid4()),
                    triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
                    workflow_run_id=run_id,
                    index=index,
                    predecessor_node_id=None,
                    node_execution_id=None,
                    node_id=f"node-{index}",
                    node_type="start",
                    title="Start",
                    inputs="{}",
                    process_data="{}",
                    outputs="{}",
                    status=WorkflowNodeExecutionStatus.SUCCEEDED,
                    error=None,
                    elapsed_time=0,
                    execution_metadata="{}",
                    created_by_role=CreatorUserRole.ACCOUNT,
                    created_by=str(uuid4()),
                )
            )


def _delete_summary(
    *,
    processed: int,
    succeeded: int = 0,
    failed: int = 0,
    next_catalog_id: str | None = None,
    preview_next_catalog_id: str | None = None,
    results: list[BundleOperationResult] | None = None,
) -> BundleOperationSummary:
    return BundleOperationSummary(
        operation="delete",
        bundles_processed=processed,
        bundles_succeeded=succeeded,
        bundles_failed=failed,
        next_catalog_id=next_catalog_id,
        preview_next_catalog_id=preview_next_catalog_id,
        results=results or [],
    )


def _patch_bundle_deleter(
    monkeypatch: pytest.MonkeyPatch,
    summaries: list[BundleOperationSummary],
) -> MagicMock:
    deleter = MagicMock()
    deleter.delete_batch.side_effect = summaries
    monkeypatch.setattr(
        bundle_archive_maintenance,
        "WorkflowRunBundleArchiveMaintenance",
        MagicMock(return_value=deleter),
    )
    return deleter


@pytest.mark.parametrize(
    "command",
    [retention.restore_workflow_runs, retention.delete_archived_workflow_runs],
)
def test_v2_archive_maintenance_rejects_explicitly_empty_tenant_ids(command):
    result = CliRunner().invoke(
        command,
        ["--tenant-ids", "", "--target-month", "2025-03"],
    )

    assert result.exit_code == 2
    assert "tenant-ids must not be empty" in result.output


def test_archive_tenant_id_parser_keeps_omitted_scope_unset():
    assert retention._parse_comma_separated_ids(None, param_name="tenant-ids") is None


@pytest.fixture
def archive_db(sqlite_engine: Engine) -> ArchiveDatabase:
    """Create only the workflow tables used by archive planning."""

    TypeBase.metadata.create_all(
        sqlite_engine,
        tables=[WorkflowRun.__table__, WorkflowNodeExecutionModel.__table__],
    )
    return ArchiveDatabase(
        session_maker=sessionmaker(bind=sqlite_engine, expire_on_commit=False),
        end_before=datetime.datetime(2025, 4, 1, tzinfo=datetime.UTC),
    )


def _tenant_id(prefix: str, suffix: int) -> str:
    return f"{prefix}{suffix:07x}-0000-0000-0000-000000000000"


def test_resolve_archive_tenant_ids_from_plan_uses_fresh_real_sessions(
    archive_db: ArchiveDatabase, monkeypatch: pytest.MonkeyPatch
) -> None:
    paid_a = _tenant_id("a", 1)
    free_a = _tenant_id("a", 2)
    paid_b = _tenant_id("b", 1)
    free_b = _tenant_id("b", 2)
    for tenant_id in (paid_a, free_a, paid_b, free_b):
        archive_db.add_run(tenant_id)

    # These decoys verify the real candidate query's time, status, and type filters.
    archive_db.add_run(
        _tenant_id("a", 3),
        created_at=archive_db.end_before + datetime.timedelta(seconds=1),
    )
    archive_db.add_run(_tenant_id("a", 4), status=WorkflowExecutionStatus.RUNNING)
    archive_db.add_run(_tenant_id("a", 5), run_type=WorkflowType.CHAT)

    opened_sessions: list[Session] = []

    def record_session(session: Session, _transaction: object, _connection: object) -> None:
        opened_sessions.append(session)

    event.listen(archive_db.session_maker.class_, "after_begin", record_session)
    monkeypatch.setattr(
        retention,
        "_filter_paid_workflow_archive_tenant_ids",
        lambda tenant_ids: ([paid_a, paid_b], sorted(set(tenant_ids) - {paid_a, paid_b})),
    )
    try:
        tenant_plan = retention._resolve_archive_tenant_ids_from_plan(
            session_maker=archive_db.session_maker,
            tenant_ids=None,
            tenant_prefixes=["a", "b"],
            start_from=None,
            end_before=archive_db.end_before,
        )
    finally:
        event.remove(archive_db.session_maker.class_, "after_begin", record_session)

    assert tenant_plan == {
        "archive_tenant_ids": [paid_a, paid_b],
        "paid_tenant_ids": [paid_a, paid_b],
        "unpaid_tenant_ids": [free_a, free_b],
    }
    assert len(opened_sessions) == 2
    assert opened_sessions[0] is not opened_sessions[1]


def test_safe_remove_scoped_session_recovers_from_real_closed_connection(
    sqlite_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    maker = sessionmaker(bind=sqlite_engine)
    registry = scoped_session(maker)
    registry().execute(text("select 1"))
    sqlite_engine.dispose()
    monkeypatch.setattr(retention, "db", SimpleNamespace(session=registry, engine=sqlite_engine))

    with caplog.at_level(logging.WARNING, logger="commands.retention"):
        retention._safe_remove_scoped_session("archive workflow run command")

    assert not registry.registry.has()
    assert any("Ignoring DB scoped-session cleanup error" in message for message in caplog.messages)


def test_archive_command_db_retry_retries_retryable_db_disconnect(monkeypatch: pytest.MonkeyPatch) -> None:
    attempts = iter([_db_disconnect_error(), "ok"])
    sleep = Mock()
    monkeypatch.setattr("services.retention.workflow_run.db_retry.time.sleep", sleep)

    def operation() -> str:
        result = next(attempts)
        if isinstance(result, Exception):
            raise result
        return result

    assert retention._run_archive_command_db_retry("archive plan", operation) == "ok"
    sleep.assert_called_once_with(1.0)


def test_archive_plan_prefix_stats_retries_with_fresh_session_and_real_counts(
    archive_db: ArchiveDatabase, sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    tenant_id = _tenant_id("a", 1)
    run_ids = [archive_db.add_run(tenant_id) for _ in range(7)]
    for index in range(9):
        archive_db.add_node(run_ids[index % len(run_ids)], tenant_id, index=index)

    # Decoys outside the selected prefix and archive window must not affect counts.
    decoy_run_id = archive_db.add_run(_tenant_id("b", 1))
    archive_db.add_node(decoy_run_id, _tenant_id("b", 1), index=99)
    archive_db.add_run(
        tenant_id,
        created_at=archive_db.end_before + datetime.timedelta(seconds=1),
    )

    fail_next_query = True

    def disconnect_once(
        _connection: object,
        _cursor: object,
        _statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        nonlocal fail_next_query
        if fail_next_query:
            fail_next_query = False
            raise _db_disconnect_error()

    opened_sessions: list[Session] = []

    def record_session(session: Session, _transaction: object, _connection: object) -> None:
        opened_sessions.append(session)

    sleep = Mock()
    monkeypatch.setattr("services.retention.workflow_run.db_retry.time.sleep", sleep)
    event.listen(sqlite_engine, "before_cursor_execute", disconnect_once)
    event.listen(archive_db.session_maker.class_, "after_begin", record_session)
    try:
        stats = retention._get_archive_plan_prefix_stats(
            archive_db.session_maker,
            "a",
            start_from=None,
            end_before=archive_db.end_before,
        )
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", disconnect_once)
        event.remove(archive_db.session_maker.class_, "after_begin", record_session)

    assert stats == {
        "tenant_ids": [tenant_id],
        "workflow_runs": 7,
        "workflow_node_executions": 9,
    }
    assert len(opened_sessions) == 2
    assert opened_sessions[0] is not opened_sessions[1]
    sleep.assert_called_once_with(1.0)


def test_archive_workflow_runs_raises_click_exception_when_tenant_plan_fails(
    sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    registry = scoped_session(sessionmaker(bind=sqlite_engine))
    monkeypatch.setattr(retention, "db", SimpleNamespace(engine=sqlite_engine, session=registry))
    monkeypatch.setattr(
        retention,
        "_resolve_archive_tenant_ids_from_plan",
        Mock(side_effect=RuntimeError("tenant plan failed")),
    )

    with pytest.raises(click.ClickException, match="Failed to resolve workflow archive tenant plan"):
        retention.archive_workflow_runs.callback(
            tenant_ids="tenant-1",
            tenant_prefixes=None,
            before_days=90,
            from_days_ago=None,
            to_days_ago=None,
            start_from=None,
            end_before=None,
            batch_size=10000,
            workers=1,
            run_shard_index=None,
            run_shard_total=None,
            limit=None,
            dry_run=True,
            delete_after_archive=False,
        )


def test_delete_archived_workflow_runs_keeps_single_page_behavior_without_all_pages(monkeypatch):
    deleter = _patch_bundle_deleter(
        monkeypatch,
        [_delete_summary(processed=2, succeeded=2, next_catalog_id=_CURSOR_1)],
    )

    result = CliRunner().invoke(
        retention.delete_archived_workflow_runs,
        ["--target-month", "2025-03", "--limit", "2"],
    )

    assert result.exit_code == 0
    deleter.delete_batch.assert_called_once()
    assert deleter.delete_batch.call_args.kwargs["target_year"] == 2025
    assert deleter.delete_batch.call_args.kwargs["target_month"] == 3
    assert deleter.delete_batch.call_args.kwargs["after_catalog_id"] is None
    assert deleter.delete_batch.call_args.kwargs["limit"] == 2


def test_delete_archived_workflow_runs_all_pages_continues_until_empty_page(monkeypatch):
    deleter = _patch_bundle_deleter(
        monkeypatch,
        [
            _delete_summary(processed=2, succeeded=2, next_catalog_id=_CURSOR_1),
            _delete_summary(processed=1, succeeded=1, next_catalog_id=_CURSOR_2),
            _delete_summary(processed=0),
        ],
    )

    result = CliRunner().invoke(
        retention.delete_archived_workflow_runs,
        ["--target-month", "2025-03", "--all-pages", "--limit", "2"],
    )

    assert result.exit_code == 0
    assert [call.kwargs["after_catalog_id"] for call in deleter.delete_batch.call_args_list] == [
        None,
        _CURSOR_1,
        _CURSOR_2,
    ]


def test_delete_archived_workflow_runs_all_pages_fetches_empty_page_after_exact_full_page(monkeypatch):
    deleter = _patch_bundle_deleter(
        monkeypatch,
        [
            _delete_summary(processed=2, succeeded=2, next_catalog_id=_CURSOR_1),
            _delete_summary(processed=0),
        ],
    )

    result = CliRunner().invoke(
        retention.delete_archived_workflow_runs,
        ["--target-month", "2025-03", "--all-pages", "--limit", "2"],
    )

    assert result.exit_code == 0
    assert deleter.delete_batch.call_count == 2
    assert deleter.delete_batch.call_args_list[1].kwargs["after_catalog_id"] == _CURSOR_1


def test_delete_archived_workflow_runs_all_pages_stops_at_first_failed_page(monkeypatch):
    failed_result = BundleOperationResult(
        catalog_id=_CURSOR_2,
        bundle_id="bundle-failed",
        tenant_id="tenant-1",
        object_prefix="workflow-runs/v2/tenant-1/2025/03/00-of-16/bundle-failed",
        error="archive checksum mismatch",
    )
    deleter = _patch_bundle_deleter(
        monkeypatch,
        [
            _delete_summary(processed=1, succeeded=1, next_catalog_id=_CURSOR_1),
            _delete_summary(processed=1, failed=1, results=[failed_result]),
            _delete_summary(processed=0),
        ],
    )

    result = CliRunner().invoke(
        retention.delete_archived_workflow_runs,
        ["--target-month", "2025-03", "--all-pages"],
    )

    assert result.exit_code == 1
    assert deleter.delete_batch.call_count == 2
    assert "target_month=2025-03" in result.output
    assert f"failed_catalog_id={_CURSOR_2}" in result.output
    assert f"resume_after_catalog_id={_CURSOR_1}" in result.output


def test_delete_archived_workflow_runs_all_pages_fails_when_cursor_does_not_advance(monkeypatch):
    deleter = _patch_bundle_deleter(
        monkeypatch,
        [_delete_summary(processed=1, succeeded=1, next_catalog_id=None)],
    )

    result = CliRunner().invoke(
        retention.delete_archived_workflow_runs,
        ["--target-month", "2025-03", "--all-pages"],
    )

    assert result.exit_code == 1
    deleter.delete_batch.assert_called_once()
    assert "cursor did not advance" in result.output.lower()


def test_delete_archived_workflow_runs_all_pages_uses_preview_cursor_for_dry_run(monkeypatch):
    deleter = _patch_bundle_deleter(
        monkeypatch,
        [
            _delete_summary(processed=1, succeeded=1, preview_next_catalog_id=_CURSOR_1),
            _delete_summary(processed=0),
        ],
    )

    result = CliRunner().invoke(
        retention.delete_archived_workflow_runs,
        ["--target-month", "2025-03", "--all-pages", "--dry-run"],
    )

    assert result.exit_code == 0
    assert [call.kwargs["after_catalog_id"] for call in deleter.delete_batch.call_args_list] == [
        None,
        _CURSOR_1,
    ]


def test_delete_archived_workflow_runs_dry_run_failure_separates_preview_and_destructive_cursors(monkeypatch):
    failed_result = BundleOperationResult(
        catalog_id=_CURSOR_2,
        bundle_id="bundle-failed",
        tenant_id="tenant-1",
        object_prefix="workflow-runs/v2/tenant-1/2025/03/00-of-16/bundle-failed",
        error="archive checksum mismatch",
    )
    deleter = _patch_bundle_deleter(
        monkeypatch,
        [
            _delete_summary(
                processed=1,
                succeeded=1,
                preview_next_catalog_id=_CURSOR_1,
            ),
            _delete_summary(
                processed=1,
                failed=1,
                results=[failed_result],
            ),
        ],
    )

    result = CliRunner().invoke(
        retention.delete_archived_workflow_runs,
        [
            "--target-month",
            "2025-03",
            "--after-catalog-id",
            _CURSOR_0,
            "--all-pages",
            "--dry-run",
        ],
    )

    assert result.exit_code == 1
    assert deleter.delete_batch.call_count == 2
    assert f"failed_catalog_id={_CURSOR_2}" in result.output
    assert f"preview_after_catalog_id={_CURSOR_1}" in result.output
    assert f"destructive_retry_after_catalog_id={_CURSOR_0}" in result.output


def test_delete_archived_workflow_runs_all_pages_starts_after_explicit_cursor(monkeypatch):
    deleter = _patch_bundle_deleter(monkeypatch, [_delete_summary(processed=0)])

    result = CliRunner().invoke(
        retention.delete_archived_workflow_runs,
        [
            "--target-month",
            "2025-03",
            "--after-catalog-id",
            _CURSOR_0,
            "--all-pages",
        ],
    )

    assert result.exit_code == 0
    deleter.delete_batch.assert_called_once()
    assert deleter.delete_batch.call_args.kwargs["after_catalog_id"] == _CURSOR_0


@pytest.mark.parametrize(
    "shard_args",
    [
        ["--run-shard-index", "0"],
        ["--run-shard-total", "16"],
        ["--run-shard-index", "16", "--run-shard-total", "16"],
        ["--run-shard-index", "-1", "--run-shard-total", "16"],
        ["--run-shard-index", "0", "--run-shard-total", "0"],
        ["--run-shard-index", "0", "--run-shard-total", "17"],
    ],
)
def test_delete_archived_workflow_runs_rejects_invalid_run_shard_options(monkeypatch, shard_args):
    deleter = _patch_bundle_deleter(monkeypatch, [_delete_summary(processed=0)])

    result = CliRunner().invoke(
        retention.delete_archived_workflow_runs,
        ["--target-month", "2025-03", *shard_args],
    )

    assert result.exit_code == 2
    deleter.delete_batch.assert_not_called()


def test_delete_archived_workflow_runs_passes_formatted_run_shard_to_service(monkeypatch):
    deleter = _patch_bundle_deleter(monkeypatch, [_delete_summary(processed=0)])

    result = CliRunner().invoke(
        retention.delete_archived_workflow_runs,
        [
            "--target-month",
            "2025-03",
            "--tenant-ids",
            "tenant-1",
            "--run-shard-index",
            "3",
            "--run-shard-total",
            "16",
        ],
    )

    assert result.exit_code == 0
    deleter.validate_catalog_shards.assert_called_once_with(
        target_year=2025,
        target_month=3,
        shard_total=16,
        tenant_ids=["tenant-1"],
    )
    deleter.delete_batch.assert_called_once()
    assert deleter.delete_batch.call_args.kwargs["shard"] == "03-of-16"


def test_delete_archived_workflow_runs_rejects_mixed_catalog_shards_before_delete(monkeypatch):
    deleter = _patch_bundle_deleter(monkeypatch, [_delete_summary(processed=0)])
    deleter.validate_catalog_shards.side_effect = ValueError("unexpected shards: 00-of-01")

    result = CliRunner().invoke(
        retention.delete_archived_workflow_runs,
        [
            "--target-month",
            "2025-03",
            "--run-shard-index",
            "3",
            "--run-shard-total",
            "16",
        ],
    )

    assert result.exit_code == 1
    assert "shard preflight failed" in result.output.lower()
    assert "00-of-01" in result.output
    deleter.delete_batch.assert_not_called()
