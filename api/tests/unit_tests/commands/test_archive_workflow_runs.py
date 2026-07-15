import datetime
from unittest.mock import MagicMock

import click
import pytest
from click.testing import CliRunner
from sqlalchemy.exc import OperationalError

from commands import retention


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
