from __future__ import annotations

from typing import Any


class AgentBackendError(Exception):
    """Base error for the agent backend client contract."""


class AgentBackendContractVersionError(AgentBackendError):
    """Raised when an event or DTO uses an unsupported contract version."""


class AgentBackendEventParseError(AgentBackendError):
    """Raised when an agent backend event cannot be parsed into a typed event."""

    def __init__(self, message: str, *, raw_event: Any | None = None):
        super().__init__(message)
        self.raw_event = raw_event


class AgentBackendUnknownEventError(AgentBackendEventParseError):
    """Raised when the agent backend emits an event type unknown to this API version."""


class AgentBackendTransportError(AgentBackendError):
    """Raised for transport-level failures talking to the agent backend."""


class AgentBackendInvocationError(AgentBackendError):
    """Raised for invocation-level failures before a typed error event can be emitted."""
