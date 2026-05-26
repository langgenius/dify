# Canonical implementation has moved to services.studio.workflow_run_service
# This barrel is kept for backwards compatibility.
from services.studio.workflow_run_service import WorkflowRunListArgs, WorkflowRunService

__all__ = ['WorkflowRunListArgs', 'WorkflowRunService']
