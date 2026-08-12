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
    code = 503


class KnowledgeFSInvalidRequestHTTPError(BaseHTTPException):
    error_code = "knowledge_fs_invalid_request"
    description = "KnowledgeFS request is invalid."
    code = 400


class KnowledgeFSAccessDeniedHTTPError(BaseHTTPException):
    error_code = "knowledge_fs_access_denied"
    description = "KnowledgeFS operation is not allowed."
    code = 403


__all__ = [
    "KnowledgeFSAccessDeniedHTTPError",
    "KnowledgeFSInvalidRequestHTTPError",
    "KnowledgeFSOperationUnavailableHTTPError",
    "KnowledgeFSSpaceNotFoundHTTPError",
    "KnowledgeFSUpstreamUnavailableHTTPError",
]
