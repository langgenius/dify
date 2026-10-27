"""``POST /openapi/v1/oauth/register``: RFC 7591 dynamic client registration."""

from __future__ import annotations

from http import HTTPStatus

from flask import request
from flask_restx import Resource

from controllers.openapi import openapi_ns
from controllers.openapi._models import OAuthRegisterErrorResponse, OAuthRegisterRequest, OAuthRegisterResponse
from controllers.openapi._oauth_input import NO_STORE_HEADERS, oauth_feature_required
from enums.oauth_client import OAuthClientKind
from extensions.ext_application_services import application_services
from libs.helper import dump_response
from libs.rate_limit import LIMIT_DCR_PER_IP, rate_limit
from services.oauth_client_metadata import CODE_RESPONSE_TYPE
from services.oauth_client_registration import (
    RegisteredClient,
    RegistrationError,
    RegistrationErrorCode,
)
from services.oauth_token_adapters import dcr_enabled

NEVER_EXPIRES = 0


def _error(code: RegistrationErrorCode, description: str) -> tuple[dict[str, str], HTTPStatus, dict[str, str]]:
    body = dump_response(OAuthRegisterErrorResponse, {"error": code, "error_description": description})
    return body, HTTPStatus.BAD_REQUEST, NO_STORE_HEADERS


def _registered_body(client: RegisteredClient) -> dict[str, object]:
    confidential = client.token_endpoint_auth_method.kind == OAuthClientKind.CONFIDENTIAL
    return dump_response(
        OAuthRegisterResponse,
        {
            "client_id": client.client_id,
            "client_id_issued_at": client.client_id_issued_at,
            "client_name": client.client_name,
            "redirect_uris": client.redirect_uris,
            "grant_types": client.grant_types,
            "response_types": [CODE_RESPONSE_TYPE],
            "token_endpoint_auth_method": client.token_endpoint_auth_method,
            "logo_uri": client.logo_uri,
            "client_secret": client.client_secret,
            "client_secret_expires_at": NEVER_EXPIRES if confidential else None,
        },
        exclude_none=True,
    )


@openapi_ns.route("/oauth/register")
class OAuthRegisterApi(Resource):
    @openapi_ns.expect(openapi_ns.models[OAuthRegisterRequest.__name__])
    @openapi_ns.response(HTTPStatus.CREATED, "Client registered", openapi_ns.models[OAuthRegisterResponse.__name__])
    @openapi_ns.response(
        HTTPStatus.BAD_REQUEST, "Invalid client metadata", openapi_ns.models[OAuthRegisterErrorResponse.__name__]
    )
    @oauth_feature_required(dcr_enabled)
    @rate_limit(LIMIT_DCR_PER_IP)
    def post(self):
        metadata = request.get_json(silent=True)
        if not isinstance(metadata, dict):
            return _error(RegistrationErrorCode.INVALID_CLIENT_METADATA, "The body must be a JSON object")
        try:
            client = application_services().oauth_registration.register(metadata)
        except RegistrationError as error:
            return _error(error.code, error.description)
        return _registered_body(client), HTTPStatus.CREATED, NO_STORE_HEADERS
