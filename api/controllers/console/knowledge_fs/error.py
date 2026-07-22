"""Stable, non-enumerating Console error contract for KnowledgeFS."""

from libs.exception import BaseHTTPException


class KnowledgeFSSpaceNotFoundHTTPError(BaseHTTPException):
    error_code = "knowledge_fs_space_not_found"
    description = "KnowledgeFS space was not found."
    code = 404


class KnowledgeFSOperationUnavailableHTTPError(BaseHTTPException):
    error_code = "knowledge_fs_operation_unavailable"
    description = "KnowledgeFS operation is not available."
    code = 503


class KnowledgeFSUpstreamUnavailableHTTPError(BaseHTTPException):
    error_code = "knowledge_fs_upstream_unavailable"
    description = "KnowledgeFS is unavailable."
    code = 502


class KnowledgeFSInvalidRequestHTTPError(BaseHTTPException):
    error_code = "knowledge_fs_invalid_request"
    description = "KnowledgeFS request is invalid."
    code = 400


class KnowledgeFSAccessDeniedHTTPError(BaseHTTPException):
    error_code = "knowledge_fs_access_denied"
    description = "KnowledgeFS operation is not allowed."
    code = 403


class KnowledgeFSRateLimitHTTPError(BaseHTTPException):
    error_code = "knowledge_fs_rate_limit_exceeded"
    description = "KnowledgeFS operation rate limit exceeded."
    code = 429


class KnowledgeFSQuotaExceededHTTPError(BaseHTTPException):
    error_code = "knowledge_fs_quota_exceeded"
    description = "KnowledgeFS operation quota exceeded."
    code = 403


__all__ = [
    "KnowledgeFSAccessDeniedHTTPError",
    "KnowledgeFSInvalidRequestHTTPError",
    "KnowledgeFSOperationUnavailableHTTPError",
    "KnowledgeFSQuotaExceededHTTPError",
    "KnowledgeFSRateLimitHTTPError",
    "KnowledgeFSSpaceNotFoundHTTPError",
    "KnowledgeFSUpstreamUnavailableHTTPError",
]
