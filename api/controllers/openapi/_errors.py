"""Canonical error contract for the /openapi/v1 surface.

``ErrorBody`` is the wire shape an /openapi/v1 endpoint emits for a non-2xx
response, with two exceptions: RFC 8628 device-flow responses (that shape is
mandated by the OAuth spec), and a failed DSL import or import confirm, which
answers 400 with the ``Import`` body (``status: failed`` and ``error``), as the
console does::

    code     str                 semantic error code (OpenApiErrorCode member)
    message  str                 human-readable summary
    status   int                 HTTP status, duplicated in the body
    hint     str | None          actionable next step for the caller
    hints    list[Hint] | None   ops the caller can run next, with ready input
    details  list[ErrorDetail]   per-field validation breakdown {type, loc, msg}

``OpenApiErrorFormatter`` is injected into ``ExternalApi`` so every
error-handler path funnels through one builder, and it also rewrites
``e.data`` because flask-restx ``Api.handle_error`` lets a pre-existing
``e.data`` override the registered handler's return value.

The transport-generic enum members, ``_CODE_BY_STATUS`` and the
``OpenApiError``/``OpenApiErrorFormatter`` bases are openapi-only today;
promote them to ``libs`` if a second surface adopts ``ErrorBody``.
"""

import contextlib
import logging
from enum import StrEnum
from typing import Any

from pydantic import BaseModel
from werkzeug.exceptions import HTTPException

from controllers.openapi._models import Hint
from libs.external_api import http_status_message


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
    AGENT_NOT_PUBLISHED = "agent_not_published"
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
    CATALOG_STALE = "catalog_stale"
    TRIGGER_WORKFLOW_SERVICE_MODE_UNAVAILABLE = "trigger_workflow_service_mode_unavailable"
    RUN_NOT_FOUND = "run_not_found"
    VERSION_NOT_FOUND = "version_not_found"
    VERSION_NOT_RESTORABLE = "version_not_restorable"
    DRAFT_NOT_FOUND = "draft_not_found"
    ENV_VARIABLE_NOT_FOUND = "env_variable_not_found"
    SECRET_MASK_UNKNOWN_ID = "secret_mask_unknown_id"
    WEBAPP_ACCESS_REQUIRES_EE = "webapp_access_requires_ee"
    WEBAPP_ACCESS_UNAVAILABLE = "webapp_access_unavailable"
    NODE_TYPE_NOT_FOUND = "node_type_not_found"
    NODE_NOT_FOUND = "node_not_found"
    WEBAPP_ACCESS_MODE_CONSOLE_ONLY = "webapp_access_mode_console_only"
    WEBAPP_PUBLIC_ACCESS_DISABLED = "webapp_public_access_disabled"
    SECRET_MASK_NOT_SECRET = "secret_mask_not_secret"
    MARKETPLACE_DISABLED = "marketplace_disabled"
    MARKETPLACE_UNAVAILABLE = "marketplace_unavailable"
    PLUGIN_INSTALL_FORBIDDEN = "plugin_install_forbidden"
    PLUGIN_NOT_INSTALLED = "plugin_not_installed"
    PROVIDER_NOT_FOUND = "provider_not_found"
    CREDENTIAL_INVALID = "credential_invalid"
    CREDENTIAL_OAUTH_ONLY = "credential_oauth_only"
    CREDENTIAL_NOT_FOUND = "credential_not_found"
    PLUGIN_SERVICE_UNAVAILABLE = "plugin_service_unavailable"
    DSL_INVALID = "dsl_invalid"
    DRAFT_CHANGED = "draft_changed"
    APP_MODE_MISMATCH = "app_mode_mismatch"
    SERVICE_API_DISABLED = "service_api_disabled"
    SERVICE_UNAVAILABLE = "service_unavailable"
    BEARER_AUTH_DISABLED = "bearer_auth_disabled"
    LICENSE_INVALID = "license_invalid"
    INSUFFICIENT_SCOPE = "insufficient_scope"
    UNSUPPORTED_TOKEN_TYPE = "unsupported_token_type"
    APP_QUOTA_EXCEEDED = "app_quota_exceeded"
    INSUFFICIENT_WORKSPACE_ROLE = "insufficient_workspace_role"
    WORKSPACE_UNAVAILABLE = "workspace_unavailable"
    WORKSPACE_MISMATCH = "workspace_mismatch"
    EXTERNAL_SSO_REQUIRES_EE = "external_sso_requires_ee"
    ACCESS_MODE_NOT_ALLOWED = "subject_not_allowed_for_access_mode"
    APP_ACCESS_MODE_UNAVAILABLE = "app_access_mode_unavailable"
    PRIVATE_APP_NOT_ALLOWED = "user_not_allowed_for_private_app"
    PRIVATE_APP_USER_UNRESOLVED = "private_app_user_unresolved"
    RESOURCE_NOT_AUTHORIZED = "resource_not_authorized"
    PERMITTED_APPS_UNAVAILABLE = "permitted_apps_unavailable"


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
    hints: list[Hint] | None = None
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
    503: OpenApiErrorCode.SERVICE_UNAVAILABLE,
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
    hints: list[Hint] | None = None

    def __init__(
        self,
        message: str | None = None,
        *,
        hint: str | None = None,
        hints: list[Hint] | None = None,
        details: list[ErrorDetail] | None = None,
    ) -> None:
        super().__init__(description=message)
        if hint is not None:
            self.hint = hint
        if hints is not None:
            self.hints = hints
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
                message=self._resolve_message(e, merged, status_code),
                status=status_code,
                hint=self._resolve_hint(e),
                hints=e.hints if isinstance(e, OpenApiError) else None,
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
        with contextlib.suppress(AttributeError):
            e.data = wire  # type: ignore[attr-defined]
        return wire

    def _resolve_code(self, e: Exception, status_code: int) -> str:
        explicit = getattr(type(e), "error_code", None)
        return self.code_for(status_code, str(explicit) if isinstance(explicit, str) else None)

    @staticmethod
    def code_for(status_code: int, error_code: str | None) -> str:
        """The wire ``code`` for an exception class's ``error_code`` (if any) at this status."""
        if error_code is not None and error_code != "unknown":
            return error_code
        return str(_CODE_BY_STATUS.get(status_code, OpenApiErrorCode.UNKNOWN))

    def _resolve_message(self, e: Exception, merged: dict[str, Any], status_code: int) -> str:
        if status_code >= 500 and not isinstance(e, OpenApiError):
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


class CatalogStale(OpenApiError):  # noqa: N818
    code = 412
    error_code = OpenApiErrorCode.CATALOG_STALE
    description = "The request was built from a catalog that is not this server's current catalog."
    hint = "GET /openapi/v1/_catalog, rebuild the request from it, and send its sha256 in X-Dify-Catalog."


class InvalidFilePart(OpenApiError):  # noqa: N818
    code = 422
    error_code = OpenApiErrorCode.INVALID_PARAM
    description = "A request part could not be used"


class RunNotFound(OpenApiError):  # noqa: N818
    code = 404
    error_code = OpenApiErrorCode.RUN_NOT_FOUND
    description = "No run with this id exists for this app."


class VersionNotFound(OpenApiError):  # noqa: N818
    code = 404
    error_code = OpenApiErrorCode.VERSION_NOT_FOUND
    description = "No version with this id exists for this app."


class WebAppAccessRequiresEE(OpenApiError):  # noqa: N818
    code = 403
    error_code = OpenApiErrorCode.WEBAPP_ACCESS_REQUIRES_EE
    description = "Web-app access control needs Dify Enterprise with web-app sign-in turned on."


class WebAppAccessUnavailable(OpenApiError):  # noqa: N818
    code = 503
    error_code = OpenApiErrorCode.WEBAPP_ACCESS_UNAVAILABLE
    description = "Web-app access could not be read or changed."
    hint = "Enterprise is unreachable or did not answer."


class NodeTypeNotFound(OpenApiError):  # noqa: N818
    code = 404
    error_code = OpenApiErrorCode.NODE_TYPE_NOT_FOUND
    description = "No node type with this name exists on this server."
    hint = "List the node types with get.node_type."


class NodeNotFound(OpenApiError):  # noqa: N818
    code = 404
    error_code = OpenApiErrorCode.NODE_NOT_FOUND
    description = "The draft has no node with this id."


class WebAppAccessModeConsoleOnly(OpenApiError):  # noqa: N818
    code = 400
    error_code = OpenApiErrorCode.WEBAPP_ACCESS_MODE_CONSOLE_ONLY
    description = "Member lists for access_mode private must be chosen in the Dify console."
    hint = "Use public, private_all or sso_verified here."


class WebAppPublicAccessDisabled(OpenApiError):  # noqa: N818
    code = 403
    error_code = OpenApiErrorCode.WEBAPP_PUBLIC_ACCESS_DISABLED
    description = "This server does not allow web apps with access_mode public."
    hint = "Use private_all or sso_verified."


class VersionNotRestorable(OpenApiError):  # noqa: N818
    code = 400
    error_code = OpenApiErrorCode.VERSION_NOT_RESTORABLE
    description = "Only a published version can be restored."


class DraftNotFound(OpenApiError):  # noqa: N818
    code = 404
    error_code = OpenApiErrorCode.DRAFT_NOT_FOUND
    description = "This app has no draft."


class EnvVariableNotFound(OpenApiError):  # noqa: N818
    code = 404
    error_code = OpenApiErrorCode.ENV_VARIABLE_NOT_FOUND
    description = "The draft has no environment variable with this id."


class SecretMaskUnknownId(OpenApiError):  # noqa: N818
    code = 400
    error_code = OpenApiErrorCode.SECRET_MASK_UNKNOWN_ID
    description = "The value is the masked secret placeholder, but env_id is not an existing secret."


class SecretMaskNotSecret(OpenApiError):  # noqa: N818
    code = 400
    error_code = OpenApiErrorCode.SECRET_MASK_NOT_SECRET
    description = "The value is the masked secret placeholder, which only a secret value_type can keep."


class MarketplaceDisabled(OpenApiError):  # noqa: N818
    code = 503
    error_code = OpenApiErrorCode.MARKETPLACE_DISABLED
    description = "Marketplace is disabled on this server."
    hint = "Ask an admin to install the plugin."


class MarketplaceUnavailable(OpenApiError):  # noqa: N818
    code = 503
    error_code = OpenApiErrorCode.MARKETPLACE_UNAVAILABLE
    description = "The marketplace did not answer."


class PluginInstallForbidden(OpenApiError):  # noqa: N818
    code = 403
    error_code = OpenApiErrorCode.PLUGIN_INSTALL_FORBIDDEN
    description = "Plugin install is not allowed here."


class PluginNotInstalled(OpenApiError):  # noqa: N818
    code = 404
    error_code = OpenApiErrorCode.PLUGIN_NOT_INSTALLED
    description = "This plugin is not installed in the workspace."
    hint = "List installed plugins with get.plugin."


class ProviderNotFound(OpenApiError):  # noqa: N818
    code = 404
    error_code = OpenApiErrorCode.PROVIDER_NOT_FOUND
    description = "No provider with this id in the workspace."
    hint = "Provider ids look like langgenius/openai/openai; get.plugin shows them under provides."


class CredentialInvalid(OpenApiError):  # noqa: N818
    code = 422
    error_code = OpenApiErrorCode.CREDENTIAL_INVALID
    description = "The provider rejected these credentials; nothing was saved."


class CredentialOAuthOnly(OpenApiError):  # noqa: N818
    code = 400
    error_code = OpenApiErrorCode.CREDENTIAL_OAUTH_ONLY
    description = "This provider uses OAuth."
    hint = "Ask the user to authorize it in the console."


class CredentialNotFound(OpenApiError):  # noqa: N818
    code = 404
    error_code = OpenApiErrorCode.CREDENTIAL_NOT_FOUND
    description = "No credential with this id for this provider that you can see."
    hint = "List them with the describe op of the provider."


class PluginServiceUnavailable(OpenApiError):  # noqa: N818
    code = 503
    error_code = OpenApiErrorCode.PLUGIN_SERVICE_UNAVAILABLE
    description = "Plugin service is unavailable."


class DslInvalid(OpenApiError):  # noqa: N818
    code = 422
    error_code = OpenApiErrorCode.DSL_INVALID
    description = "The DSL has problems the import refuses; each is in details with its location"


class DraftChanged(OpenApiError):  # noqa: N818
    code = 409
    error_code = OpenApiErrorCode.DRAFT_CHANGED
    description = "The draft changed after it was exported. Export it again and reapply your edits."


class AppModeMismatch(OpenApiError):  # noqa: N818
    code = 422
    error_code = OpenApiErrorCode.APP_MODE_MISMATCH
    description = "This op does not serve apps of this mode."
    hint = "describe.console_app shows the app's mode."


class ServiceApiDisabled(OpenApiError):  # noqa: N818
    code = 403
    error_code = OpenApiErrorCode.SERVICE_API_DISABLED
    description = "This app's Service API is turned off."
    hint = "A workspace admin can turn it on."


class BearerAuthDisabled(OpenApiError):  # noqa: N818
    code = 503
    error_code = OpenApiErrorCode.BEARER_AUTH_DISABLED
    description = "Sign-in with access tokens is turned off on this server."
    hint = "Ask an admin to set ENABLE_OAUTH_BEARER=true and restart the API."


class LicenseInvalid(OpenApiError):  # noqa: N818
    code = 403
    error_code = OpenApiErrorCode.LICENSE_INVALID
    description = "This Dify server's license is not active."
    hint = "Ask an admin to renew or reactivate the license."


class InsufficientScope(OpenApiError):  # noqa: N818
    code = 403
    error_code = OpenApiErrorCode.INSUFFICIENT_SCOPE
    description = "This token's scopes don't allow this operation."


class UnsupportedTokenType(OpenApiError):  # noqa: N818
    code = 403
    error_code = OpenApiErrorCode.UNSUPPORTED_TOKEN_TYPE
    description = "This kind of token can't call this operation."
    hint = "Sign in with a Dify account for this operation."


class AppQuotaExceeded(OpenApiError):  # noqa: N818
    code = 403
    error_code = OpenApiErrorCode.APP_QUOTA_EXCEEDED
    description = "This workspace has reached its app limit."
    hint = "Upgrade the plan, or delete an app first."


class InsufficientWorkspaceRole(OpenApiError):  # noqa: N818
    code = 403
    error_code = OpenApiErrorCode.INSUFFICIENT_WORKSPACE_ROLE
    description = "Your workspace role can't do this."


class WorkspaceUnavailable(OpenApiError):  # noqa: N818
    code = 403
    error_code = OpenApiErrorCode.WORKSPACE_UNAVAILABLE
    description = "The workspace of this app or token is archived or no longer exists."
    hint = "Ask an admin to restore the workspace."


class WorkspaceMismatch(OpenApiError):  # noqa: N818
    code = 403
    error_code = OpenApiErrorCode.WORKSPACE_MISMATCH
    description = "This token belongs to a different workspace than the one in the request."
    hint = "get.workspace shows the workspace this token belongs to."


class ExternalSsoRequiresEE(OpenApiError):  # noqa: N818
    code = 403
    error_code = OpenApiErrorCode.EXTERNAL_SSO_REQUIRES_EE
    description = "SSO tokens work only on Dify Enterprise."
    hint = "Sign in with a Dify account instead."


class AccessModeNotAllowed(OpenApiError):  # noqa: N818
    code = 403
    error_code = OpenApiErrorCode.ACCESS_MODE_NOT_ALLOWED
    description = "This app's web-app access setting doesn't allow this kind of sign-in."
    hint = "Ask the app's owner to change its web-app access."


class AppAccessModeUnavailable(OpenApiError):  # noqa: N818
    code = 403
    error_code = OpenApiErrorCode.APP_ACCESS_MODE_UNAVAILABLE
    description = "This app's web-app access setting could not be read."
    hint = "Try again. If it keeps failing, ask an admin to check Dify Enterprise."


class PrivateAppNotAllowed(OpenApiError):  # noqa: N818
    code = 403
    error_code = OpenApiErrorCode.PRIVATE_APP_NOT_ALLOWED
    description = "You are not on this private app's member list."
    hint = "Ask the app's owner to add you."


class PrivateAppUserUnresolved(OpenApiError):  # noqa: N818
    code = 403
    error_code = OpenApiErrorCode.PRIVATE_APP_USER_UNRESOLVED
    description = "Could not tell who is signed in, so the private-app check failed."
    hint = "Sign in again."


class ResourceNotAuthorized(OpenApiError):  # noqa: N818
    code = 403
    error_code = OpenApiErrorCode.RESOURCE_NOT_AUTHORIZED
    description = "This app token doesn't cover this app, or the app's Service API is off."
    hint = "get.console_app lists the apps this token covers; a workspace admin can turn on an app's Service API."


class PermittedAppsUnavailable(OpenApiError):  # noqa: N818
    code = 503
    error_code = OpenApiErrorCode.PERMITTED_APPS_UNAVAILABLE
    description = "The list of apps you can use could not be loaded."
    hint = "Dify Enterprise did not answer. Try again later."
