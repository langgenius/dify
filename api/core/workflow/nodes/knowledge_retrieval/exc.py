class KnowledgeRetrievalNodeError(ValueError):
    """Base class for KnowledgeRetrievalNode errors."""


class ModelNotExistError(KnowledgeRetrievalNodeError):
    """Raised when the model does not exist."""


class ModelCredentialsNotInitializedError(KnowledgeRetrievalNodeError):
    """Raised when the model credentials are not initialized."""


class ModelNotSupportedError(KnowledgeRetrievalNodeError):
    """Raised when the model is not supported."""


class ModelQuotaExceededError(KnowledgeRetrievalNodeError):
    """Raised when the model provider quota is exceeded."""


class InvalidModelTypeError(KnowledgeRetrievalNodeError):
    """Raised when the model is not a Large Language Model."""
