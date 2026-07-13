"""Shared exception types for shellctl server-side modules."""


class ShellctlServerError(RuntimeError):
    """Structured server-side error that maps directly to API responses."""

    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


__all__ = ["ShellctlServerError"]
