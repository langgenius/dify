import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, or_, select

import app
from configs import dify_config
from extensions.ext_database import db
from graphon.enums import WorkflowExecutionStatus
from models.workflow import WorkflowNodeExecutionModel, WorkflowRun

logger = logging.getLogger(__name__)


@app.celery.task(queue="dataset")
def reap_zombie_workflow_runs_task():
    """Force-fail workflow runs stuck in non-terminal states past their timeout.

    For SCHEDULED runs: reap if created_at exceeds the scheduled timeout
    (the Celery task was never picked up by a worker).

    For RUNNING runs: reap only if BOTH conditions are met:
      1. The run was created before the running timeout cutoff.
      2. There is no recent node execution activity (no node started or
         finished within the timeout window).  This prevents false positives
         for legitimate long-running multi-node workflows that are still
         making progress.
    """
    now = datetime.now(UTC)
    scheduled_cutoff = now - timedelta(minutes=dify_config.ZOMBIE_WORKFLOW_SCHEDULED_TIMEOUT_MINUTES)
    running_cutoff = now - timedelta(minutes=dify_config.ZOMBIE_WORKFLOW_RUNNING_TIMEOUT_MINUTES)

    # Batch update stuck SCHEDULED rows
    scheduled_count = (
        db.session.query(WorkflowRun)
        .filter(WorkflowRun.status == WorkflowExecutionStatus.SCHEDULED, WorkflowRun.created_at < scheduled_cutoff)
        .update(
            {
                "status": WorkflowExecutionStatus.FAILED,
                "error": "Task was not picked up by worker within timeout",
                "finished_at": now,
            },
            synchronize_session=False,
        )
    )

    # A RUNNING workflow is still alive if any of its nodes were started or
    # finished recently.  Only reap runs with NO recent node activity.
    has_recent_node_activity = select(WorkflowNodeExecutionModel.id).where(
        and_(
            WorkflowNodeExecutionModel.workflow_run_id == WorkflowRun.id,
            or_(
                WorkflowNodeExecutionModel.created_at >= running_cutoff,
                WorkflowNodeExecutionModel.finished_at >= running_cutoff,
            ),
        )
    ).exists()

    running_count = (
        db.session.query(WorkflowRun)
        .filter(
            WorkflowRun.status == WorkflowExecutionStatus.RUNNING,
            WorkflowRun.created_at < running_cutoff,
            ~has_recent_node_activity,
        )
        .update(
            {
                "status": WorkflowExecutionStatus.FAILED,
                "error": "Execution timed out with no recent node activity — worker may have crashed",
                "finished_at": now,
            },
            synchronize_session=False,
        )
    )

    db.session.commit()

    if scheduled_count or running_count:
        logger.warning("Reaped zombie workflow runs: %s scheduled, %s running", scheduled_count, running_count)
