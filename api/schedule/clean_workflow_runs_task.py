import click

import app
from configs import dify_config
from services.clear_free_plan_expired_workflow_run_logs import WorkflowRunCleanup


@app.celery.task(queue="retention")
def clean_workflow_runs_task() -> None:
    """
    Scheduled cleanup for workflow runs and related records (sandbox tenants only).
    """
    click.echo(
        click.style(
            f"Scheduled workflow run cleanup starting: cutoff={dify_config.WORKFLOW_LOG_RETENTION_DAYS} days, "
            f"batch={dify_config.WORKFLOW_LOG_CLEANUP_BATCH_SIZE}",
            fg="green",
        )
    )

    WorkflowRunCleanup(
        days=dify_config.WORKFLOW_LOG_RETENTION_DAYS,
        batch_size=dify_config.WORKFLOW_LOG_CLEANUP_BATCH_SIZE,
        start_after=None,
        end_before=None,
    ).run()

    click.echo(click.style("Scheduled workflow run cleanup finished.", fg="green"))
