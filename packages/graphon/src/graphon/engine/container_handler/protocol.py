"""Protocol implemented by every container handler."""

from __future__ import annotations

from typing import Protocol

from graphon.engine_events.base import NodeEvent
from graphon.engine_events.node import NodeRunFailedEvent
from graphon.enums import NodeType
from graphon.nodes.container_effects import ContainerAwaitRequest
from graphon.runtime.container_state import ContainerFrameState

from ..frame import ExecutionFrame


class ContainerHandler(Protocol):
    node_type: NodeType

    def restore_frame(self, frame_state: ContainerFrameState) -> None: ...

    def handle_request(
        self,
        *,
        invocation_id: str,
        request: ContainerAwaitRequest,
    ) -> None:
        """Handle a request emitted by a suspended container node.

        Implementations schedule or restore the child-frame work needed before
        the container invocation can resume.
        """
        ...

    def prepare_frame_event(
        self,
        *,
        frame: ExecutionFrame,
        event: NodeEvent,
    ) -> None:
        """Prepare a child event before it is exposed outside the container.

        Variable-update events have already been applied to ``frame.state``
        when this hook runs, so handlers may inspect or propagate the resulting
        value. Implementations may also add container metadata to the event.
        """
        ...

    def should_emit(
        self,
        *,
        event: NodeEvent,
    ) -> bool:
        """Return whether a child-frame event should leave the container."""
        ...

    def record_frame_failure(
        self,
        *,
        frame: ExecutionFrame,
        event: NodeRunFailedEvent,
    ) -> None: ...

    def complete_frame_if_ready(self, frame: ExecutionFrame) -> None:
        """Finalize a child frame when its scheduler reports completion.

        The hook is called after each child-frame event and must remain a no-op
        while the frame still has unfinished nodes.
        """
        ...
