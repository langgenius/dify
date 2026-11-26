import csv
import datetime
import logging
import re
import time
from collections.abc import Iterator
from dataclasses import dataclass
from functools import partial
from io import StringIO
from pathlib import Path
from threading import Event
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch
from uuid import uuid4

import click
import pytest
from click.testing import CliRunner
from sqlalchemy import Engine, event, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, scoped_session, sessionmaker

from commands import clean_expired_messages, retention
from dify_app import DifyApp
from extensions import ext_application_services, ext_commands
from extensions.ext_storage import storage
from extensions.storage.opendal_storage import OpenDALStorage
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus
from models.agent import Agent, AgentScope, AgentSource
from models.enums import ConversationFromSource, CreatorUserRole, InvokeFrom, WorkflowRunTriggeredFrom
from models.model import AppMode
from models.workflow import (
    WorkflowAppLog,
    WorkflowAppLogCreatedFrom,
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionTriggeredFrom,
    WorkflowRun,
    WorkflowType,
)
from services.retention.log_export_csv import write_log_export_csv
from services.retention.workflow_run import bundle_archive_maintenance
from services.retention.workflow_run.bundle_archive_maintenance import (
    BundleOperationResult,
    BundleOperationSummary,
)
from tests.helpers.unit.model_factories import make_account, make_app, make_conversation, make_end_user, make_message

"""Tests for workflow-run archive command database boundaries.

Planning deliberately creates a fresh session for every tenant prefix and for
every database retry.  SQLite-backed tests keep the query, filtering, counting,
and session lifecycle real while clocks, billing lookup, and command failures
remain narrow external-boundary substitutions.
"""


_CURSOR_0 = "00000000-0000-0000-0000-000000000000"
_CURSOR_1 = "00000000-0000-0000-0000-000000000001"
_CURSOR_2 = "00000000-0000-0000-0000-000000000002"


@pytest.fixture
def log_export_cli() -> DifyApp:
    """Register the real export command and use services bound to the unit database."""
    app = DifyApp(__name__)
    ext_application_services.init_app(app)
    ext_commands.init_app(app)
    return app


@pytest.mark.parametrize("destination", ["local", "storage"])
def test_export_app_logs_writes_console_csv_with_the_requested_filters(
    log_export_cli: DifyApp,
    sqlite_session_factory: sessionmaker[Session],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    destination: str,
) -> None:
    app = make_app(app_id=str(uuid4()), mode=AppMode.COMPLETION)
    account = make_account(account_id=str(uuid4()))
    lower_bound = datetime.datetime(2026, 1, 1)
    with sqlite_session_factory.begin() as session:
        session.add_all([app, account])
        for label, created_at, account_id in (
            ("included", lower_bound, account.id),
            ("upper bound", lower_bound + datetime.timedelta(days=1), account.id),
            ("other account", lower_bound, str(uuid4())),
        ):
            conversation = make_conversation(
                conversation_id=str(uuid4()),
                app_id=app.id,
                mode=app.mode,
                from_source=ConversationFromSource.CONSOLE,
                from_account_id=account_id,
            )
            conversation.created_at = created_at
            session.add(conversation)
            session.add(
                make_message(
                    message_id=str(uuid4()),
                    app_id=app.id,
                    conversation_id=conversation.id,
                    inputs={"title": label},
                    query="",
                    answer=f"Generated {label}",
                    from_source=ConversationFromSource.CONSOLE,
                    created_at=created_at + datetime.timedelta(days=2),
                    currency="USD",
                )
            )

    args = [
        "export-app-logs",
        "--app-id",
        app.id,
        "--start-from",
        "2026-01-01",
        "--end-before",
        "2026-01-02",
        "--account-id",
        account.id,
    ]
    destination_path = tmp_path / "logs.csv"
    if destination == "storage":
        monkeypatch.setattr(storage, "storage_runner", OpenDALStorage(scheme="fs", root=str(tmp_path)), raising=False)
        args.extend(["--use-cloud-storage", "--filename", "logs"])
    else:
        args.extend(["--filename", str(tmp_path / "logs")])

    with log_export_cli.app_context():
        result = log_export_cli.test_cli_runner().invoke(args=args)
    assert result.exit_code == 0, (result.output, result.exception)
    assert "1 CSV rows in " in result.output
    with destination_path.open(encoding="utf-8-sig", newline="") as output:
        (row,) = csv.DictReader(output)
    assert (row["app_type"], row["account_id"], row["user_input"], row["app_response"]) == (
        "Text Generator",
        account.id,
        '{"title": "included"}',
        "Generated included",
    )
    assert {"agent_id", "conversation_id"}.isdisjoint(row)


def test_export_app_logs_writes_workflow_logs(
    log_export_cli: DifyApp, sqlite_session_factory: sessionmaker[Session], tmp_path: Path
) -> None:
    app = make_app(app_id=str(uuid4()), tenant_id=str(uuid4()), mode=AppMode.WORKFLOW)
    account_id = str(uuid4())
    run = WorkflowRun(
        tenant_id=app.tenant_id,
        app_id=app.id,
        workflow_id=str(uuid4()),
        type=WorkflowType.WORKFLOW,
        triggered_from=WorkflowRunTriggeredFrom.SCHEDULE,
        status=WorkflowExecutionStatus.SUCCEEDED,
        version="1",
        inputs='{"task":"report"}',
        outputs='{"result":"ready"}',
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=account_id,
    )
    run.created_at = datetime.datetime(2026, 1, 1, 23)
    log = WorkflowAppLog(
        tenant_id=app.tenant_id,
        app_id=app.id,
        workflow_id=run.workflow_id,
        workflow_run_id=run.id,
        created_from=WorkflowAppLogCreatedFrom.SERVICE_API,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=account_id,
    )
    log.created_at = datetime.datetime(2026, 1, 2)
    with sqlite_session_factory.begin() as session:
        session.add_all([app, run, log])

    path = tmp_path / "workflow.csv"
    with log_export_cli.app_context():
        result = log_export_cli.test_cli_runner().invoke(
            args=[
                "export-app-logs",
                "--app-id",
                app.id,
                "--filename",
                str(path),
                "--start-from",
                "2026-01-02",
                "--end-before",
                "2026-01-03",
                "--account-id",
                account_id,
            ]
        )

    assert result.exit_code == 0, (result.output, result.exception)
    assert "1 CSV rows in " in result.output
    with path.open(encoding="utf-8-sig", newline="") as output:
        (row,) = csv.DictReader(output)
    assert (row["app_type"], row["run_id"], row["account_id"], row["trigger_by"]) == (
        "Workflow",
        run.id,
        account_id,
        "schedule",
    )


@pytest.mark.parametrize("target_option", ["--agent-id", "--app-id"])
def test_export_app_logs_writes_new_agent_logs(
    log_export_cli: DifyApp, sqlite_session_factory: sessionmaker[Session], tmp_path: Path, target_option: str
) -> None:
    app = make_app(app_id=str(uuid4()), tenant_id=str(uuid4()), mode=AppMode.AGENT)
    agent = Agent(
        id=str(uuid4()),
        tenant_id=app.tenant_id,
        app_id=app.id,
        name="CLI Agent",
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
    )
    end_user = make_end_user(end_user_id=str(uuid4()), tenant_id=app.tenant_id, app_id=app.id)
    conversation = make_conversation(
        conversation_id=str(uuid4()),
        app_id=app.id,
        mode=app.mode,
        from_source=ConversationFromSource.API,
        from_end_user_id=end_user.id,
    )
    message = make_message(
        message_id=str(uuid4()),
        app_id=app.id,
        conversation_id=conversation.id,
        query="Hello",
        answer="Hi",
        currency="USD",
        from_source=ConversationFromSource.API,
        from_end_user_id=end_user.id,
        invoke_from=InvokeFrom.WEB_APP,
        created_at=datetime.datetime(2026, 1, 2),
    )
    with sqlite_session_factory.begin() as session:
        session.add_all([app, agent, end_user, conversation, message])

    path = tmp_path / "agent.csv"
    with log_export_cli.app_context():
        result = log_export_cli.test_cli_runner().invoke(
            args=[
                "export-app-logs",
                target_option,
                agent.id if target_option == "--agent-id" else app.id,
                "--filename",
                str(path),
                "--start-from",
                "2026-01-02",
                "--end-before",
                "2026-01-03",
                "--end-user-id",
                end_user.id,
            ]
        )

    assert result.exit_code == 0, (result.output, result.exception)
    assert "1 CSV rows in " in result.output
    with path.open(encoding="utf-8-sig", newline="") as output:
        (row,) = csv.DictReader(output)
    assert (row["app_type"], row["agent_id"], row["message_id"], row["source"]) == (
        "New Agent",
        agent.id,
        message.id,
        "WebApp",
    )


def test_export_app_logs_keeps_existing_file_when_the_app_is_missing(log_export_cli: DifyApp, tmp_path: Path) -> None:
    existing = tmp_path / "logs.csv"
    existing.write_text("completed export", encoding="utf-8")
    with log_export_cli.app_context():
        result = log_export_cli.test_cli_runner().invoke(
            args=[
                "export-app-logs",
                "--app-id",
                str(uuid4()),
                "--end-before",
                "2026-01-02",
                "--filename",
                str(existing),
            ]
        )

    assert result.exit_code == 1
    assert "App not found." in result.output
    assert existing.read_text(encoding="utf-8") == "completed export"
    assert list(tmp_path.iterdir()) == [existing]


def test_log_export_progress_reports_waiting_and_written_rows(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    waiting, writing, uploading = Event(), Event(), Event()
    reports = {
        "Waiting for first CSV rows | 0 CSV rows written": waiting,
        "Writing CSV | 1 CSV rows written": writing,
        "Uploading CSV | 1 CSV rows written": uploading,
    }
    echo = click.echo

    def capture_report(message: str, *, err: bool) -> None:
        echo(message, err=err)
        report = reports.get(message.partition(" | ")[2])
        if err and report is not None:
            report.set()

    def rows() -> Iterator[dict[str, str]]:
        assert waiting.wait(3), "No progress during the first read"
        yield {"answer": "Hello\nworld"}
        assert writing.wait(3), "No progress after the first CSV row"

    monkeypatch.setattr(retention, "_LOG_EXPORT_PROGRESS_INTERVAL", 0.01)
    monkeypatch.setattr(click, "echo", capture_report)
    with retention._log_export_progress(time.perf_counter()) as update:
        output = StringIO(newline="")
        row_count = write_log_export_csv(
            output, rows(), columns=("answer",), report_rows=partial(update, "Writing CSV")
        )
        update("Uploading CSV", row_count)
        assert uploading.wait(3)

    assert row_count == 1
    assert list(csv.reader(StringIO(output.getvalue().removeprefix("\ufeff")))) == [["answer"], ["Hello\nworld"]]
    assert capsys.readouterr().out == ""


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
            workflow_record = WorkflowRun(
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
            )
            workflow_record.created_at = created_at or self.end_before - datetime.timedelta(days=1)
            session.add(workflow_record)
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


def _tenant_id(prefix: str, suffix: int) -> str:
    return f"{prefix}{suffix:07x}-0000-0000-0000-000000000000"


class TestArchiveWorkflowRunsCases:
    @staticmethod
    @pytest.mark.parametrize(
        "command",
        [retention.restore_workflow_runs, retention.delete_archived_workflow_runs],
    )
    def test_v2_archive_maintenance_rejects_explicitly_empty_tenant_ids(command: click.Command) -> None:
        result = CliRunner().invoke(
            command,
            ["--tenant-ids", "", "--target-month", "2025-03"],
        )

        assert result.exit_code == 2
        assert "tenant-ids must not be empty" in result.output

    @staticmethod
    def test_archive_tenant_id_parser_keeps_omitted_scope_unset() -> None:
        assert retention._parse_comma_separated_ids(None, param_name="tenant-ids") is None

    @staticmethod
    @pytest.fixture
    def archive_db(sqlite_session: Session) -> ArchiveDatabase:
        """Expose archive candidates through the shared full-schema SQLite database."""

        return ArchiveDatabase(
            session_maker=sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
            end_before=datetime.datetime(2025, 4, 1, tzinfo=datetime.UTC),
        )

    @staticmethod
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

    @staticmethod
    def test_safe_remove_scoped_session_recovers_from_real_closed_connection(
        sqlite_engine: Engine,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        maker = sessionmaker(bind=sqlite_engine)
        registry = scoped_session(maker)
        registry().execute(text("select 1"))
        dbapi_connection = registry().connection().connection.dbapi_connection
        assert dbapi_connection is not None
        dbapi_connection.close()
        monkeypatch.setattr(retention, "db", SimpleNamespace(session=registry, engine=sqlite_engine))

        with caplog.at_level(logging.WARNING, logger="commands.retention"):
            retention._safe_remove_scoped_session("archive workflow run command")

        assert not registry.registry.has()
        assert any("Ignoring DB scoped-session cleanup error" in message for message in caplog.messages)

    @staticmethod
    def test_archive_command_db_retry_retries_retryable_db_disconnect(monkeypatch: pytest.MonkeyPatch) -> None:
        attempts = iter([_db_disconnect_error(), "ok"])
        sleep = Mock()
        monkeypatch.setattr("services.retention.workflow_run.db_retry.sleep", sleep)

        def operation() -> str:
            result = next(attempts)
            if isinstance(result, Exception):
                raise result
            return result

        assert retention._run_archive_command_db_retry("archive plan", operation) == "ok"
        sleep.assert_called_once_with(1.0)

    @staticmethod
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
        monkeypatch.setattr("services.retention.workflow_run.db_retry.sleep", sleep)
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

    @staticmethod
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

        callback = retention.archive_workflow_runs.callback
        assert callback is not None
        with pytest.raises(click.ClickException, match="Failed to resolve workflow archive tenant plan"):
            callback(
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

    @staticmethod
    def test_delete_archived_workflow_runs_keeps_single_page_behavior_without_all_pages(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
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

    @staticmethod
    def test_delete_archived_workflow_runs_all_pages_continues_until_empty_page(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
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

    @staticmethod
    def test_delete_archived_workflow_runs_all_pages_fetches_empty_page_after_exact_full_page(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
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

    @staticmethod
    def test_delete_archived_workflow_runs_all_pages_stops_at_first_failed_page(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
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

    @staticmethod
    def test_delete_archived_workflow_runs_all_pages_fails_when_cursor_does_not_advance(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
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

    @staticmethod
    def test_delete_archived_workflow_runs_all_pages_uses_preview_cursor_for_dry_run(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
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

    @staticmethod
    def test_delete_archived_workflow_runs_dry_run_failure_separates_preview_and_destructive_cursors(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
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

    @staticmethod
    def test_delete_archived_workflow_runs_all_pages_starts_after_explicit_cursor(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
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

    @staticmethod
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
    def test_delete_archived_workflow_runs_rejects_invalid_run_shard_options(
        monkeypatch: pytest.MonkeyPatch, shard_args: list[str]
    ) -> None:
        deleter = _patch_bundle_deleter(monkeypatch, [_delete_summary(processed=0)])

        result = CliRunner().invoke(
            retention.delete_archived_workflow_runs,
            ["--target-month", "2025-03", *shard_args],
        )

        assert result.exit_code == 2
        deleter.delete_batch.assert_not_called()

    @staticmethod
    def test_delete_archived_workflow_runs_passes_formatted_run_shard_to_service(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
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

    @staticmethod
    def test_delete_archived_workflow_runs_rejects_mixed_catalog_shards_before_delete(
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
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


def _mock_service() -> MagicMock:
    service = MagicMock()
    service.run.return_value = {
        "batches": 1,
        "total_messages": 10,
        "filtered_messages": 5,
        "total_deleted": 5,
    }
    return service


def _invoke_clean_expired_messages(**kwargs: object) -> None:
    callback = clean_expired_messages.callback
    assert callback is not None
    callback(**kwargs)


class TestCleanExpiredMessagesCases:
    @staticmethod
    def test_absolute_mode_calls_from_time_range() -> None:
        policy = object()
        service = _mock_service()
        start_from = datetime.datetime(2024, 1, 1, 0, 0, 0)
        end_before = datetime.datetime(2024, 2, 1, 0, 0, 0)

        with (
            patch("commands.retention.create_message_clean_policy", return_value=policy),
            patch(
                "commands.retention.MessagesCleanService.from_time_range", return_value=service
            ) as mock_from_time_range,
            patch("commands.retention.MessagesCleanService.from_days") as mock_from_days,
        ):
            _invoke_clean_expired_messages(
                batch_size=200,
                graceful_period=21,
                start_from=start_from,
                end_before=end_before,
                from_days_ago=None,
                before_days=None,
                dry_run=True,
            )

        mock_from_time_range.assert_called_once_with(
            policy=policy,
            start_from=start_from,
            end_before=end_before,
            batch_size=200,
            dry_run=True,
            task_label="custom",
        )
        mock_from_days.assert_not_called()

    @staticmethod
    def test_relative_mode_before_days_only_calls_from_days() -> None:
        policy = object()
        service = _mock_service()

        with (
            patch("commands.retention.create_message_clean_policy", return_value=policy),
            patch("commands.retention.MessagesCleanService.from_days", return_value=service) as mock_from_days,
            patch("commands.retention.MessagesCleanService.from_time_range") as mock_from_time_range,
        ):
            _invoke_clean_expired_messages(
                batch_size=500,
                graceful_period=14,
                start_from=None,
                end_before=None,
                from_days_ago=None,
                before_days=30,
                dry_run=False,
            )

        mock_from_days.assert_called_once_with(
            policy=policy,
            days=30,
            batch_size=500,
            dry_run=False,
            task_label="before-30",
        )
        mock_from_time_range.assert_not_called()

    @staticmethod
    def test_relative_mode_with_from_days_ago_calls_from_time_range() -> None:
        policy = object()
        service = _mock_service()
        fixed_now = datetime.datetime(2024, 8, 20, 12, 0, 0)

        with (
            patch("commands.retention.create_message_clean_policy", return_value=policy),
            patch(
                "commands.retention.MessagesCleanService.from_time_range", return_value=service
            ) as mock_from_time_range,
            patch("commands.retention.MessagesCleanService.from_days") as mock_from_days,
            patch("commands.retention.naive_utc_now", return_value=fixed_now),
        ):
            _invoke_clean_expired_messages(
                batch_size=1000,
                graceful_period=21,
                start_from=None,
                end_before=None,
                from_days_ago=60,
                before_days=30,
                dry_run=False,
            )

        mock_from_time_range.assert_called_once_with(
            policy=policy,
            start_from=fixed_now - datetime.timedelta(days=60),
            end_before=fixed_now - datetime.timedelta(days=30),
            batch_size=1000,
            dry_run=False,
            task_label="60to30",
        )
        mock_from_days.assert_not_called()

    @staticmethod
    @pytest.mark.parametrize(
        ("kwargs", "message"),
        [
            (
                {
                    "start_from": datetime.datetime(2024, 1, 1),
                    "end_before": datetime.datetime(2024, 2, 1),
                    "from_days_ago": None,
                    "before_days": 30,
                },
                "mutually exclusive",
            ),
            (
                {
                    "start_from": datetime.datetime(2024, 1, 1),
                    "end_before": None,
                    "from_days_ago": None,
                    "before_days": None,
                },
                "Both --start-from and --end-before are required",
            ),
            (
                {
                    "start_from": None,
                    "end_before": None,
                    "from_days_ago": 10,
                    "before_days": None,
                },
                "--from-days-ago must be used together with --before-days",
            ),
            (
                {
                    "start_from": None,
                    "end_before": None,
                    "from_days_ago": None,
                    "before_days": -1,
                },
                "--before-days must be >= 0",
            ),
            (
                {
                    "start_from": None,
                    "end_before": None,
                    "from_days_ago": 30,
                    "before_days": 30,
                },
                "--from-days-ago must be greater than --before-days",
            ),
            (
                {
                    "start_from": None,
                    "end_before": None,
                    "from_days_ago": None,
                    "before_days": None,
                },
                "You must provide either (--start-from,--end-before) or (--before-days [--from-days-ago])",
            ),
        ],
    )
    def test_invalid_inputs_raise_usage_error(kwargs: dict[str, object], message: str) -> None:
        with pytest.raises(click.UsageError, match=re.escape(message)):
            _invoke_clean_expired_messages(
                batch_size=1000,
                graceful_period=21,
                start_from=kwargs["start_from"],
                end_before=kwargs["end_before"],
                from_days_ago=kwargs["from_days_ago"],
                before_days=kwargs["before_days"],
                dry_run=False,
            )
