"""Consent-page backend under ``/openapi/v1/oauth/authorize/*``.

The client lookup is public and rate limited so the page can show the client
before login. Approve and deny use Console account admission, like the device
flow. The authorization endpoint itself is the console web page.
"""

from __future__ import annotations

from collections.abc import Mapping
from http import HTTPStatus

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, ValidationError

from configs import dify_config
from controllers.common.schema import query_params_from_model
from controllers.console.flask_admission import console_account_admission
from controllers.openapi import openapi_ns
from controllers.openapi._models import (
    OAuthAuthorizeClientQuery,
    OAuthAuthorizeClientResponse,
    OAuthAuthorizeErrorResponse,
    OAuthAuthorizeRedirectResponse,
    OAuthAuthorizeRequest,
)
from controllers.openapi._oauth_input import NO_STORE_HEADERS, oauth_feature_required
from extensions.ext_application_services import application_services
from libs.helper import dump_response
from libs.rate_limit import LIMIT_AUTHORIZE_APPROVE, LIMIT_AUTHORIZE_CLIENT_PUBLIC, rate_limit
from machinery.context import RequestContext
from services.oauth_authorize_service import AuthorizeErrorCode, AuthorizeRequest, AuthorizeRequestError
from services.oauth_resource import openapi_issuer_url


def _authorization_code_enabled() -> bool:
    return dify_config.ENABLE_OAUTH_AUTHORIZATION_CODE


def _validated[M: BaseModel](model: type[M], data: object) -> M:
    try:
        return model.model_validate(data if isinstance(data, Mapping) else {})
    except ValidationError:
        raise AuthorizeRequestError(AuthorizeErrorCode.INVALID_REQUEST) from None


def _authorize_request() -> AuthorizeRequest:
    payload = _validated(OAuthAuthorizeRequest, request.get_json(silent=True))
    return AuthorizeRequest(**payload.model_dump())


def _issuer() -> str:
    return openapi_issuer_url(request.host_url)


def _error(error: AuthorizeRequestError) -> tuple[dict[str, str], HTTPStatus]:
    return {"error": error.code.value}, HTTPStatus.BAD_REQUEST


def _redirect(url: str) -> tuple[dict[str, object], HTTPStatus, Mapping[str, str]]:
    return dump_response(OAuthAuthorizeRedirectResponse, {"redirect_to": url}), HTTPStatus.OK, NO_STORE_HEADERS


@openapi_ns.route("/oauth/authorize/client")
class OAuthAuthorizeClientApi(Resource):
    @openapi_ns.doc(params=query_params_from_model(OAuthAuthorizeClientQuery))
    @openapi_ns.response(HTTPStatus.OK, "Client to show", openapi_ns.models[OAuthAuthorizeClientResponse.__name__])
    @openapi_ns.response(
        HTTPStatus.BAD_REQUEST,
        "Unknown client, bad redirect URI or missing parameter",
        openapi_ns.models[OAuthAuthorizeErrorResponse.__name__],
    )
    @oauth_feature_required(_authorization_code_enabled)
    @rate_limit(LIMIT_AUTHORIZE_CLIENT_PUBLIC)
    def get(self):
        try:
            query = _validated(OAuthAuthorizeClientQuery, request.args.to_dict(flat=True))
            view = application_services().oauth_authorize.describe_client(query.client_id, query.redirect_uri)
        except AuthorizeRequestError as error:
            return _error(error)
        return dump_response(OAuthAuthorizeClientResponse, view), HTTPStatus.OK


@openapi_ns.route("/oauth/authorize/approve")
class OAuthAuthorizeApproveApi(Resource):
    @openapi_ns.expect(openapi_ns.models[OAuthAuthorizeRequest.__name__])
    @openapi_ns.response(
        HTTPStatus.OK,
        "Client redirect with a code, or with an error for a bad PKCE or resource value",
        openapi_ns.models[OAuthAuthorizeRedirectResponse.__name__],
    )
    @openapi_ns.response(
        HTTPStatus.BAD_REQUEST, "Request rejected", openapi_ns.models[OAuthAuthorizeErrorResponse.__name__]
    )
    @oauth_feature_required(_authorization_code_enabled)
    @console_account_admission(require_oauth_bearer_enabled=True)
    @rate_limit(LIMIT_AUTHORIZE_APPROVE)
    def post(self, request_context: RequestContext):
        try:
            url = application_services().oauth_authorize.approve(
                request_context, _authorize_request(), issuer=_issuer()
            )
        except AuthorizeRequestError as error:
            return _error(error)
        return _redirect(url)


@openapi_ns.route("/oauth/authorize/deny")
class OAuthAuthorizeDenyApi(Resource):
    @openapi_ns.expect(openapi_ns.models[OAuthAuthorizeRequest.__name__])
    @openapi_ns.response(
        HTTPStatus.OK,
        "Client redirect with access_denied",
        openapi_ns.models[OAuthAuthorizeRedirectResponse.__name__],
    )
    @openapi_ns.response(
        HTTPStatus.BAD_REQUEST, "Request rejected", openapi_ns.models[OAuthAuthorizeErrorResponse.__name__]
    )
    @oauth_feature_required(_authorization_code_enabled)
    @console_account_admission(require_oauth_bearer_enabled=True)
    @rate_limit(LIMIT_AUTHORIZE_APPROVE)
    def post(self, _request_context: RequestContext):
        try:
            url = application_services().oauth_authorize.deny(_authorize_request(), issuer=_issuer())
        except AuthorizeRequestError as error:
            return _error(error)
        return _redirect(url)
