class DurableStreamError(Exception):
    """Base class for errors exposed by the durable stream abstraction."""


class CursorUnavailableError(DurableStreamError):
    """The backend reported that a requested resume position is unavailable."""


class DurableStreamUnavailableError(DurableStreamError):
    """The operation could not complete according to the stream contract."""
