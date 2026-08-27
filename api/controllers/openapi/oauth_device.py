"""Device-flow HTTP adapters under ``/openapi/v1/oauth/device/*``.

Protocol endpoints are public and rate-limited. Approval endpoints use
Console account admission. The SSO branch lives in ``oauth_device_sso.py``.
"""

from __future__ import annotations

from http import HTTPStatus

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, ValidationError
from werkzeug.exceptions import BadRequest

from controllers.common.schema import query_params_from_model
from controllers.console.flask_admission import console_account_admission
from controllers.openapi import openapi_ns
from controllers.openapi._models import (
    DeviceCodeRequest,
    DeviceCodeResponse,
    DeviceLookupQuery,
    DeviceLookupResponse,
    DeviceMutateRequest,
    DeviceMutateResponse,
    DevicePollRequest,
    DeviceTokenResponse,
)
from extensions.ext_application_services import application_services
from libs.helper import dump_response, extract_remote_ip
from libs.rate_limit import (
    LIMIT_DEVICE_CODE_PER_IP,
    LIMIT_DEVICE_FLOW_APPROVE,
    LIMIT_LOOKUP_PUBLIC,
    rate_limit,
)
from machinery.context import RequestContext
from services.oauth_device_contracts import (
    AccessDeniedError,
    AlreadyResolvedError,
    ApprovalInProgressError,
    ApprovalOutcomeUnknownError,
    AuthorizationPendingError,
    DeviceStateLostError,
    ExpiredOrUnknownError,
    ExpiredTokenError,
    OAuthDeviceError,
    PollTooFastError,
    UnsupportedClientError,
)


def _validate_json[M: BaseModel](model: type[M]) -> M:
    body = request.get_json(silent=True) or {}
    try:
        return model.model_validate(body)
    except ValidationError as error:
        raise BadRequest(str(error)) from error


def _validate_query[M: BaseModel](model: type[M]) -> M:
    try:
        return model.model_validate(request.args.to_dict(flat=True))
    except ValidationError as error:
        raise BadRequest(str(error)) from error


def _error_response(error: OAuthDeviceError) -> tuple[dict[str, str], int]:
    match error:
        case UnsupportedClientError():
            return {"error": "unsupported_client"}, HTTPStatus.BAD_REQUEST
        case PollTooFastError():
            return {"error": "slow_down"}, HTTPStatus.BAD_REQUEST
        case ExpiredTokenError():
            return {"error": "expired_token"}, HTTPStatus.BAD_REQUEST
        case AuthorizationPendingError():
            return {"error": "authorization_pending"}, HTTPStatus.BAD_REQUEST
        case AccessDeniedError():
            return {"error": "access_denied"}, HTTPStatus.BAD_REQUEST
        case ExpiredOrUnknownError():
            return {"error": "expired_or_unknown"}, HTTPStatus.NOT_FOUND
        case AlreadyResolvedError():
            return {"error": "already_resolved"}, HTTPStatus.CONFLICT
        case ApprovalInProgressError():
            return {"error": "approve_in_progress"}, HTTPStatus.CONFLICT
        case ApprovalOutcomeUnknownError():
            return {"error": "approval_outcome_unknown"}, HTTPStatus.SERVICE_UNAVAILABLE
        case DeviceStateLostError():
            return {"error": "state_lost"}, HTTPStatus.CONFLICT
    raise RuntimeError(f"unmapped OAuth device error: {type(error).__name__}")


@openapi_ns.route("/oauth/device/code")
class OAuthDeviceCodeApi(Resource):
    @openapi_ns.expect(openapi_ns.models[DeviceCodeRequest.__name__])
    @openapi_ns.response(HTTPStatus.OK, "Device code created", openapi_ns.models[DeviceCodeResponse.__name__])
    @rate_limit(LIMIT_DEVICE_CODE_PER_IP)
    def post(self):
        payload = _validate_json(DeviceCodeRequest)
        try:
            authorization = application_services().oauth_device.start(
                client_id=payload.client_id,
                device_label=payload.device_label,
                created_ip=extract_remote_ip(request),
                request_origin=request.host_url,
            )
        except OAuthDeviceError as error:
            return _error_response(error)
        return dump_response(DeviceCodeResponse, authorization), HTTPStatus.OK


@openapi_ns.route("/oauth/device/token")
class OAuthDeviceTokenApi(Resource):
    """RFC 8628 poll endpoint."""

    @openapi_ns.expect(openapi_ns.models[DevicePollRequest.__name__])
    @openapi_ns.response(HTTPStatus.OK, "Device token", openapi_ns.models[DeviceTokenResponse.__name__])
    def post(self):
        payload = _validate_json(DevicePollRequest)
        try:
            token = application_services().oauth_device.poll(
                device_code=payload.device_code,
                poll_ip=extract_remote_ip(request),
            )
        except OAuthDeviceError as error:
            return _error_response(error)
        return dump_response(DeviceTokenResponse, token, exclude_unset=True), HTTPStatus.OK


@openapi_ns.route("/oauth/device/lookup")
class OAuthDeviceLookupApi(Resource):
    """Public pre-login validation for a high-entropy, short-lived user code."""

    @openapi_ns.doc(params=query_params_from_model(DeviceLookupQuery))
    @openapi_ns.response(HTTPStatus.OK, "Device lookup result", openapi_ns.models[DeviceLookupResponse.__name__])
    @rate_limit(LIMIT_LOOKUP_PUBLIC)
    def get(self):
        payload = _validate_query(DeviceLookupQuery)
        lookup = application_services().oauth_device.lookup(user_code=payload.user_code)
        return dump_response(DeviceLookupResponse, lookup), HTTPStatus.OK


@openapi_ns.route("/oauth/device/approve")
class DeviceApproveApi(Resource):
    @openapi_ns.expect(openapi_ns.models[DeviceMutateRequest.__name__])
    @openapi_ns.response(HTTPStatus.OK, "Approved", openapi_ns.models[DeviceMutateResponse.__name__])
    @console_account_admission(require_oauth_bearer_enabled=True)
    @rate_limit(LIMIT_DEVICE_FLOW_APPROVE)
    def post(self, request_context: RequestContext):
        payload = _validate_json(DeviceMutateRequest)
        try:
            result = application_services().oauth_device.approve(request_context, user_code=payload.user_code)
        except OAuthDeviceError as error:
            return _error_response(error)
        return dump_response(DeviceMutateResponse, result), HTTPStatus.OK


@openapi_ns.route("/oauth/device/deny")
class DeviceDenyApi(Resource):
    @openapi_ns.expect(openapi_ns.models[DeviceMutateRequest.__name__])
    @openapi_ns.response(HTTPStatus.OK, "Denied", openapi_ns.models[DeviceMutateResponse.__name__])
    @console_account_admission(require_oauth_bearer_enabled=True)
    @rate_limit(LIMIT_DEVICE_FLOW_APPROVE)
    def post(self, _request_context: RequestContext):
        payload = _validate_json(DeviceMutateRequest)
        try:
            result = application_services().oauth_device.deny(user_code=payload.user_code)
        except OAuthDeviceError as error:
            return _error_response(error)
        return dump_response(DeviceMutateResponse, result), HTTPStatus.OK
