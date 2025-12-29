from datetime import UTC, datetime

import click

import app
from configs import dify_config
from services.retention.archive_paid_plan_workflow_run import WorkflowRunArchiver


@app.celery.task(queue="retention")
def archive_workflow_runs_task() -> None:
    """
    Scheduled archiving for paid-plan workflow runs.
    """
    tenant_ids = [
        tid.strip() for tid in dify_config.PAID_PLAN_WORKFLOW_RUN_ARCHIVE_TENANT_IDS.split(",") if tid and tid.strip()
    ]
    click.echo(
        click.style(
            (
                "Scheduled workflow run archiving starting: "
                f"cutoff={dify_config.PAID_PLAN_WORKFLOW_RUN_ARCHIVE_RETENTION_DAYS} days, "
                f"batch={dify_config.PAID_PLAN_WORKFLOW_RUN_ARCHIVE_BATCH_SIZE}, "
                f"tenant_ids={','.join(tenant_ids) if tenant_ids else 'all'}"
            ),
            fg="green",
        )
    )

    start_time = datetime.now(UTC)

    archiver = WorkflowRunArchiver(
        days=dify_config.PAID_PLAN_WORKFLOW_RUN_ARCHIVE_RETENTION_DAYS,
        batch_size=dify_config.PAID_PLAN_WORKFLOW_RUN_ARCHIVE_BATCH_SIZE,
        tenant_ids=tenant_ids or None,
        limit=None,
        dry_run=False,
    )
    archiver.run()

    end_time = datetime.now(UTC)
    elapsed = end_time - start_time
    click.echo(
        click.style(
            f"Scheduled workflow run archiving finished. start={start_time.isoformat()} "
            f"end={end_time.isoformat()} duration={elapsed}",
            fg="green",
        )
    )
