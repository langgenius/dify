"""Transport-neutral application errors for IM Contact synchronization."""


class IMWriteUnavailableError(RuntimeError):
    """An Organization-scoped write could not safely acquire or retain serialization."""


__all__ = ["IMWriteUnavailableError"]
