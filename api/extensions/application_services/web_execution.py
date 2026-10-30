"""Application-owned Web workflow admission hooks for legacy execution callers."""

from services.web_workflow_admission import web_workflow_launch, web_workflow_worker

__all__ = ["web_workflow_launch", "web_workflow_worker"]
