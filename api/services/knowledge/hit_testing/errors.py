"""Framework-neutral knowledge hit-testing failures."""

from enums.knowledge import KnowledgeProviderFailure


class HitTestingError(Exception):
    """Base class for failures owned by the hit-testing use case."""


class HitTestingProviderError(HitTestingError):
    def __init__(
        self,
        description: str,
        *,
        kind: KnowledgeProviderFailure,
    ) -> None:
        super().__init__(description)
        self.description = description
        self.kind = kind


class HitTestingInvocationError(HitTestingError):
    pass


class HitTestingUnsupportedInputError(HitTestingError):
    """The requested retrieval input is valid generally but unsupported by this dataset provider."""


class HitTestingUpstreamError(HitTestingError):
    """An external knowledge provider could not complete retrieval."""


class HitTestingFailedError(HitTestingError):
    pass
