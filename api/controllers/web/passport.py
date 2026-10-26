from flask import Response, after_this_request, make_response, request
from flask_restx import Resource
from pydantic import BaseModel, Field
from werkzeug.exceptions import Forbidden, NotFound, Unauthorized

from constants import HEADER_NAME_APP_CODE
from controllers.common.end_user_connections import ConnectionLoginRequiredError
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.common.web_login import WebLoginUnavailableHTTPError, web_login_errors
from controllers.console.wraps import model_validate
from controllers.web import web_ns
from controllers.web.error import WebAppAuthAccessDeniedError, WebAppAuthRequiredError
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.external_api import error_responses
from libs.helper import dump_response
from libs.token import extract_webapp_access_token
from services.entities.account_login_entities import LoginMode
from services.entities.passport_entities import WebPassportRequest
from services.web_passport_service import (
    WebPassportAccessDeniedError,
    WebPassportAccountExchangeDisabledError,
    WebPassportAuthenticationRequiredError,
    WebPassportNotFoundError,
    WebPassportUnauthorizedError,
)


class PassportQuery(BaseModel):
    mode: LoginMode = Field(
        default=LoginMode.CONSOLE,
        description="end_user reuses Account login; console preserves legacy Web App authentication",
    )
    user_id: str | None = Field(default=None, description="End user session ID")


class PassportLoginPayload(BaseModel):
    login_code: str = Field(min_length=1, max_length=256)
    code_verifier: str = Field(pattern=r"^[A-Za-z0-9._~-]{43,128}$", repr=False)


register_schema_models(web_ns, PassportQuery, PassportLoginPayload)


class PassportAccessTokenResponse(ResponseModel):
    access_token: str


class PassportLoginResponse(PassportAccessTokenResponse):
    webapp_access_token: str = Field(
        description="Web-only login proof for subsequent login-status and Passport requests; never a Console token"
    )


register_response_schema_models(web_ns, PassportAccessTokenResponse, PassportLoginResponse)


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
    @error_responses(ConnectionLoginRequiredError)
    @model_validate(PassportQuery)
    def get(self, query: PassportQuery):
        app_code = request.headers.get(HEADER_NAME_APP_CODE)
        if app_code is None:
            raise Unauthorized("X-App-Code header is missing.")

        passport_request = WebPassportRequest(
            app_code=app_code,
            user_session_id=query.user_id,
            access_token=extract_webapp_access_token(request),
            mode=query.mode,
        )
        try:
            result = application_services().web_passport.issue(passport_request)
        except WebPassportAuthenticationRequiredError as exc:
            if query.mode == LoginMode.END_USER:
                raise ConnectionLoginRequiredError() from exc
            raise WebAppAuthRequiredError(str(exc)) from exc
        except WebPassportUnauthorizedError as exc:
            if query.mode == LoginMode.END_USER:
                raise ConnectionLoginRequiredError() from exc
            raise Unauthorized(str(exc)) from exc
        except WebPassportAccountExchangeDisabledError as exc:
            raise Forbidden("End User login is not enabled.") from exc
        except WebPassportAccessDeniedError as exc:
            raise WebAppAuthAccessDeniedError() from exc
        except WebPassportNotFoundError as exc:
            raise NotFound(str(exc) or None) from exc

        @after_this_request
        def prevent_cache(response: Response) -> Response:
            response.headers["Cache-Control"] = "no-store"
            return response

        return dump_response(PassportAccessTokenResponse, result)

    @web_ns.doc("exchange_web_app_login")
    @web_ns.doc(
        description="Redeem a one-use S256 PKCE login code after returning to /webapp-signin. "
        "Returns the App Passport and a Web-only login proof for subsequent visits."
    )
    @web_ns.doc(params={"X-App-Code": {"in": "header", "required": True, "description": "Web app code"}})
    @web_ns.expect(web_ns.models[PassportLoginPayload.__name__])
    @web_ns.response(200, "Web login completed", web_ns.models[PassportLoginResponse.__name__])
    @error_responses(ConnectionLoginRequiredError, WebLoginUnavailableHTTPError)
    @model_validate(PassportLoginPayload)
    def post(self, payload: PassportLoginPayload):
        app_code = request.headers.get(HEADER_NAME_APP_CODE)
        if not app_code:
            raise Unauthorized("X-App-Code header is missing.")
        with web_login_errors():
            login_token = application_services().web_login_handoff.redeem(
                app_code=app_code, code=payload.login_code, code_verifier=payload.code_verifier
            )
            try:
                result = application_services().web_passport.issue(
                    WebPassportRequest(
                        app_code=app_code, user_session_id=None, access_token=login_token, mode=LoginMode.END_USER
                    )
                )
            except WebPassportAccessDeniedError as exc:
                raise WebAppAuthAccessDeniedError() from exc
            except WebPassportAuthenticationRequiredError as exc:
                raise ConnectionLoginRequiredError() from exc
        # response-contract:ignore credential-bearing response
        response = make_response(
            dump_response(
                PassportLoginResponse,
                {
                    "access_token": result.access_token,
                    "webapp_access_token": login_token,
                },
            )
        )
        response.headers["Cache-Control"] = "no-store"
        return response
