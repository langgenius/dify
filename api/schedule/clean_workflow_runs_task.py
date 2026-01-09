from datetime import UTC, datetime

import click

import app
from configs import dify_config
from services.retention.workflow_run.clear_free_plan_expired_workflow_run_logs import WorkflowRunCleanup


@app.celery.task(queue="retention")
def clean_workflow_runs_task() -> None:
    """
    Scheduled cleanup for workflow runs and related records (sandbox tenants only).
    """
    click.echo(
        click.style(
            (
                "Scheduled workflow run cleanup starting: "
                f"cutoff={dify_config.SANDBOX_EXPIRED_RECORDS_RETENTION_DAYS} days, "
                f"batch={dify_config.SANDBOX_EXPIRED_RECORDS_CLEAN_BATCH_SIZE}"
            ),
            fg="green",
        )
    )

    start_time = datetime.now(UTC)

    WorkflowRunCleanup(
        days=dify_config.SANDBOX_EXPIRED_RECORDS_RETENTION_DAYS,
        batch_size=dify_config.SANDBOX_EXPIRED_RECORDS_CLEAN_BATCH_SIZE,
        start_from=None,
        end_before=None,
    ).run()

    end_time = datetime.now(UTC)
    elapsed = end_time - start_time
    click.echo(
        click.style(
            f"Scheduled workflow run cleanup finished. start={start_time.isoformat()} "
            f"end={end_time.isoformat()} duration={elapsed}",
            fg="green",
        )
    )
