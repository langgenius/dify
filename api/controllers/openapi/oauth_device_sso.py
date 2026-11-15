"""HTTP adapters for the external-SSO branch of the OAuth device flow."""

from __future__ import annotations

import logging
import re
from http import HTTPStatus
from typing import Never
from urllib.parse import urlencode

from flask import jsonify, make_response, redirect, request
from pydantic import BaseModel, ValidationError
from werkzeug.exceptions import (
    BadGateway,
    BadRequest,
    Conflict,
    Forbidden,
    NotFound,
    ServiceUnavailable,
    TooManyRequests,
    Unauthorized,
)

from controllers.openapi import bp
from controllers.openapi._models import (
    DeviceApprovalContextResponse,
    DeviceMutateRequest,
    DeviceMutateResponse,
)
from controllers.openapi.flask_admission import oauth_device_sso_admission
from extensions.ext_application_services import application_services
from libs.device_flow_security import (
    APPROVAL_GRANT_COOKIE_NAME,
    approval_grant_cleared_cookie_kwargs,
    approval_grant_cookie_kwargs,
)
from libs.helper import dump_response
from libs.rate_limit import LIMIT_SSO_INITIATE_PER_IP, rate_limit
from services.oauth_device_contracts import (
    AlreadyResolvedError,
    ApprovalInProgressError,
    ApprovalOutcomeUnknownError,
    ApprovalSessionConsumedError,
    DeviceRequestContext,
    DeviceSSOCompletion,
    DeviceStateLostError,
    ExternalApprovalCSRFError,
    ExternalApprovalRateLimitError,
    ExternalIdentityConflictError,
    ExternalUserCodeMismatchError,
    ExternalUserCodeNotFoundError,
    InvalidApprovalSessionError,
    InvalidUserCodeError,
    OAuthDeviceError,
    OAuthDeviceSSOConfigurationError,
    OAuthDeviceSSOInitiationError,
)

logger = logging.getLogger(__name__)

_ALLOWED_SSO_ERRORS = frozenset({"sso_failed", "email_belongs_to_dify_account"})
_USER_CODE_RE = re.compile(r"\A[A-Z0-9-]{1,16}\Z")


def _validate_json[M: BaseModel](model: type[M]) -> M:
    try:
        return model.model_validate(request.get_json(silent=True) or {})
    except ValidationError as error:
        raise BadRequest(str(error)) from error


def _device_error_redirect(code: str, user_code: str | None = None):
    safe_code = code if code in _ALLOWED_SSO_ERRORS else "sso_failed"
    params: dict[str, str] = {"sso_error": safe_code}
    if user_code and _USER_CODE_RE.fullmatch(user_code):
        params["user_code"] = user_code
    return redirect(f"/device?{urlencode(params)}", code=HTTPStatus.FOUND)


def _completion_response(result: DeviceSSOCompletion):
    if result.error_code:
        return _device_error_redirect(result.error_code, result.user_code)
    if not result.approval_grant:
        return _device_error_redirect("sso_failed", result.user_code)

    response = redirect("/device?sso_verified=1", code=HTTPStatus.FOUND)
    response.set_cookie(**approval_grant_cookie_kwargs(result.approval_grant))
    return response


def _raise_http_error(error: OAuthDeviceError, *, session_error: str = "invalid_session") -> Never:
    match error:
        case InvalidUserCodeError():
            raise BadRequest("invalid_user_code") from error
        case OAuthDeviceSSOConfigurationError():
            raise BadGateway("console_api_url_unset") from error
        case OAuthDeviceSSOInitiationError():
            raise BadGateway(str(error) or "sso_initiate_failed") from error
        case InvalidApprovalSessionError():
            raise Unauthorized(session_error) from error
        case ExternalApprovalRateLimitError():
            raise TooManyRequests("rate_limited") from error
        case ExternalApprovalCSRFError():
            raise Forbidden("csrf_mismatch") from error
        case ExternalUserCodeMismatchError():
            raise BadRequest("user_code_mismatch") from error
        case ExternalUserCodeNotFoundError():
            raise NotFound("user_code_not_pending") from error
        case AlreadyResolvedError():
            raise Conflict("user_code_not_pending") from error
        case ApprovalInProgressError():
            raise Conflict("approve_in_progress") from error
        case ApprovalOutcomeUnknownError():
            raise ServiceUnavailable("approval_outcome_unknown") from error
        case ExternalIdentityConflictError():
            raise Forbidden("email_belongs_to_dify_account") from error
        case ApprovalSessionConsumedError():
            raise Unauthorized("session_already_consumed") from error
        case DeviceStateLostError():
            raise Conflict("state_lost") from error
    raise RuntimeError(f"unmapped OAuth device SSO error: {type(error).__name__}")


@bp.route("/oauth/device/sso-initiate", methods=["GET"])
@oauth_device_sso_admission
@rate_limit(LIMIT_SSO_INITIATE_PER_IP)
def sso_initiate(context: DeviceRequestContext):
    user_code = (request.args.get("user_code") or "").strip()
    if not user_code:
        raise BadRequest("user_code required")
    try:
        result = application_services().oauth_device.initiate_sso(context, user_code=user_code)
    except OAuthDeviceError as error:
        _raise_http_error(error)

    response = redirect(result.redirect_url, code=HTTPStatus.FOUND)
    response.set_cookie(**approval_grant_cleared_cookie_kwargs())
    return response


@bp.route("/oauth/device/sso-complete", methods=["GET"])
@oauth_device_sso_admission
def sso_complete(context: DeviceRequestContext):
    try:
        result = application_services().oauth_device.complete_sso(
            context,
            inbound_error=request.args.get("sso_error"),
            inbound_user_code=request.args.get("user_code"),
            assertion=request.args.get("sso_assertion"),
        )
    except Exception:
        logger.exception("sso-complete: unhandled")
        return _device_error_redirect("sso_failed")
    return _completion_response(result)


@bp.route("/oauth/device/approval-context", methods=["GET"])
@oauth_device_sso_admission
def approval_context(context: DeviceRequestContext):
    try:
        result = application_services().oauth_device.get_approval_context(
            context,
            approval_grant=request.cookies.get(APPROVAL_GRANT_COOKIE_NAME, ""),
        )
    except OAuthDeviceError as error:
        _raise_http_error(error, session_error="no_session")
    return dump_response(DeviceApprovalContextResponse, result), HTTPStatus.OK


@bp.route("/oauth/device/approve-external", methods=["POST"])
@oauth_device_sso_admission
def approve_external(context: DeviceRequestContext):
    payload = _validate_json(DeviceMutateRequest)
    try:
        result = application_services().oauth_device.approve_external(
            context,
            approval_grant=request.cookies.get(APPROVAL_GRANT_COOKIE_NAME, ""),
            csrf_token=request.headers.get("X-CSRF-Token", ""),
            user_code=payload.user_code,
        )
    except OAuthDeviceError as error:
        _raise_http_error(error)

    response = make_response(jsonify(dump_response(DeviceMutateResponse, result)), HTTPStatus.OK)
    response.set_cookie(**approval_grant_cleared_cookie_kwargs())
    return response
