"""Retryable identity contention during Guest migration."""


class EndUserBusyError(RuntimeError):
    def __init__(self) -> None:
        super().__init__("This Web App identity is being updated. Please retry.")
