# Canonical implementation has moved to services.studio.workflow_app_service
# This barrel is kept for backwards compatibility.
from services.studio.workflow_app_service import LogViewDetails, LogView, WorkflowAppService

__all__ = ['LogViewDetails', 'LogView', 'WorkflowAppService']
