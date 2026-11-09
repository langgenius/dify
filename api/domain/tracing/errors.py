"""Business failures of trace runs; ``code`` names the reason clients and run records show."""


class TraceRunError(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


class TraceRunNotFoundError(TraceRunError):
    """The run collected nothing, or a batch names an invocation the run does not have."""


class TraceRunConflictError(TraceRunError):
    """The operation conflicts with the run's current state."""


class TraceRunLimitError(TraceRunError):
    """A runtime batch exceeds the run's collection limits."""
