"""
Scheduled task for archiving workflow runs for paid plan tenants.

This task runs daily to archive workflow runs older than the configured
retention period to S3-compatible storage.
"""

from datetime import UTC, datetime

import click

import app
from configs import dify_config
from libs.archive_storage import ArchiveStorageNotConfiguredError
from services.archive_paid_plan_workflow_run_logs import WorkflowRunArchiver


@app.celery.task(queue="retention")
def archive_workflow_runs_task() -> None:
    """
    Scheduled archiving for workflow runs (paid tenants only).

    Archives the following tables to storage:
    - workflow_node_executions
    - workflow_node_execution_offload
    - workflow_pauses
    - workflow_pause_reasons
    - workflow_trigger_logs
    """
    if not dify_config.ARCHIVE_STORAGE_ENABLED:
        click.echo(
            click.style(
                "Archive storage is not enabled. Skipping scheduled archiving.",
                fg="yellow",
            )
        )
        return

    click.echo(
        click.style(
            (
                "Scheduled workflow run archiving starting: "
                f"retention={dify_config.PAID_PLAN_WORKFLOW_RUN_ARCHIVE_RETENTION_DAYS} days"
            ),
            fg="green",
        )
    )

    start_time = datetime.now(UTC)

    try:
        archiver = WorkflowRunArchiver(
            days=dify_config.PAID_PLAN_WORKFLOW_RUN_ARCHIVE_RETENTION_DAYS,
            batch_size=dify_config.PAID_PLAN_WORKFLOW_RUN_ARCHIVE_BATCH_SIZE,
            tenant_id=None,  # Archive all paid tenants
            limit=None,  # No limit for scheduled task
            dry_run=False,
        )
        summary = archiver.run()

        end_time = datetime.now(UTC)
        elapsed = end_time - start_time

        click.echo(
            click.style(
                f"Scheduled workflow run archiving finished. "
                f"archived={summary.runs_archived}, skipped={summary.runs_skipped}, "
                f"failed={summary.runs_failed}, duration={elapsed}",
                fg="green",
            )
        )
    except ArchiveStorageNotConfiguredError as e:
        click.echo(
            click.style(
                f"Archive storage configuration error: {e}",
                fg="red",
            )
        )
    except Exception as e:
        click.echo(
            click.style(
                f"Scheduled workflow run archiving failed: {e}",
                fg="red",
            )
        )
        raise
