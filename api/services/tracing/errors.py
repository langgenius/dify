"""Failures of the trace pipeline and of Agent trace collection.

Errors name what went wrong inside the tracing slice. They carry no protocol
status: handlers choose the response for each type.
"""


class TracingError(Exception):
    """Base error of the tracing slice."""


class SourceNotFoundError(TracingError):
    """The referenced record does not exist for the event's tenant and app."""


class SourceNotReadyError(TracingError):
    """The referenced record is not persisted or not finished yet."""


class TraceCollectorUnavailableError(TracingError):
    """The Agent trace collector could not decide ownership; the event must be redelivered."""


class UnknownTraceProviderError(TracingError):
    def __init__(self, provider_id: str) -> None:
        super().__init__(f"Unknown tracing provider: {provider_id}")


class TraceProviderUnavailableError(TracingError):
    def __init__(self, provider_id: str) -> None:
        super().__init__(f"Tracing provider {provider_id} is not installed in this deployment")


class ProviderConfigUnreadableError(TracingError):
    """A stored configuration cannot be decrypted or no longer validates."""


class TracingStoreUnavailableError(TracingError):
    """The trace ledger or a business record could not be read or written; a later attempt may succeed."""


class TraceCollectionError(TracingError):
    """Agent trace collection cannot proceed; ``code`` names the reason for clients and run records."""

    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


class TraceCollectionNotFoundError(TraceCollectionError):
    """The source, run, invocation, or owner does not exist in the caller's scope."""


class TraceCollectionConflictError(TraceCollectionError):
    """The request conflicts with the current state of the collected run."""


class TraceCollectionLimitError(TraceCollectionError):
    """A runtime batch exceeds the run's collection limits."""
