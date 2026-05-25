# Canonical implementation has moved to services.studio.workflow_restore
# This barrel is kept for backwards compatibility.
from services.studio.workflow_restore import apply_published_workflow_snapshot_to_draft

__all__ = ["apply_published_workflow_snapshot_to_draft"]
