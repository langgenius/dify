"""Stable KnowledgeFS Service API error contract."""

from libs.exception import BaseHTTPException


class KnowledgeFSInvalidCredentialHTTPError(BaseHTTPException):
    error_code = "knowledge_fs_invalid_credential"
    description = "Invalid KnowledgeFS service credential."
    code = 401


class KnowledgeFSServiceOperationUnavailableHTTPError(BaseHTTPException):
    error_code = "knowledge_fs_operation_unavailable"
    description = "KnowledgeFS operation is not available."
    code = 503


class KnowledgeFSServiceUpstreamUnavailableHTTPError(BaseHTTPException):
    error_code = "knowledge_fs_upstream_unavailable"
    description = "KnowledgeFS is unavailable."
    code = 502


class KnowledgeFSServiceInvalidRequestHTTPError(BaseHTTPException):
    error_code = "knowledge_fs_invalid_request"
    description = "KnowledgeFS request is invalid."
    code = 400


class KnowledgeFSServiceRateLimitHTTPError(BaseHTTPException):
    error_code = "knowledge_fs_rate_limit_exceeded"
    description = "KnowledgeFS operation rate limit exceeded."
    code = 429


class KnowledgeFSServiceQuotaExceededHTTPError(BaseHTTPException):
    error_code = "knowledge_fs_quota_exceeded"
    description = "KnowledgeFS operation quota exceeded."
    code = 403


__all__ = [
    "KnowledgeFSInvalidCredentialHTTPError",
    "KnowledgeFSServiceInvalidRequestHTTPError",
    "KnowledgeFSServiceOperationUnavailableHTTPError",
    "KnowledgeFSServiceQuotaExceededHTTPError",
    "KnowledgeFSServiceRateLimitHTTPError",
    "KnowledgeFSServiceUpstreamUnavailableHTTPError",
]
