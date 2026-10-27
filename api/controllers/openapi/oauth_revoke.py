"""``POST /openapi/v1/oauth/revoke``: RFC 7009 token revocation.

Not gated by ``ENABLE_OAUTH_AUTHORIZATION_CODE``: turning logins off must not
stop clients from logging out.
"""

from __future__ import annotations

from http import HTTPStatus

from flask import Response, request
from flask_restx import Resource

from controllers.openapi import openapi_ns
from controllers.openapi._models import OAuthTokenErrorResponse
from controllers.openapi._oauth_input import (
    NO_STORE_HEADERS,
    InvalidOAuthBodyError,
    client_credentials,
    read_oauth_body,
    token_error_response,
)
from extensions.ext_application_services import application_services
from libs.helper import extract_remote_ip
from services.oauth_grant_revoker import RevokeRequest
from services.oauth_token_contracts import TokenEndpointError, TokenErrorCode


def _revoke_request(body: dict[str, str]) -> RevokeRequest:
    client_id, client_secret = client_credentials(body)
    return RevokeRequest(
        client_id=client_id,
        client_secret=client_secret,
        token=body.get("token"),
        source_ip=extract_remote_ip(request),
    )


@openapi_ns.route("/oauth/revoke")
class OAuthRevokeApi(Resource):
    @openapi_ns.response(HTTPStatus.OK, "Token revoked, or unknown to this client")
    @openapi_ns.response(
        HTTPStatus.BAD_REQUEST, "Missing token or malformed body", openapi_ns.models[OAuthTokenErrorResponse.__name__]
    )
    @openapi_ns.response(
        HTTPStatus.UNAUTHORIZED, "Client authentication failed", openapi_ns.models[OAuthTokenErrorResponse.__name__]
    )
    @openapi_ns.response(
        HTTPStatus.TOO_MANY_REQUESTS,
        "Too many failed client authentications",
        openapi_ns.models[OAuthTokenErrorResponse.__name__],
    )
    def post(self):
        try:
            application_services().oauth_revocation.revoke(_revoke_request(read_oauth_body()))
        except InvalidOAuthBodyError:
            return token_error_response(TokenEndpointError(TokenErrorCode.INVALID_REQUEST))
        except TokenEndpointError as error:
            return token_error_response(error)
        return Response(status=HTTPStatus.OK, headers=NO_STORE_HEADERS)
