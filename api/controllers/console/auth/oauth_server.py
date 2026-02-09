from collections.abc import Callable
from functools import wraps
from typing import Concatenate, ParamSpec, TypeVar

from flask import jsonify, request
from flask_restx import Resource
from pydantic import BaseModel
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


def oauth_server_client_id_required(view: Callable[Concatenate[T, OAuthProviderApp, P], R]):
    @wraps(view)
    def decorated(self: T, *args: P.args, **kwargs: P.kwargs):
        json_data = request.get_json()
        if json_data is None:
            raise BadRequest("client_id 为必填项")

        payload = OAuthClientPayload.model_validate(json_data)
        client_id = payload.client_id

        oauth_provider_app = OAuthServerService.get_oauth_provider_app(client_id)
        if not oauth_provider_app:
            raise NotFound("client_id 无效")

        return view(self, oauth_provider_app, *args, **kwargs)

    return decorated


def oauth_server_access_token_required(view: Callable[Concatenate[T, OAuthProviderApp, Account, P], R]):
    @wraps(view)
    def decorated(self: T, oauth_provider_app: OAuthProviderApp, *args: P.args, **kwargs: P.kwargs):
        if not isinstance(oauth_provider_app, OAuthProviderApp):
            raise BadRequest("无效的 OAuth 提供方应用")

        authorization_header = request.headers.get("Authorization")
        if not authorization_header:
            response = jsonify({"error": "需要 Authorization 请求头"})
            response.status_code = 401
            response.headers["WWW-Authenticate"] = "Bearer"
            return response

        parts = authorization_header.strip().split(None, 1)
        if len(parts) != 2:
            response = jsonify({"error": "无效的 Authorization 请求头格式"})
            response.status_code = 401
            response.headers["WWW-Authenticate"] = "Bearer"
            return response

        token_type = parts[0].strip()
        if token_type.lower() != "bearer":
            response = jsonify({"error": "token_type 无效"})
            response.status_code = 401
            response.headers["WWW-Authenticate"] = "Bearer"
            return response

        access_token = parts[1].strip()
        if not access_token:
            response = jsonify({"error": "access_token 不能为空"})
            response.status_code = 401
            response.headers["WWW-Authenticate"] = "Bearer"
            return response

        account = OAuthServerService.validate_oauth_access_token(oauth_provider_app.client_id, access_token)
        if not account:
            response = jsonify({"error": "access_token 或 client_id 无效"})
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
        payload = OAuthProviderRequest.model_validate(request.get_json())
        redirect_uri = payload.redirect_uri

        # check if redirect_uri is valid
        if redirect_uri not in oauth_provider_app.redirect_uris:
            raise BadRequest("redirect_uri 无效")

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
        payload = OAuthTokenRequest.model_validate(request.get_json())

        try:
            grant_type = OAuthGrantType(payload.grant_type)
        except ValueError:
            raise BadRequest("无效的 grant_type")
        match grant_type:
            case OAuthGrantType.AUTHORIZATION_CODE:
                if not payload.code:
                    raise BadRequest("code 为必填项")

                if payload.client_secret != oauth_provider_app.client_secret:
                    raise BadRequest("client_secret 无效")

                if payload.redirect_uri not in oauth_provider_app.redirect_uris:
                    raise BadRequest("redirect_uri 无效")

                access_token, refresh_token = OAuthServerService.sign_oauth_access_token(
                    grant_type, code=payload.code, client_id=oauth_provider_app.client_id
                )
                return jsonable_encoder(
                    {
                        "access_token": access_token,
                        "token_type": "Bearer",
                        "expires_in": OAUTH_ACCESS_TOKEN_EXPIRES_IN,
                        "refresh_token": refresh_token,
                    }
                )
            case OAuthGrantType.REFRESH_TOKEN:
                if not payload.refresh_token:
                    raise BadRequest("refresh_token 为必填项")

                access_token, refresh_token = OAuthServerService.sign_oauth_access_token(
                    grant_type, refresh_token=payload.refresh_token, client_id=oauth_provider_app.client_id
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
