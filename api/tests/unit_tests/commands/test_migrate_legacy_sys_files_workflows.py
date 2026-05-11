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
