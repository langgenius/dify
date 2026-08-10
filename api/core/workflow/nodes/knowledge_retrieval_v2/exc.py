class KnowledgeFSRetrievalV2NodeError(RuntimeError):
    """Base deterministic KnowledgeFS v2 node failure."""


class KnowledgeFSRetrievalConfigurationError(KnowledgeFSRetrievalV2NodeError):
    """The node configuration or selected query variable is invalid."""


class KnowledgeFSRetrievalBindingError(KnowledgeFSRetrievalV2NodeError):
    """The app is not authorized for one selected KnowledgeFS Space."""


class KnowledgeFSRetrievalUnavailableError(KnowledgeFSRetrievalV2NodeError):
    """KnowledgeFS could not provide a complete multi-space result."""


class KnowledgeFSRetrievalContractError(KnowledgeFSRetrievalV2NodeError):
    """KnowledgeFS returned a response outside the pinned product contract."""
