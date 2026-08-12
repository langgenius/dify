"""Stable KnowledgeFS Service API error contract."""

from libs.exception import BaseHTTPException
from services.knowledge_fs.product_dto import KnowledgeFSPublicFailureResponse


class _KnowledgeFSServiceFailureHTTPError(BaseHTTPException):
    def __init__(self, failure: KnowledgeFSPublicFailureResponse | None = None) -> None:
        super().__init__(failure.message if failure else None)
        if failure is not None and self.data is not None:
            self.data["failure"] = failure.model_dump(by_alias=True, exclude_none=True)


class KnowledgeFSInvalidCredentialHTTPError(_KnowledgeFSServiceFailureHTTPError):
    error_code = "knowledge_fs_invalid_credential"
    description = "Invalid KnowledgeFS service credential."
    code = 401


class KnowledgeFSServiceOperationUnavailableHTTPError(_KnowledgeFSServiceFailureHTTPError):
    error_code = "knowledge_fs_operation_unavailable"
    description = "KnowledgeFS operation is not available."
    code = 503


class KnowledgeFSServiceUpstreamUnavailableHTTPError(_KnowledgeFSServiceFailureHTTPError):
    error_code = "knowledge_fs_upstream_unavailable"
    description = "KnowledgeFS is unavailable."
    code = 502


class KnowledgeFSServiceInvalidRequestHTTPError(_KnowledgeFSServiceFailureHTTPError):
    error_code = "knowledge_fs_invalid_request"
    description = "KnowledgeFS request is invalid."
    code = 400


class KnowledgeFSServiceAccessDeniedHTTPError(_KnowledgeFSServiceFailureHTTPError):
    error_code = "knowledge_fs_access_denied"
    description = "KnowledgeFS operation is not allowed."
    code = 403


class KnowledgeFSServiceResourceNotFoundHTTPError(_KnowledgeFSServiceFailureHTTPError):
    error_code = "knowledge_fs_resource_not_found"
    description = "KnowledgeFS resource was not found."
    code = 404


class KnowledgeFSServiceConflictHTTPError(_KnowledgeFSServiceFailureHTTPError):
    error_code = "knowledge_fs_conflict"
    description = "KnowledgeFS operation conflicts with the current resource state."
    code = 409


class KnowledgeFSServiceRequestTooLargeHTTPError(_KnowledgeFSServiceFailureHTTPError):
    error_code = "knowledge_fs_request_too_large"
    description = "KnowledgeFS request is too large."
    code = 413


class KnowledgeFSServiceRequestRejectedHTTPError(_KnowledgeFSServiceFailureHTTPError):
    error_code = "knowledge_fs_request_rejected"
    description = "KnowledgeFS request was rejected."
    code = 422


class KnowledgeFSServiceRateLimitHTTPError(_KnowledgeFSServiceFailureHTTPError):
    error_code = "knowledge_fs_rate_limit_exceeded"
    description = "KnowledgeFS request rate limit exceeded."
    code = 429


__all__ = [
    "KnowledgeFSInvalidCredentialHTTPError",
    "KnowledgeFSServiceAccessDeniedHTTPError",
    "KnowledgeFSServiceConflictHTTPError",
    "KnowledgeFSServiceInvalidRequestHTTPError",
    "KnowledgeFSServiceOperationUnavailableHTTPError",
    "KnowledgeFSServiceRateLimitHTTPError",
    "KnowledgeFSServiceRequestRejectedHTTPError",
    "KnowledgeFSServiceRequestTooLargeHTTPError",
    "KnowledgeFSServiceResourceNotFoundHTTPError",
    "KnowledgeFSServiceUpstreamUnavailableHTTPError",
]
