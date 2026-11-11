"""Shared errors for internal and external knowledge retrieval."""

from typing import Literal

from services.errors.base import BaseServiceError


class KnowledgeRetrievalError(ValueError):
    """Base class for knowledge query failures independent of an execution surface."""


class ModelNotExistError(KnowledgeRetrievalError):
    """Raised when the retrieval planner's model does not exist."""


class ModelCredentialsNotInitializedError(KnowledgeRetrievalError):
    """Raised when the retrieval planner's model credentials are missing."""


class ModelNotSupportedError(KnowledgeRetrievalError):
    """Raised when the retrieval planner's model is not supported."""


class ModelQuotaExceededError(KnowledgeRetrievalError):
    """Raised when the retrieval planner's model provider quota is exceeded."""


class InvalidModelTypeError(KnowledgeRetrievalError):
    """Raised when the retrieval planner's model is not a language model."""


class RateLimitExceededError(KnowledgeRetrievalError):
    """Raised when the knowledge retrieval rate limit is exceeded."""


class KnowledgeRetrievalUnavailableError(KnowledgeRetrievalError):
    """Raised when the current vector target cannot serve a consistent result."""

    def __init__(self, reason: Literal["indexing", "failed"]):
        self.reason = reason
        message = (
            "Knowledge index is unavailable while indexing." if reason == "indexing" else "Knowledge indexing failed."
        )
        super().__init__(message)


class InnerKnowledgeRetrievalServiceError(BaseServiceError):
    """Base service error with a stable HTTP mapping contract."""

    error_code = "knowledge_retrieve_failed"
    status_code = 500
    default_description = "Knowledge retrieval failed."

    def __init__(self, description: str | None = None):
        self.description = description or self.default_description
        ValueError.__init__(self, self.description)


class InnerKnowledgeRetrieveAppNotFoundError(InnerKnowledgeRetrievalServiceError):
    error_code = "app_not_found"
    status_code = 404
    default_description = "App not found."


class InnerKnowledgeRetrieveAppTenantMismatchError(InnerKnowledgeRetrievalServiceError):
    error_code = "app_tenant_mismatch"
    status_code = 403
    default_description = "App does not belong to caller tenant."


class InnerKnowledgeRetrieveDatasetNotFoundError(InnerKnowledgeRetrievalServiceError):
    error_code = "dataset_not_found"
    status_code = 404
    default_description = "Dataset not found."


class InnerKnowledgeRetrieveDatasetTenantMismatchError(InnerKnowledgeRetrievalServiceError):
    error_code = "dataset_tenant_mismatch"
    status_code = 403
    default_description = "Dataset does not belong to caller tenant."


class InnerKnowledgeRetrieveRateLimitError(InnerKnowledgeRetrievalServiceError):
    error_code = "knowledge_rate_limited"
    status_code = 429


class InnerKnowledgeRetrieveExternalError(InnerKnowledgeRetrievalServiceError):
    error_code = "external_knowledge_failed"
    status_code = 502


class InnerKnowledgeRetrieveConfigError(InnerKnowledgeRetrievalServiceError):
    error_code = "retrieval_config_invalid"
    status_code = 422


class ExternalKnowledgeRetrievalError(ValueError):
    """Raised when an external dataset retrieval dependency fails.

    This stays a ``ValueError`` subclass for compatibility with existing callers
    that already treat external retrieval failures as generic retrieval errors,
    while still giving inner API controllers a dedicated error type to map to
    ``502 external_knowledge_failed``.
    """


class ExternalTemplateNotFoundError(ValueError):
    """Raised when a tenant-owned external knowledge template does not exist."""


class ExternalTemplateConcurrentUpdateError(ValueError):
    """Raised when a template secret changes while a masked update is validated."""
