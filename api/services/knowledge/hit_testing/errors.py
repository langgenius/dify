"""Framework-neutral knowledge hit-testing failures."""

from typing import Literal


class HitTestingError(Exception):
    """Base class for failures owned by the hit-testing use case."""


class HitTestingProviderError(HitTestingError):
    def __init__(
        self,
        description: str,
        *,
        kind: Literal["uninitialized", "quota", "unsupported"],
    ) -> None:
        super().__init__(description)
        self.description = description
        self.kind = kind


class HitTestingInvocationError(HitTestingError):
    pass


class HitTestingUpstreamError(HitTestingError):
    """An external knowledge provider could not complete retrieval."""


class HitTestingFailedError(HitTestingError):
    pass
