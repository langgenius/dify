from collections.abc import Callable
from functools import wraps
from typing import Concatenate, ParamSpec, TypeVar

from flask import jsonify, request
from flask_restx import Resource, reqparse
from werkzeug.exceptions import BadRequest, NotFound

from controllers.console.wraps import account_initialization_required, setup_required
from core.model_runtime.utils.encoders import jsonable_encoder
from libs.login import current_account_with_tenant, login_required
from models import Account
from models.model import OAuthProviderApp
from services.oauth_server import OAUTH_ACCESS_TOKEN_EXPIRES_IN, OAuthGrantType, OAuthServerService

from .. import console_ns

P = ParamSpec("P")
R = TypeVar("R")
T = TypeVar("T")


def oauth_server_client_id_required(view: Callable[Concatenate[T, OAuthProviderApp, P], R]):
    @wraps(view)
    def decorated(self: T, *args: P.args, **kwargs: P.kwargs):
        parser = reqparse.RequestParser().add_argument("client_id", type=str, required=True, location="json")
        parsed_args = parser.parse_args()
        client_id = parsed_args.get("client_id")
        if not client_id:
            raise BadRequest("client_id is required")

        oauth_provider_app = OAuthServerService.get_oauth_provider_app(client_id)
        if not oauth_provider_app:
            raise NotFound("client_id is invalid")

        return view(self, oauth_provider_app, *args, **kwargs)

    return decorated


def oauth_server_access_token_required(view: Callable[Concatenate[T, OAuthProviderApp, Account, P], R]):
    @wraps(view)
    def decorated(self: T, oauth_provider_app: OAuthProviderApp, *args: P.args, **kwargs: P.kwargs):
        if not isinstance(oauth_provider_app, OAuthProviderApp):
            raise BadRequest("Invalid oauth_provider_app")

        authorization_header = request.headers.get("Authorization")
        if not authorization_header:
            response = jsonify({"error": "Authorization header is required"})
            response.status_code = 401
            response.headers["WWW-Authenticate"] = "Bearer"
            return response

        parts = authorization_header.strip().split(None, 1)
        if len(parts) != 2:
            response = jsonify({"error": "Invalid Authorization header format"})
            response.status_code = 401
            response.headers["WWW-Authenticate"] = "Bearer"
            return response

        token_type = parts[0].strip()
        if token_type.lower() != "bearer":
            response = jsonify({"error": "token_type is invalid"})
            response.status_code = 401
            response.headers["WWW-Authenticate"] = "Bearer"
            return response

        access_token = parts[1].strip()
        if not access_token:
            response = jsonify({"error": "access_token is required"})
            response.status_code = 401
            response.headers["WWW-Authenticate"] = "Bearer"
            return response

        account = OAuthServerService.validate_oauth_access_token(oauth_provider_app.client_id, access_token)
        if not account:
            response = jsonify({"error": "access_token or client_id is invalid"})
            response.status_code = 401
            response.headers["WWW-Authenticate"] = "Bearer"
            return response

        return view(self, oauth_provider_app, account, *args, **kwargs)

    return decorated


@console_ns.route("/oauth/provider")
class OAuthServerAppApi(Resource):
    @setup_required
    @oauth_server_client_id_required
    def post(self, oauth_provider_app: OAuthProviderApp):
        parser = reqparse.RequestParser().add_argument("redirect_uri", type=str, required=True, location="json")
        parsed_args = parser.parse_args()
        redirect_uri = parsed_args.get("redirect_uri")

        # check if redirect_uri is valid
        if redirect_uri not in oauth_provider_app.redirect_uris:
            raise BadRequest("redirect_uri is invalid")

        return jsonable_encoder(
            {
                "app_icon": oauth_provider_app.app_icon,
                "app_label": oauth_provider_app.app_label,
                "scope": oauth_provider_app.scope,
            }
        )


@console_ns.route("/oauth/provider/authorize")
class OAuthServerUserAuthorizeApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @oauth_server_client_id_required
    def post(self, oauth_provider_app: OAuthProviderApp):
        current_user, _ = current_account_with_tenant()
        account = current_user
        user_account_id = account.id

        code = OAuthServerService.sign_oauth_authorization_code(oauth_provider_app.client_id, user_account_id)
        return jsonable_encoder(
            {
                "code": code,
            }
        )


@console_ns.route("/oauth/provider/token")
class OAuthServerUserTokenApi(Resource):
    @setup_required
    @oauth_server_client_id_required
    def post(self, oauth_provider_app: OAuthProviderApp):
        parser = (
            reqparse.RequestParser()
            .add_argument("grant_type", type=str, required=True, location="json")
            .add_argument("code", type=str, required=False, location="json")
            .add_argument("client_secret", type=str, required=False, location="json")
            .add_argument("redirect_uri", type=str, required=False, location="json")
            .add_argument("refresh_token", type=str, required=False, location="json")
        )
        parsed_args = parser.parse_args()

        try:
            grant_type = OAuthGrantType(parsed_args["grant_type"])
        except ValueError:
            raise BadRequest("invalid grant_type")

        if grant_type == OAuthGrantType.AUTHORIZATION_CODE:
            if not parsed_args["code"]:
                raise BadRequest("code is required")

            if parsed_args["client_secret"] != oauth_provider_app.client_secret:
                raise BadRequest("client_secret is invalid")

            if parsed_args["redirect_uri"] not in oauth_provider_app.redirect_uris:
                raise BadRequest("redirect_uri is invalid")

            access_token, refresh_token = OAuthServerService.sign_oauth_access_token(
                grant_type, code=parsed_args["code"], client_id=oauth_provider_app.client_id
            )
            return jsonable_encoder(
                {
                    "access_token": access_token,
                    "token_type": "Bearer",
                    "expires_in": OAUTH_ACCESS_TOKEN_EXPIRES_IN,
                    "refresh_token": refresh_token,
                }
            )
        elif grant_type == OAuthGrantType.REFRESH_TOKEN:
            if not parsed_args["refresh_token"]:
                raise BadRequest("refresh_token is required")

            access_token, refresh_token = OAuthServerService.sign_oauth_access_token(
                grant_type, refresh_token=parsed_args["refresh_token"], client_id=oauth_provider_app.client_id
            )
            return jsonable_encoder(
                {
                    "access_token": access_token,
                    "token_type": "Bearer",
                    "expires_in": OAUTH_ACCESS_TOKEN_EXPIRES_IN,
                    "refresh_token": refresh_token,
                }
            )


@console_ns.route("/oauth/provider/account")
class OAuthServerUserAccountApi(Resource):
    @setup_required
    @oauth_server_client_id_required
    @oauth_server_access_token_required
    def post(self, oauth_provider_app: OAuthProviderApp, account: Account):
        return jsonable_encoder(
            {
                "name": account.name,
                "email": account.email,
                "avatar": account.avatar,
                "interface_language": account.interface_language,
                "timezone": account.timezone,
            }
        )
