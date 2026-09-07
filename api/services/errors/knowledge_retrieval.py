"""Service errors for the inner knowledge retrieval API."""

from services.errors.base import BaseServiceError


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


class ExternalKnowledgeRetrievalError(ValueError):
    """Raised when an external dataset retrieval dependency fails.

    This stays a ``ValueError`` subclass for compatibility with existing callers
    that already treat external retrieval failures as generic retrieval errors,
    while still giving inner API controllers a dedicated error type to map to
    ``502 external_knowledge_failed``.
    """
