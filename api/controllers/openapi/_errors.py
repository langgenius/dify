"""Canonical error contract for the /openapi/v1 surface.

``ErrorBody`` is the only wire shape an /openapi/v1 endpoint may emit for a
non-2xx response (RFC 8628 device-flow responses excepted — that shape is
mandated by the OAuth spec). ``OpenApiErrorFormatter`` is injected into
``ExternalApi`` so every error-handler path funnels through one builder, and
it also rewrites ``e.data`` because flask-restx ``Api.handle_error`` lets a
pre-existing ``e.data`` override the registered handler's return value.
"""

from enum import StrEnum

from pydantic import BaseModel


class OpenApiErrorCode(StrEnum):
    # transport-generic (resolved from HTTP status for plain werkzeug raises)
    BAD_REQUEST = "bad_request"
    UNAUTHORIZED = "unauthorized"
    FORBIDDEN = "forbidden"
    NOT_FOUND = "not_found"
    METHOD_NOT_ALLOWED = "method_not_allowed"
    NOT_ACCEPTABLE = "not_acceptable"
    CONFLICT = "conflict"
    REQUEST_TOO_LARGE = "request_entity_too_large"
    UNSUPPORTED_MEDIA_TYPE = "unsupported_media_type"
    INVALID_PARAM = "invalid_param"
    TOO_MANY_REQUESTS = "too_many_requests"
    INTERNAL_ERROR = "internal_server_error"
    BAD_GATEWAY = "bad_gateway"
    UNKNOWN = "unknown"
    # domain codes (must match the error_code attribute of the exception
    # classes raised on the openapi surface)
    APP_UNAVAILABLE = "app_unavailable"
    CONVERSATION_COMPLETED = "conversation_completed"
    PROVIDER_NOT_INITIALIZE = "provider_not_initialize"
    PROVIDER_QUOTA_EXCEEDED = "provider_quota_exceeded"
    MODEL_NOT_SUPPORTED = "model_currently_not_support"
    COMPLETION_REQUEST_ERROR = "completion_request_error"
    RATE_LIMIT_ERROR = "rate_limit_error"
    FILE_TOO_LARGE = "file_too_large"
    UNSUPPORTED_FILE_TYPE = "unsupported_file_type"
    NO_FILE_UPLOADED = "no_file_uploaded"
    TOO_MANY_FILES = "too_many_files"
    FILENAME_NOT_EXISTS = "filename_not_exists"
    FILE_EXTENSION_BLOCKED = "file_extension_blocked"
    MEMBER_LIMIT_EXCEEDED = "member_limit_exceeded"
    MEMBER_LICENSE_EXCEEDED = "member_license_exceeded"


class ErrorDetail(BaseModel):
    type: str
    loc: list[str | int] = []
    msg: str


class ErrorBody(BaseModel):
    """Canonical non-2xx body. ``code`` is typed ``str`` (not the enum) so the
    generated client schema stays an open enum — old CLIs keep parsing when a
    future server adds a code. Formatter tests pin emitted values to the enum."""

    code: str
    message: str
    status: int
    hint: str | None = None
    details: list[ErrorDetail] | None = None
