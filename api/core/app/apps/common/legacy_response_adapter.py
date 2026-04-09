"""Legacy Response Adapter for transparent upgrade.

When old apps (chat/completion/agent-chat) run through the Agent V2
workflow engine via transparent upgrade, the SSE events are in workflow
format (workflow_started, node_started, etc.). This adapter filters out
workflow-specific events and passes through only the events that old
clients expect (message, message_end, etc.).
"""

from __future__ import annotations

import json
import logging
from collections.abc import Generator
from typing import Any

logger = logging.getLogger(__name__)

WORKFLOW_ONLY_EVENTS = frozenset({
    "workflow_started",
    "workflow_finished",
    "node_started",
    "node_finished",
    "iteration_started",
    "iteration_next",
    "iteration_completed",
})


def adapt_workflow_stream_for_legacy(
    stream: Generator[str, None, None],
) -> Generator[str, None, None]:
    """Filter workflow-specific SSE events from a streaming response.

    Passes through message, message_end, agent_log, error, ping events.
    Suppresses workflow_started, workflow_finished, node_started, node_finished.

    This makes the SSE stream look more like what old easy-UI apps produce,
    while still carrying the actual LLM response content.
    """
    for chunk in stream:
        if not chunk or not chunk.strip():
            yield chunk
            continue

        try:
            if chunk.startswith("data: "):
                data = json.loads(chunk[6:])
                event = data.get("event", "")
                if event in WORKFLOW_ONLY_EVENTS:
                    continue
            yield chunk
        except (json.JSONDecodeError, TypeError):
            yield chunk
