"""Failure classes a provider reports to the trace pipeline.

Messages must never contain credentials, request bodies, or vendor response
bodies: they are logged and persisted as delivery diagnostics.
"""


class TraceProviderError(Exception):
    """Base class for provider failures."""


class ExportRetryableError(TraceProviderError):
    """Nothing was accepted and the cause is transient, so sending again is safe."""


class ExportRejectedError(TraceProviderError):
    """The destination refused the trace, or the configuration cannot work. Do not retry."""


class ExportOutcomeUnknownError(TraceProviderError):
    """Part or all of the trace may have been accepted, so a retry could duplicate it."""


class VerificationError(TraceProviderError):
    """A configuration could not be verified. ``code`` is a stable, non-secret reason."""

    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


class EgressError(TraceProviderError):
    """The request failed in transport or was blocked by the egress policy.

    ``request_sent`` tells whether the destination may have received the request.
    """

    def __init__(self, message: str, *, request_sent: bool) -> None:
        self.request_sent = request_sent
        super().__init__(message)


class EgressBlockedError(EgressError):
    """The egress policy does not allow this destination. Retrying cannot help."""

    def __init__(self, message: str) -> None:
        super().__init__(message, request_sent=False)
