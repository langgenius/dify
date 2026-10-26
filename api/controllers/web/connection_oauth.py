"""Web authorization entry points; the registered plugin callback completes the grant."""

from uuid import UUID

from flask import Response, make_response, request
from flask_restx import Resource
from pydantic import ValidationError

from controllers.common.end_user_connection_oauth import complete_end_user_connection_oauth
from controllers.common.end_user_connections import (
    ConnectionCheckUnavailableHTTPError,
    ConnectionConfigurationHTTPError,
    ConnectionConflictHTTPError,
    ConnectionLoginRequiredError,
    ConnectionNotFoundHTTPError,
    ConnectionOAuthHTTPError,
    ConnectionReauthorizationHTTPError,
    ConnectionSecretUnavailableHTTPError,
    ConnectionWorkflowChangedHTTPError,
    raise_connection_error,
)
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.web import web_ns
from controllers.web.wraps import WebApiResource
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.external_api import error_responses
from libs.helper import dump_response
from models.model import App, EndUser
from services.end_user_connection_identity import connection_context_from_web_passport
from services.end_user_connections.contracts import ConnectionOAuthStart, StartConnectionOAuthInput
from services.end_user_connections.errors import ConnectionError
from services.plugin.oauth_service import OAuthProxyService


class EndUserConnectionOAuthPayload(StartConnectionOAuthInput):
    pass


class EndUserConnectionOAuthResponse(ResponseModel):
    authorization_url: str


register_schema_models(web_ns, EndUserConnectionOAuthPayload)
register_response_schema_models(web_ns, EndUserConnectionOAuthResponse)


def _authorization_response(result: ConnectionOAuthStart) -> Response:
    response = make_response(dump_response(EndUserConnectionOAuthResponse, result))
    response.set_cookie(
        "context_id",
        result.context_id,
        httponly=True,
        samesite="Lax",
        secure=request.is_secure,
        max_age=OAuthProxyService.__MAX_AGE__,
    )
    response.headers["Cache-Control"] = "no-store"
    return response


@web_ns.route("/connections/oauth/authorization-url")
class EndUserConnectionOAuthApi(WebApiResource):
    @web_ns.expect(web_ns.models[EndUserConnectionOAuthPayload.__name__])
    @web_ns.response(200, "OAuth authorization URL", web_ns.models[EndUserConnectionOAuthResponse.__name__])
    @error_responses(
        ConnectionLoginRequiredError,
        ConnectionConfigurationHTTPError,
        ConnectionWorkflowChangedHTTPError,
        ConnectionCheckUnavailableHTTPError,
        ConnectionSecretUnavailableHTTPError,
        ConnectionOAuthHTTPError,
        ConnectionReauthorizationHTTPError,
    )
    def post(self, app_model: App, end_user: EndUser):
        try:
            context = connection_context_from_web_passport(app=app_model, end_user=end_user)
            payload = EndUserConnectionOAuthPayload.model_validate(web_ns.payload or {})
            result = application_services().end_user_connection_oauth.start_oauth(
                context,
                payload,
                callback_url=request.url_root.rstrip("/") + "/api/connections/oauth",
            )
        except ValidationError:
            raise ValueError("Invalid connection payload.") from None
        except ConnectionError as error:
            raise_connection_error(error)
        # response-contract:ignore cookie-bearing Flask response
        return _authorization_response(result)


@web_ns.route("/connections/<uuid:connection_id>/reauthorize")
class EndUserConnectionReauthorizeApi(WebApiResource):
    @web_ns.response(200, "OAuth reauthorization URL", web_ns.models[EndUserConnectionOAuthResponse.__name__])
    @error_responses(
        ConnectionLoginRequiredError,
        ConnectionConfigurationHTTPError,
        ConnectionNotFoundHTTPError,
        ConnectionCheckUnavailableHTTPError,
        ConnectionSecretUnavailableHTTPError,
        ConnectionOAuthHTTPError,
        ConnectionReauthorizationHTTPError,
    )
    def post(self, app_model: App, end_user: EndUser, connection_id: UUID):
        try:
            result = application_services().end_user_connection_oauth.reauthorize_oauth(
                connection_context_from_web_passport(app=app_model, end_user=end_user),
                str(connection_id),
                callback_url=request.url_root.rstrip("/") + "/api/connections/oauth",
            )
        except ConnectionError as error:
            raise_connection_error(error)
        # response-contract:ignore cookie-bearing Flask response
        return _authorization_response(result)


@web_ns.route("/connections/oauth/<path:provider>/callback")
class EndUserConnectionOAuthCallbackApi(Resource):
    @web_ns.response(302, "Redirect to OAuth completion page")
    @error_responses(
        ConnectionLoginRequiredError,
        ConnectionConfigurationHTTPError,
        ConnectionConflictHTTPError,
        ConnectionNotFoundHTTPError,
        ConnectionOAuthHTTPError,
        ConnectionReauthorizationHTTPError,
        ConnectionSecretUnavailableHTTPError,
        ConnectionWorkflowChangedHTTPError,
        ConnectionCheckUnavailableHTTPError,
    )
    def get(self, provider: str):
        # The one-use context cookie and provider state authorize this continuation.
        # response-contract:ignore cookie-bearing redirect from the personal OAuth flow
        return complete_end_user_connection_oauth(provider, request.cookies.get("context_id", ""))
