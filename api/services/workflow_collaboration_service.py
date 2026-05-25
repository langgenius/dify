# Canonical implementation has moved to services.studio.workflow_collaboration_service
# This barrel is kept for backwards compatibility.
from services.studio.workflow_collaboration_service import WorkflowCollaborationService, __init__, __repr__, save_socket_identity, authorize_and_join_workflow_room, _can_access_workflow, disconnect_session, relay_collaboration_event, relay_graph_event, get_or_set_leader, handle_leader_disconnect, broadcast_leader_change, get_current_leader, _prune_inactive_sessions, broadcast_online_users, refresh_session_state, _ensure_leader, _select_graph_leader, is_session_active

__all__ = ["WorkflowCollaborationService",
    "__init__",
    "__repr__",
    "save_socket_identity",
    "authorize_and_join_workflow_room",
    "_can_access_workflow",
    "disconnect_session",
    "relay_collaboration_event",
    "relay_graph_event",
    "get_or_set_leader",
    "handle_leader_disconnect",
    "broadcast_leader_change",
    "get_current_leader",
    "_prune_inactive_sessions",
    "broadcast_online_users",
    "refresh_session_state",
    "_ensure_leader",
    "_select_graph_leader",
    "is_session_active"]
