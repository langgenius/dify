"""``POST /openapi/v1/oauth/token``: RFC 6749 token endpoint."""

from __future__ import annotations

from datetime import UTC, datetime
from http import HTTPStatus

from flask import request
from flask_restx import Resource

from controllers.openapi import openapi_ns
from controllers.openapi._models import OAuthTokenErrorResponse, OAuthTokenResponse
from controllers.openapi._oauth_input import basic_client_credentials, read_oauth_body
from extensions.ext_application_services import application_services
from libs.helper import dump_response, extract_remote_ip
from services.oauth_token_contracts import TokenEndpointError, TokenGrantResult, TokenRequest

BASIC_CHALLENGE = 'Basic realm="dify-openapi"'
NO_STORE_HEADERS = {"Cache-Control": "no-store", "Pragma": "no-cache"}
BEARER = "Bearer"


def _token_request(body: dict[str, str]) -> TokenRequest:
    basic = basic_client_credentials()
    client_id, client_secret = basic or (body.get("client_id"), body.get("client_secret"))
    return TokenRequest(
        grant_type=body.get("grant_type", ""),
        client_id=client_id,
        client_secret=client_secret,
        code=body.get("code"),
        code_verifier=body.get("code_verifier"),
        redirect_uri=body.get("redirect_uri"),
        device_code=body.get("device_code"),
        refresh_token=body.get("refresh_token"),
        resource=body.get("resource"),
        scope=body.get("scope"),
        poll_ip=extract_remote_ip(request),
        request_origin=request.host_url,
    )


def _expires_in(expires_at: str) -> int:
    expiry = datetime.fromisoformat(expires_at)
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=UTC)
    return max(0, int((expiry - datetime.now(UTC)).total_seconds()))


def _token_response(result: TokenGrantResult) -> dict[str, object]:
    payload = result.payload
    extras = {key: value for key, value in payload.items() if key not in {"token", "expires_at"}}
    body: dict[str, object] = {
        "access_token": payload["token"],
        "token_type": BEARER,
        "expires_in": _expires_in(payload["expires_at"]),
        **extras,
    }
    if result.refresh_token is not None:
        body["refresh_token"] = result.refresh_token
    return dump_response(OAuthTokenResponse, body, exclude_unset=True)


@openapi_ns.route("/oauth/token")
class OAuthTokenApi(Resource):
    @openapi_ns.response(HTTPStatus.OK, "Access token", openapi_ns.models[OAuthTokenResponse.__name__])
    @openapi_ns.response(
        HTTPStatus.BAD_REQUEST, "OAuth token error", openapi_ns.models[OAuthTokenErrorResponse.__name__]
    )
    @openapi_ns.response(
        HTTPStatus.UNAUTHORIZED, "Client authentication failed", openapi_ns.models[OAuthTokenErrorResponse.__name__]
    )
    def post(self):
        try:
            result = application_services().oauth_token.exchange(_token_request(read_oauth_body()))
        except TokenEndpointError as error:
            headers = dict(NO_STORE_HEADERS)
            if error.status == HTTPStatus.UNAUTHORIZED:
                headers["WWW-Authenticate"] = BASIC_CHALLENGE
            return {"error": error.code.value}, error.status, headers
        return _token_response(result), HTTPStatus.OK, NO_STORE_HEADERS
