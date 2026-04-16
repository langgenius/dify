import logging
from datetime import UTC, datetime, timedelta

import app
from configs import dify_config
from extensions.ext_database import db
from models.workflow import WorkflowRun

logger = logging.getLogger(__name__)


@app.celery.task(queue="dataset")
def reap_zombie_workflow_runs_task():
    """Force-fail workflow runs stuck in non-terminal states past their timeout."""
    now = datetime.now(UTC)
    scheduled_cutoff = now - timedelta(minutes=dify_config.ZOMBIE_WORKFLOW_SCHEDULED_TIMEOUT_MINUTES)
    running_cutoff = now - timedelta(minutes=dify_config.ZOMBIE_WORKFLOW_RUNNING_TIMEOUT_MINUTES)

    # Batch update stuck SCHEDULED rows
    scheduled_count = (
        db.session.query(WorkflowRun)
        .filter(WorkflowRun.status == "scheduled", WorkflowRun.created_at < scheduled_cutoff)
        .update({"status": "failed", "error": "Task was not picked up by worker within timeout"})
    )

    # Batch update stuck RUNNING rows
    running_count = (
        db.session.query(WorkflowRun)
        .filter(WorkflowRun.status == "running", WorkflowRun.created_at < running_cutoff)
        .update({"status": "failed", "error": "Execution timed out — worker may have crashed"})
    )

    db.session.commit()

    if scheduled_count or running_count:
        logger.warning("Reaped zombie workflow runs: %s scheduled, %s running", scheduled_count, running_count)
