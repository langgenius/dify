class KnowledgeIndexNodeError(ValueError):
    """Base class for KnowledgeIndexNode errors."""


class ModelNotExistError(KnowledgeIndexNodeError):
    """Raised when the model does not exist."""


class ModelCredentialsNotInitializedError(KnowledgeIndexNodeError):
    """Raised when the model credentials are not initialized."""


class ModelNotSupportedError(KnowledgeIndexNodeError):
    """Raised when the model is not supported."""


class ModelQuotaExceededError(KnowledgeIndexNodeError):
    """Raised when the model provider quota is exceeded."""


class InvalidModelTypeError(KnowledgeIndexNodeError):
    """Raised when the model is not a Large Language Model."""
