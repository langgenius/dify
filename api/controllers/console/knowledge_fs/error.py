"""Stable, non-enumerating Console error contract for KnowledgeFS."""

from libs.exception import BaseHTTPException
from services.knowledge_fs.product_dto import KnowledgeFSPublicFailureResponse


class _KnowledgeFSFailureHTTPError(BaseHTTPException):
    def __init__(self, failure: KnowledgeFSPublicFailureResponse | None = None) -> None:
        super().__init__(failure.message if failure else None)
        if failure is not None and self.data is not None:
            self.data["failure"] = failure.model_dump(by_alias=True, exclude_none=True)


class KnowledgeFSSpaceNotFoundHTTPError(_KnowledgeFSFailureHTTPError):
    error_code = "knowledge_fs_space_not_found"
    description = "Agentic Knowledge space was not found."
    code = 404


class KnowledgeFSResourceNotFoundHTTPError(_KnowledgeFSFailureHTTPError):
    error_code = "knowledge_fs_resource_not_found"
    description = "Agentic Knowledge resource was not found."
    code = 404


class KnowledgeFSOperationUnavailableHTTPError(_KnowledgeFSFailureHTTPError):
    error_code = "knowledge_fs_operation_unavailable"
    description = "Agentic Knowledge operation is not available."
    code = 503


class KnowledgeFSUpstreamUnavailableHTTPError(_KnowledgeFSFailureHTTPError):
    error_code = "knowledge_fs_upstream_unavailable"
    description = "Agentic Knowledge is unavailable."
    code = 503


class KnowledgeFSInvalidRequestHTTPError(_KnowledgeFSFailureHTTPError):
    error_code = "knowledge_fs_invalid_request"
    description = "Agentic Knowledge request is invalid."
    code = 400


class KnowledgeFSAccessDeniedHTTPError(_KnowledgeFSFailureHTTPError):
    error_code = "knowledge_fs_access_denied"
    description = "Agentic Knowledge operation is not allowed."
    code = 403


class KnowledgeFSConflictHTTPError(_KnowledgeFSFailureHTTPError):
    error_code = "knowledge_fs_conflict"
    description = "Agentic Knowledge operation conflicts with the current resource state."
    code = 409


class KnowledgeFSRequestTooLargeHTTPError(_KnowledgeFSFailureHTTPError):
    error_code = "knowledge_fs_request_too_large"
    description = "Agentic Knowledge request is too large."
    code = 413


class KnowledgeFSRequestRejectedHTTPError(_KnowledgeFSFailureHTTPError):
    error_code = "knowledge_fs_request_rejected"
    description = "Agentic Knowledge request was rejected."
    code = 422


class KnowledgeFSRateLimitHTTPError(_KnowledgeFSFailureHTTPError):
    error_code = "knowledge_fs_rate_limit_exceeded"
    description = "Agentic Knowledge request rate limit exceeded."
    code = 429


__all__ = [
    "KnowledgeFSAccessDeniedHTTPError",
    "KnowledgeFSConflictHTTPError",
    "KnowledgeFSInvalidRequestHTTPError",
    "KnowledgeFSOperationUnavailableHTTPError",
    "KnowledgeFSRateLimitHTTPError",
    "KnowledgeFSRequestRejectedHTTPError",
    "KnowledgeFSRequestTooLargeHTTPError",
    "KnowledgeFSResourceNotFoundHTTPError",
    "KnowledgeFSSpaceNotFoundHTTPError",
    "KnowledgeFSUpstreamUnavailableHTTPError",
]
