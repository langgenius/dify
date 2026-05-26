# Canonical implementation has moved to services.studio.workflow_event_snapshot_service
# This barrel is kept for backwards compatibility.
from services.studio.workflow_event_snapshot_service import MessageContext, BufferState, build_workflow_event_stream

__all__ = ['MessageContext', 'BufferState', 'build_workflow_event_stream']
