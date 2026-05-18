from __future__ import annotations

from collections.abc import Iterator
from typing import Protocol

from clients.agent_backend.events import AgentBackendEvent
from clients.agent_backend.lifecycle import (
    AgentBackendInvokeRequest,
    AgentBackendLifecycleAck,
    AgentBackendLifecycleRequest,
)


class AgentBackendClient(Protocol):
    def invoke(self, request: AgentBackendInvokeRequest) -> Iterator[AgentBackendEvent]:
        """Invoke agent backend and stream typed events."""

    def send_lifecycle(self, request: AgentBackendLifecycleRequest) -> AgentBackendLifecycleAck:
        """Send an out-of-band lifecycle signal."""
