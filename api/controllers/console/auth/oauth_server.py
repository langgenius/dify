from http import HTTPStatus
from typing import Any, Never

from flask import Response, jsonify, request
from flask_restx import Resource
from pydantic import BaseModel, ValidationError
from werkzeug.exceptions import BadRequest, NotFound, UnprocessableEntity

from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import setup_required
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.helper import dump_response
from machinery.context import RequestContext
from services.oauth_server_service import (
    OAuthServerClientNotFoundError,
    OAuthServerRequestError,
    OAuthServerUnauthorizedError,
)

from .. import console_ns


class OAuthClientPayload(BaseModel):
    client_id: str


class OAuthProviderRequest(BaseModel):
    client_id: str
    redirect_uri: str


class OAuthTokenRequest(BaseModel):
    client_id: str
    grant_type: str
    code: str | None = None
    client_secret: str | None = None
    redirect_uri: str | None = None
    refresh_token: str | None = None


class OAuthProviderAppResponse(ResponseModel):
    app_icon: str
    app_label: dict[str, Any]
    scope: str
    auto_authorize: bool


class OAuthProviderAuthorizeResponse(ResponseModel):
    code: str


class OAuthProviderTokenResponse(ResponseModel):
    access_token: str
    token_type: str
    expires_in: int
    refresh_token: str


class OAuthProviderAccountResponse(ResponseModel):
    id: str
    name: str
    email: str
    avatar: str | None = None
    interface_language: str | None
    timezone: str | None


register_schema_models(console_ns, OAuthClientPayload, OAuthProviderRequest, OAuthTokenRequest)
register_response_schema_models(
    console_ns,
    OAuthProviderAccountResponse,
    OAuthProviderAppResponse,
    OAuthProviderAuthorizeResponse,
    OAuthProviderTokenResponse,
)


def _parse_payload[PayloadT: BaseModel](model: type[PayloadT]) -> PayloadT:
    json_data = request.get_json()
    if json_data is None:
        raise BadRequest("client_id is required")
    try:
        return model.model_validate(json_data)
    except ValidationError as exc:
        raise UnprocessableEntity(exc.json()) from exc


def _raise_application_error(error: OAuthServerClientNotFoundError | OAuthServerRequestError) -> Never:
    if isinstance(error, OAuthServerClientNotFoundError):
        raise NotFound(str(error)) from error
    raise BadRequest(str(error)) from error


def _parse_bearer_access_token() -> tuple[str | None, str | None]:
    authorization_header = request.headers.get("Authorization")
    if not authorization_header:
        return None, "Authorization header is required"

    parts = authorization_header.strip().split(None, 1)
    if len(parts) != 2:
        return None, "Invalid Authorization header format"

    token_type, access_token = (part.strip() for part in parts)
    if token_type.lower() != "bearer":
        return None, "token_type is invalid"
    if not access_token:
        return None, "access_token is required"
    return access_token, None


def _unauthorized_response(error: str) -> Response:
    response = jsonify({"error": error})
    response.status_code = HTTPStatus.UNAUTHORIZED
    response.headers["WWW-Authenticate"] = "Bearer"
    return response


@console_ns.route("/oauth/provider")
class OAuthServerAppApi(Resource):
    @console_ns.expect(console_ns.models[OAuthProviderRequest.__name__])
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[OAuthProviderAppResponse.__name__])
    @setup_required
    def post(self):
        payload = _parse_payload(OAuthProviderRequest)
        try:
            provider = application_services().oauth_server.get_provider(
                client_id=payload.client_id,
                redirect_uri=payload.redirect_uri,
            )
        except (OAuthServerClientNotFoundError, OAuthServerRequestError) as error:
            _raise_application_error(error)
        return dump_response(OAuthProviderAppResponse, provider), HTTPStatus.OK


@console_ns.route("/oauth/provider/authorize")
class OAuthServerUserAuthorizeApi(Resource):
    @console_ns.expect(console_ns.models[OAuthClientPayload.__name__])
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[OAuthProviderAuthorizeResponse.__name__])
    @console_account_admission()
    def post(self, request_context: RequestContext):
        payload = _parse_payload(OAuthClientPayload)
        try:
            authorization = application_services().oauth_server.authorize(
                request_context,
                client_id=payload.client_id,
            )
        except OAuthServerClientNotFoundError as error:
            _raise_application_error(error)
        return dump_response(OAuthProviderAuthorizeResponse, authorization), HTTPStatus.OK


@console_ns.route("/oauth/provider/token")
class OAuthServerUserTokenApi(Resource):
    @console_ns.expect(console_ns.models[OAuthTokenRequest.__name__])
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[OAuthProviderTokenResponse.__name__])
    @setup_required
    def post(self):
        payload = _parse_payload(OAuthTokenRequest)
        try:
            tokens = application_services().oauth_server.exchange_token(
                client_id=payload.client_id,
                grant_type=payload.grant_type,
                code=payload.code,
                client_secret=payload.client_secret,
                redirect_uri=payload.redirect_uri,
                refresh_token=payload.refresh_token,
            )
        except (OAuthServerClientNotFoundError, OAuthServerRequestError) as error:
            _raise_application_error(error)
        return dump_response(OAuthProviderTokenResponse, tokens), HTTPStatus.OK


@console_ns.route("/oauth/provider/account")
class OAuthServerUserAccountApi(Resource):
    @console_ns.expect(console_ns.models[OAuthClientPayload.__name__])
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[OAuthProviderAccountResponse.__name__])
    @setup_required
    def post(self):
        payload = _parse_payload(OAuthClientPayload)
        access_token, header_error = _parse_bearer_access_token()
        try:
            account = application_services().oauth_server.get_account(
                client_id=payload.client_id,
                access_token=access_token,
            )
        except OAuthServerClientNotFoundError as error:
            _raise_application_error(error)
        except OAuthServerUnauthorizedError as error:
            return _unauthorized_response(header_error or str(error))
        return dump_response(OAuthProviderAccountResponse, account), HTTPStatus.OK
