# Canonical implementation has moved to services.studio.workflow_event_snapshot_service
# This barrel is kept for backwards compatibility.
from services.studio.workflow_event_snapshot_service import MessageContext, BufferState, build_workflow_event_stream, _get_message_context, _load_resumption_context, _resolve_task_id, _build_snapshot_events, _build_workflow_started_event, _build_message_replace_event, _build_node_started_event, _build_human_input_required_events, _build_node_finished_event, _build_pause_event, _apply_message_context, _start_buffering, _parse_event_message, _is_terminal_event, _generate, _worker

__all__ = ["MessageContext",
    "BufferState",
    "build_workflow_event_stream",
    "_get_message_context",
    "_load_resumption_context",
    "_resolve_task_id",
    "_build_snapshot_events",
    "_build_workflow_started_event",
    "_build_message_replace_event",
    "_build_node_started_event",
    "_build_human_input_required_events",
    "_build_node_finished_event",
    "_build_pause_event",
    "_apply_message_context",
    "_start_buffering",
    "_parse_event_message",
    "_is_terminal_event",
    "_generate",
    "_worker"]
