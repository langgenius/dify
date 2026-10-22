from flask import make_response, request
from flask_restx import Resource
from pydantic import BaseModel, Field
from werkzeug.exceptions import NotFound, Unauthorized

from configs import dify_config
from constants import HEADER_NAME_APP_CODE
from controllers.common.end_user_connections import ConnectionLoginRequiredError
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console.wraps import model_validate
from controllers.web import web_ns
from controllers.web.error import WebAppAuthAccessDeniedError, WebAppAuthRequiredError
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.external_api import error_responses
from libs.helper import dump_response
from libs.passport import PassportService
from libs.token import check_csrf_token, extract_console_cookie_token, extract_webapp_access_token
from services.entities.passport_entities import WebPassportRequest
from services.web_passport_service import (
    WebPassportAccessDeniedError,
    WebPassportAccountExchangeDisabledError,
    WebPassportAuthenticationRequiredError,
    WebPassportNotFoundError,
    WebPassportUnauthorizedError,
)


class PassportQuery(BaseModel):
    user_id: str | None = Field(default=None, description="End user session ID")


register_schema_models(web_ns, PassportQuery)


class PassportAccessTokenResponse(ResponseModel):
    access_token: str


register_response_schema_models(web_ns, PassportAccessTokenResponse)


@web_ns.route("/passport")
class PassportResource(Resource):
    """Issue an authentication passport for a deployed web application."""

    @web_ns.doc("get_passport")
    @web_ns.doc(description="Get authentication passport for web application access")
    @web_ns.doc(params=query_params_from_model(PassportQuery))
    @web_ns.doc(
        responses={
            200: "Passport retrieved successfully",
            401: "Unauthorized - missing app code or invalid authentication",
            404: "Application or user not found",
        }
    )
    @web_ns.response(200, "Passport retrieved successfully", web_ns.models[PassportAccessTokenResponse.__name__])
    @model_validate(PassportQuery)
    def get(self, query: PassportQuery):
        app_code = request.headers.get(HEADER_NAME_APP_CODE)
        if app_code is None:
            raise Unauthorized("X-App-Code header is missing.")

        passport_request = WebPassportRequest(
            app_code=app_code,
            user_session_id=query.user_id,
            access_token=extract_webapp_access_token(request),
        )
        try:
            result = application_services().web_passport.issue(passport_request)
        except WebPassportAuthenticationRequiredError as exc:
            raise WebAppAuthRequiredError(str(exc)) from exc
        except WebPassportUnauthorizedError as exc:
            raise Unauthorized(str(exc)) from exc
        except WebPassportNotFoundError as exc:
            raise NotFound(str(exc) or None) from exc

        return dump_response(PassportAccessTokenResponse, {"access_token": result.access_token})


@web_ns.route("/passport/account")
class AccountPassportResource(Resource):
    """Explicitly select the signed-in Account without claiming the Guest identity."""

    @web_ns.doc("exchange_account_passport")
    @web_ns.doc(
        description="Exchange the Console login cookie for an app-scoped Account Passport after Account login. "
        "Requires the session CSRF cookie/header pair and WEBAPP_ACCOUNT_PASSPORT_ENABLED. "
        "Does not claim Guest connections or conversations. Use the returned access_token as X-App-Passport.",
    )
    @web_ns.doc(
        params={
            "X-App-Code": {"in": "header", "required": True, "description": "Web app code"},
            "X-CSRF-Token": {"in": "header", "required": True, "description": "Console session CSRF token"},
        }
    )
    @web_ns.response(200, "Account Web App Passport", web_ns.models[PassportAccessTokenResponse.__name__])
    @error_responses(ConnectionLoginRequiredError)
    def post(self):
        if not dify_config.WEBAPP_ACCOUNT_PASSPORT_ENABLED:
            raise NotFound()
        app_code = request.headers.get(HEADER_NAME_APP_CODE)
        if not app_code:
            raise Unauthorized("X-App-Code header is missing.")
        # The App Passport and caller-supplied bearer tokens must never choose the Account.
        access_token = extract_console_cookie_token(request)
        if not access_token:
            raise ConnectionLoginRequiredError()
        try:
            claims = PassportService().verify(access_token)
        except Unauthorized as exc:
            raise ConnectionLoginRequiredError() from exc
        account_id = claims.get("user_id")
        if (
            claims.get("sub") != "Console API Passport"
            or claims.get("token_source") is not None
            or not isinstance(account_id, str)
        ):
            raise ConnectionLoginRequiredError()
        # Authenticate CSRF before creating an Account/App mapping. No workspace
        # admission is required for an End User who only has an Account.
        check_csrf_token(request, account_id)
        try:
            result = application_services().web_passport.issue_for_account(app_code=app_code, access_token=access_token)
        except WebPassportAccountExchangeDisabledError as exc:
            raise NotFound() from exc
        except (WebPassportAuthenticationRequiredError, WebPassportUnauthorizedError) as exc:
            raise ConnectionLoginRequiredError() from exc
        except WebPassportAccessDeniedError as exc:
            raise WebAppAuthAccessDeniedError() from exc
        except WebPassportNotFoundError as exc:
            raise NotFound() from exc
        # response-contract:ignore the Passport response must not be cached by browsers or proxies
        response = make_response(dump_response(PassportAccessTokenResponse, result))
        response.headers["Cache-Control"] = "no-store"
        return response
