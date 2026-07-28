"""Read the public timing of a logical workflow run across worker segments."""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.workflow import WorkflowRun


@dataclass(frozen=True, slots=True)
class WorkflowRunPublicTiming:
    """Wall-clock start and accumulated maintenance wait for API responses."""

    started_at: datetime
    handoff_duration: float


def get_workflow_run_public_timing(
    *,
    session: Session,
    workflow_run_id: str,
    tenant_id: str,
    app_id: str,
    workflow_id: str,
) -> WorkflowRunPublicTiming | None:
    """Return timing only when the complete workflow owner chain matches."""
    workflow_run = session.scalar(
        select(WorkflowRun).where(
            WorkflowRun.id == workflow_run_id,
            WorkflowRun.tenant_id == tenant_id,
            WorkflowRun.app_id == app_id,
            WorkflowRun.workflow_id == workflow_id,
        )
    )
    if workflow_run is None:
        return None
    return WorkflowRunPublicTiming(
        started_at=workflow_run.created_at,
        handoff_duration=max(float(getattr(workflow_run, "handoff_duration", 0.0) or 0.0), 0.0),
    )


__all__ = ["WorkflowRunPublicTiming", "get_workflow_run_public_timing"]
