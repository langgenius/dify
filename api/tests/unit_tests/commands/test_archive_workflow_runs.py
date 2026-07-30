import datetime
from unittest.mock import MagicMock

import click
import pytest
from click.testing import CliRunner
from sqlalchemy.exc import OperationalError

from commands import retention
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


def _session_context(session):
    context = MagicMock()
    context.__enter__.return_value = session
    context.__exit__.return_value = False
    return context


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


def test_resolve_archive_tenant_ids_from_plan_uses_explicit_sessions(monkeypatch):
    end_before = datetime.datetime(2025, 4, 1, tzinfo=datetime.UTC)
    sessions = [MagicMock(name="session-a"), MagicMock(name="session-b")]
    session_maker = MagicMock(side_effect=[_session_context(sessions[0]), _session_context(sessions[1])])
    calls = []

    def get_candidate_tenants(session, prefix, *, start_from, end_before):
        calls.append((session, prefix, start_from, end_before))
        return [f"{prefix}-paid", f"{prefix}-free"]

    monkeypatch.setattr(retention, "_get_archive_candidate_tenant_ids_by_prefix", get_candidate_tenants)
    monkeypatch.setattr(
        retention,
        "_filter_paid_workflow_archive_tenant_ids",
        lambda tenant_ids: (["a-paid", "b-paid"], ["a-free", "b-free"]),
    )

    tenant_plan = retention._resolve_archive_tenant_ids_from_plan(
        session_maker=session_maker,
        tenant_ids=None,
        tenant_prefixes=["a", "b"],
        start_from=None,
        end_before=end_before,
    )

    assert tenant_plan["archive_tenant_ids"] == ["a-paid", "b-paid"]
    assert tenant_plan["paid_tenant_ids"] == ["a-paid", "b-paid"]
    assert tenant_plan["unpaid_tenant_ids"] == ["a-free", "b-free"]
    assert calls == [
        (sessions[0], "a", None, end_before),
        (sessions[1], "b", None, end_before),
    ]


def test_safe_remove_scoped_session_discards_registry_and_disposes_after_remove_error(monkeypatch):
    fake_db = MagicMock()
    fake_db.session.remove.side_effect = RuntimeError("server closed the connection unexpectedly")
    monkeypatch.setattr(retention, "db", fake_db)

    retention._safe_remove_scoped_session("archive workflow run command")

    fake_db.session.remove.assert_called_once()
    fake_db.session.registry.clear.assert_called_once()
    fake_db.engine.dispose.assert_called_once()


def test_archive_command_db_retry_retries_retryable_db_disconnect(monkeypatch):
    operation = MagicMock(side_effect=[_db_disconnect_error(), "ok"])
    sleep = MagicMock()
    monkeypatch.setattr("services.retention.workflow_run.db_retry.time.sleep", sleep)

    result = retention._run_archive_command_db_retry("archive plan", operation)

    assert result == "ok"
    assert operation.call_count == 2
    sleep.assert_called_once_with(1.0)


def test_archive_plan_prefix_stats_retries_count_query_with_fresh_session(monkeypatch):
    end_before = datetime.datetime(2025, 4, 1, tzinfo=datetime.UTC)
    sessions = [MagicMock(name="session-1"), MagicMock(name="session-2")]
    sessions[0].scalar.side_effect = _db_disconnect_error()
    sessions[1].scalar.side_effect = [7, 9]
    session_maker = MagicMock(side_effect=[_session_context(sessions[0]), _session_context(sessions[1])])
    sleep = MagicMock()

    monkeypatch.setattr(
        retention,
        "_get_archive_candidate_tenant_ids_by_prefix",
        lambda session, prefix, *, start_from, end_before: [f"{prefix}-tenant"],
    )
    monkeypatch.setattr("services.retention.workflow_run.db_retry.time.sleep", sleep)

    stats = retention._get_archive_plan_prefix_stats(
        session_maker,
        "a",
        start_from=None,
        end_before=end_before,
    )

    assert stats["tenant_ids"] == ["a-tenant"]
    assert stats["workflow_runs"] == 7
    assert stats["workflow_node_executions"] == 9
    assert session_maker.call_count == 2
    sleep.assert_called_once_with(1.0)


def test_archive_workflow_runs_raises_click_exception_when_tenant_plan_fails(monkeypatch):
    fake_db = MagicMock()
    monkeypatch.setattr(retention, "db", fake_db)
    monkeypatch.setattr(
        retention,
        "_resolve_archive_tenant_ids_from_plan",
        MagicMock(side_effect=RuntimeError("tenant plan failed")),
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
