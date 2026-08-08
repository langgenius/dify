class A2AClientError(RuntimeError):
    """Base error raised while communicating with an external A2A agent."""


class A2AProtocolError(A2AClientError):
    """Raised when an A2A server returns an invalid or unsupported payload."""


class A2ATransportError(A2AClientError):
    """Raised when an A2A HTTP request cannot be completed."""


class A2ARemoteError(A2AClientError):
    """Raised when an A2A server returns an HTTP or task-level failure."""
