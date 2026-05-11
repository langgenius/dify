from types import SimpleNamespace
from unittest.mock import MagicMock

import click
import pytest

from commands import migrate_legacy_sys_files_workflows
from commands import workflow_migration as workflow_migration_commands


def test_migrate_legacy_sys_files_workflows_command_passes_batch_options(mocker, capsys):
    runner = mocker.patch.object(
        workflow_migration_commands,
        "run_legacy_sys_files_workflow_migration",
        return_value=workflow_migration_commands.LegacySysFilesWorkflowMigrationStats(
            scanned=10,
            migrated=2,
            failed=0,
            batches=1,
            last_id="workflow-10",
        ),
    )

    migrate_legacy_sys_files_workflows.callback(
        batch_size=200,
        limit=500,
        start_after_id="workflow-1",
        tenant_id="tenant-1",
        app_id="app-1",
        dry_run=True,
    )

    runner.assert_called_once_with(
        batch_size=200,
        limit=500,
        start_after_id="workflow-1",
        tenant_id="tenant-1",
        app_id="app-1",
        dry_run=True,
    )
    captured = capsys.readouterr()
    assert "scanned=10" in captured.out
    assert "migrated=2" in captured.out
    assert "last_id=workflow-10" in captured.out


def test_migrate_legacy_sys_files_workflows_rejects_non_positive_batch_size():
    with pytest.raises(click.UsageError, match="batch-size"):
        migrate_legacy_sys_files_workflows.callback(
            batch_size=0,
            limit=None,
            start_after_id=None,
            tenant_id=None,
            app_id=None,
            dry_run=False,
        )


def test_migrate_legacy_sys_files_workflows_rejects_non_positive_limit():
    with pytest.raises(click.UsageError, match="limit"):
        migrate_legacy_sys_files_workflows.callback(
            batch_size=100,
            limit=0,
            start_after_id=None,
            tenant_id=None,
            app_id=None,
            dry_run=False,
        )


def test_build_legacy_sys_files_workflow_query_uses_keyset_pagination():
    stmt = workflow_migration_commands._build_legacy_sys_files_workflow_query(
        start_after_id="workflow-1",
        batch_size=200,
        tenant_id="tenant-1",
        app_id="app-1",
    )
    compiled = str(stmt.compile(compile_kwargs={"literal_binds": True}))

    assert "workflows.id > 'workflow-1'" in compiled
    assert "workflows.tenant_id = 'tenant-1'" in compiled
    assert "workflows.app_id = 'app-1'" in compiled
    assert "ORDER BY workflows.id" in compiled
    assert "LIMIT 200" in compiled


def test_migrate_legacy_sys_files_workflow_batch_dry_run_rolls_back():
    migrated_workflow = MagicMock()
    migrated_workflow.id = "workflow-1"
    migrated_workflow.migrate_legacy_sys_files_graph_in_place.return_value = True
    untouched_workflow = MagicMock()
    untouched_workflow.id = "workflow-2"
    untouched_workflow.migrate_legacy_sys_files_graph_in_place.return_value = False
    session = MagicMock()
    session.scalars.return_value.all.return_value = [migrated_workflow, untouched_workflow]

    stats = workflow_migration_commands._migrate_legacy_sys_files_workflow_batch(
        session=session,
        start_after_id=None,
        batch_size=200,
        tenant_id=None,
        app_id=None,
        dry_run=True,
    )

    assert stats.scanned == 2
    assert stats.migrated == 1
    assert stats.failed == 0
    assert stats.last_id == "workflow-2"
    session.rollback.assert_called_once()
    session.commit.assert_not_called()


def test_migrate_legacy_sys_files_workflow_batch_commits_and_counts_failures(caplog):
    migrated_workflow = MagicMock()
    migrated_workflow.id = "workflow-1"
    migrated_workflow.migrate_legacy_sys_files_graph_in_place.return_value = True
    failing_workflow = MagicMock()
    failing_workflow.id = "workflow-2"
    failing_workflow.migrate_legacy_sys_files_graph_in_place.side_effect = RuntimeError("boom")
    session = MagicMock()
    session.scalars.return_value.all.return_value = [migrated_workflow, failing_workflow]

    stats = workflow_migration_commands._migrate_legacy_sys_files_workflow_batch(
        session=session,
        start_after_id=None,
        batch_size=200,
        tenant_id=None,
        app_id=None,
        dry_run=False,
    )

    assert stats.scanned == 2
    assert stats.migrated == 1
    assert stats.failed == 1
    assert stats.last_id == "workflow-2"
    assert "Failed to migrate legacy" in caplog.text
    session.commit.assert_called_once()
    session.rollback.assert_not_called()


def test_run_legacy_sys_files_workflow_migration_uses_keyset_batches(mocker):
    session_maker = MagicMock()
    sessions = [MagicMock(), MagicMock()]
    session_maker.side_effect = sessions
    mocker.patch.object(workflow_migration_commands, "sessionmaker", return_value=session_maker)
    mocker.patch.object(workflow_migration_commands, "db", SimpleNamespace(engine=object()))
    migrate_batch = mocker.patch.object(
        workflow_migration_commands,
        "_migrate_legacy_sys_files_workflow_batch",
        side_effect=[
            workflow_migration_commands.LegacySysFilesWorkflowMigrationStats(
                scanned=2,
                migrated=1,
                failed=0,
                last_id="workflow-2",
            ),
            workflow_migration_commands.LegacySysFilesWorkflowMigrationStats(
                scanned=1,
                migrated=1,
                failed=0,
                last_id="workflow-3",
            ),
        ],
    )

    stats = workflow_migration_commands.run_legacy_sys_files_workflow_migration(
        batch_size=2,
        limit=3,
        start_after_id="workflow-0",
        tenant_id="tenant-1",
        app_id="app-1",
        dry_run=True,
    )

    assert stats.scanned == 3
    assert stats.migrated == 2
    assert stats.batches == 2
    assert stats.last_id == "workflow-3"
    assert migrate_batch.call_args_list[0].kwargs["start_after_id"] == "workflow-0"
    assert migrate_batch.call_args_list[0].kwargs["batch_size"] == 2
    assert migrate_batch.call_args_list[1].kwargs["start_after_id"] == "workflow-2"
    assert migrate_batch.call_args_list[1].kwargs["batch_size"] == 1


def test_run_legacy_sys_files_workflow_migration_stops_on_empty_batch(mocker):
    session_maker = MagicMock(return_value=MagicMock())
    mocker.patch.object(workflow_migration_commands, "sessionmaker", return_value=session_maker)
    mocker.patch.object(workflow_migration_commands, "db", SimpleNamespace(engine=object()))
    mocker.patch.object(
        workflow_migration_commands,
        "_migrate_legacy_sys_files_workflow_batch",
        return_value=workflow_migration_commands.LegacySysFilesWorkflowMigrationStats(scanned=0),
    )

    stats = workflow_migration_commands.run_legacy_sys_files_workflow_migration(
        batch_size=2,
        limit=None,
        start_after_id=None,
        tenant_id=None,
        app_id=None,
        dry_run=False,
    )

    assert stats.scanned == 0
    assert stats.batches == 0


def test_run_legacy_sys_files_workflow_migration_stops_on_short_batch(mocker):
    session_maker = MagicMock(return_value=MagicMock())
    mocker.patch.object(workflow_migration_commands, "sessionmaker", return_value=session_maker)
    mocker.patch.object(workflow_migration_commands, "db", SimpleNamespace(engine=object()))
    migrate_batch = mocker.patch.object(
        workflow_migration_commands,
        "_migrate_legacy_sys_files_workflow_batch",
        return_value=workflow_migration_commands.LegacySysFilesWorkflowMigrationStats(
            scanned=1,
            migrated=1,
            failed=0,
            last_id="workflow-1",
        ),
    )

    stats = workflow_migration_commands.run_legacy_sys_files_workflow_migration(
        batch_size=2,
        limit=None,
        start_after_id=None,
        tenant_id=None,
        app_id=None,
        dry_run=False,
    )

    assert stats.scanned == 1
    assert stats.batches == 1
    migrate_batch.assert_called_once()
