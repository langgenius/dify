"""Canonical error contract for the /openapi/v1 surface.

``ErrorBody`` is the only wire shape an /openapi/v1 endpoint may emit for a
non-2xx response (RFC 8628 device-flow responses excepted — that shape is
mandated by the OAuth spec)::

    code     str                 semantic error code (OpenApiErrorCode member)
    message  str                 human-readable summary
    status   int                 HTTP status, duplicated in the body
    hint     str | None          actionable next step for the caller
    details  list[ErrorDetail]   per-field validation breakdown {type, loc, msg}

``OpenApiErrorFormatter`` is injected into ``ExternalApi`` so every
error-handler path funnels through one builder, and it also rewrites
``e.data`` because flask-restx ``Api.handle_error`` lets a pre-existing
``e.data`` override the registered handler's return value.

The transport-generic enum members, ``_CODE_BY_STATUS`` and the
``OpenApiError``/``OpenApiErrorFormatter`` bases are openapi-only today;
promote them to ``libs`` if a second surface adopts ``ErrorBody``.
"""

import logging
from enum import StrEnum
from typing import Any

from pydantic import BaseModel
from werkzeug.exceptions import HTTPException

from libs.external_api import http_status_message


class OpenApiErrorCode(StrEnum):
    # transport-generic (resolved from HTTP status for plain werkzeug raises)
    BAD_REQUEST = "bad_request"
    UNAUTHORIZED = "unauthorized"
    TOKEN_EXPIRED = "token_expired"
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
    HUMAN_INPUT_FORM_NOT_FOUND = "form_not_found"
    RECIPIENT_SURFACE_MISMATCH = "recipient_surface_mismatch"


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


_CODE_BY_STATUS: dict[int, OpenApiErrorCode] = {
    400: OpenApiErrorCode.BAD_REQUEST,
    401: OpenApiErrorCode.UNAUTHORIZED,
    403: OpenApiErrorCode.FORBIDDEN,
    404: OpenApiErrorCode.NOT_FOUND,
    405: OpenApiErrorCode.METHOD_NOT_ALLOWED,
    406: OpenApiErrorCode.NOT_ACCEPTABLE,
    409: OpenApiErrorCode.CONFLICT,
    413: OpenApiErrorCode.REQUEST_TOO_LARGE,
    415: OpenApiErrorCode.UNSUPPORTED_MEDIA_TYPE,
    422: OpenApiErrorCode.INVALID_PARAM,
    429: OpenApiErrorCode.TOO_MANY_REQUESTS,
    500: OpenApiErrorCode.INTERNAL_ERROR,
    502: OpenApiErrorCode.BAD_GATEWAY,
}

_GENERIC_500_MESSAGE = "Internal Server Error"

logger = logging.getLogger(__name__)


class OpenApiError(HTTPException):
    """Dedicated throwable for the /openapi/v1 surface.

    A subclass declares ``code`` (HTTP status), ``error_code`` and
    ``description`` exactly once; call sites just ``raise SomeError()`` —
    no per-site dict building, no duplicated message constants. The
    formatter emits all three (plus optional ``hint``/``details``) verbatim.
    """

    code = 400
    error_code: OpenApiErrorCode = OpenApiErrorCode.UNKNOWN
    hint: str | None = None

    def __init__(
        self,
        message: str | None = None,
        *,
        hint: str | None = None,
        details: list[ErrorDetail] | None = None,
    ) -> None:
        super().__init__(description=message)
        if hint is not None:
            self.hint = hint
        self.details = details


class OpenApiErrorFormatter:
    """Builds the canonical ErrorBody from whatever the shared handlers computed.

    Resolution order for ``code``: explicit ``error_code`` class attribute
    (BaseHTTPException subclasses and OpenApiError subclasses) → HTTP status
    map → ``unknown``. Class-name-derived codes from the shared handler are
    deliberately ignored — they are not a stable contract.
    """

    def finalize(self, e: Exception, data: dict[str, Any], status_code: int) -> dict[str, Any]:
        exc_data = getattr(e, "data", None)
        merged: dict[str, Any] = {**data, **exc_data} if isinstance(exc_data, dict) else dict(data)

        # finalize runs inside the framework error handler: raising here would
        # replace the response with an unformatted 500, so fall back instead
        try:
            body = ErrorBody(
                code=self._resolve_code(e, status_code),
                message=self._resolve_message(merged, status_code),
                status=status_code,
                hint=self._resolve_hint(e),
                details=self._extract_details(e, merged),
            )
            wire = body.model_dump(mode="json", exclude_none=True)
        except Exception:
            logger.exception("error-body build failed; emitting fallback body")
            wire = {
                "code": str(_CODE_BY_STATUS.get(status_code, OpenApiErrorCode.UNKNOWN)),
                "message": http_status_message(status_code) or "request failed",
                "status": status_code,
            }

        # flask-restx Api.handle_error does `data = getattr(e, "data", default_data)`
        # AFTER our handler returns, so a pre-existing e.data (flask_restx.abort,
        # BaseHTTPException) would override the canonical body. Rewrite it.
        try:
            e.data = wire  # type: ignore[attr-defined]
        except AttributeError:
            pass
        return wire

    def _resolve_code(self, e: Exception, status_code: int) -> str:
        explicit = getattr(type(e), "error_code", None)
        if isinstance(explicit, (OpenApiErrorCode, str)) and str(explicit) != "unknown":
            return str(explicit)
        return str(_CODE_BY_STATUS.get(status_code, OpenApiErrorCode.UNKNOWN))

    def _resolve_message(self, merged: dict[str, Any], status_code: int) -> str:
        if status_code >= 500:
            return _GENERIC_500_MESSAGE
        message = merged.get("message")
        if isinstance(message, str) and message:
            return message
        return http_status_message(status_code) or "request failed"

    def _resolve_hint(self, e: Exception) -> str | None:
        hint = getattr(e, "hint", None)
        return hint if isinstance(hint, str) and hint else None

    def _extract_details(self, e: Exception, merged: dict[str, Any]) -> list[ErrorDetail] | None:
        explicit = getattr(e, "details", None)
        if isinstance(explicit, list) and explicit and all(isinstance(d, ErrorDetail) for d in explicit):
            return explicit
        # an already-canonical body (e.g. e.data rewritten by a prior finalize)
        # carries "details"; re-validate so finalize stays idempotent
        canonical = merged.get("details")
        if isinstance(canonical, list) and canonical and all(isinstance(d, dict) for d in canonical):
            return [ErrorDetail.model_validate(d) for d in canonical]
        errors = merged.get("errors")
        if isinstance(errors, list) and errors:
            details = [
                ErrorDetail(
                    type=str(item.get("type", "invalid")),
                    loc=[part for part in item.get("loc", []) if self._is_loc_part(part)],
                    msg=str(item.get("msg", "")),
                )
                for item in errors
                if isinstance(item, dict)
            ]
            return details or None
        params = merged.get("params")
        if isinstance(params, str) and params:
            return [ErrorDetail(type="invalid", loc=[params], msg=str(merged.get("message", "")))]
        return None

    @staticmethod
    def _is_loc_part(part: Any) -> bool:
        # bool is an int subclass but is not a valid path segment
        return isinstance(part, (str, int)) and not isinstance(part, bool)


class InvalidBearer(OpenApiError):  # noqa: N818
    code = 401
    error_code = OpenApiErrorCode.UNAUTHORIZED
    description = "Invalid or unknown bearer token."


class SessionExpired(OpenApiError):  # noqa: N818
    code = 401
    error_code = OpenApiErrorCode.TOKEN_EXPIRED
    description = "Your session has expired."
    hint = "Re-authenticate to continue (e.g. re-run your login command)."


class FilenameNotExists(OpenApiError):  # noqa: N818
    code = 400
    error_code = OpenApiErrorCode.FILENAME_NOT_EXISTS
    description = "The specified filename does not exist."


class MemberLimitExceeded(OpenApiError):  # noqa: N818
    code = 403
    error_code = OpenApiErrorCode.MEMBER_LIMIT_EXCEEDED
    description = "Subscription member limit reached."
    hint = "Upgrade your plan to invite more members or remove an existing member first."


class MemberLicenseExceeded(OpenApiError):  # noqa: N818
    code = 403
    error_code = OpenApiErrorCode.MEMBER_LICENSE_EXCEEDED
    description = "Workspace member license capacity reached."
    hint = "Contact your workspace administrator to expand the license seat count."


class HumanInputFormNotFound(OpenApiError):  # noqa: N818
    code = 404
    error_code = OpenApiErrorCode.HUMAN_INPUT_FORM_NOT_FOUND
    description = "No human-input form matches this token. It may be wrong, expired, or already submitted."


class RecipientSurfaceMismatch(OpenApiError):  # noqa: N818
    code = 403
    error_code = OpenApiErrorCode.RECIPIENT_SURFACE_MISMATCH
    description = "This form's recipient can't be submitted via the OpenAPI surface."
    hint = "Action it through its channel (web app or console)."
