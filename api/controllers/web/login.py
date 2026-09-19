from flask import make_response, request
from flask_restx import Resource
from jwt import InvalidTokenError
from pydantic import BaseModel, Field, field_validator
from werkzeug.exceptions import Unauthorized

from controllers.common.fields import (
    AccessTokenData,
    AccessTokenResultResponse,
    LoginStatusResponse,
    SimpleResultDataResponse,
    SimpleResultResponse,
)
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console.auth.error import (
    AuthenticationFailedError,
    EmailCodeError,
    InvalidEmailError,
)
from controllers.console.error import AccountBannedError
from controllers.console.wraps import (
    decrypt_code_field,
    decrypt_password_field,
    model_validate,
)
from controllers.web import web_ns
from controllers.web.flask_admission import web_anonymous_admission
from enums import DeploymentEdition
from extensions.ext_application_services import application_services
from libs.helper import EmailStr
from libs.password import valid_password
from libs.token import (
    clear_webapp_access_token_from_cookie,
    extract_webapp_access_token,
    extract_webapp_passport,
)
from machinery.context import RequestContext
from services.entities.auth_entities import LoginPayloadBase
from services.web_authentication_service import (
    WebAccountBannedError,
    WebAuthenticationFailedError,
    WebInvalidCodeError,
    WebInvalidEmailError,
    WebInvalidTokenError,
)

_ENTERPRISE_ONLY = frozenset({DeploymentEdition.ENTERPRISE})


class LoginPayload(LoginPayloadBase):
    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        return valid_password(value)


class EmailCodeLoginSendPayload(BaseModel):
    email: EmailStr
    language: str | None = None


class EmailCodeLoginVerifyPayload(BaseModel):
    email: EmailStr
    code: str
    token: str = Field(min_length=1)


class LoginStatusQuery(BaseModel):
    app_code: str | None = Field(default=None, description="Web app code")
    user_id: str | None = Field(default=None, description="End user session ID")


register_schema_models(web_ns, LoginPayload, EmailCodeLoginSendPayload, EmailCodeLoginVerifyPayload, LoginStatusQuery)
register_response_schema_models(
    web_ns,
    AccessTokenResultResponse,
    LoginStatusResponse,
    SimpleResultDataResponse,
    SimpleResultResponse,
)


@web_ns.route("/login")
class LoginApi(Resource):
    """Resource for web app email/password login."""

    @web_ns.expect(web_ns.models[LoginPayload.__name__])
    @web_anonymous_admission(editions=_ENTERPRISE_ONLY)
    @web_ns.doc("web_app_login")
    @web_ns.doc(description="Authenticate user for web application access")
    @web_ns.doc(
        responses={
            200: "Authentication successful",
            400: "Bad request - invalid email or password format",
            401: "Authentication failed - email or password mismatch",
            403: "Account banned or login disabled",
            404: "Account not found",
        }
    )
    @web_ns.response(200, "Authentication successful", web_ns.models[AccessTokenResultResponse.__name__])
    @decrypt_password_field
    @model_validate(LoginPayload)
    def post(self, payload: LoginPayload, request_context: RequestContext):
        """Authenticate user and login."""
        try:
            token = application_services().web_authentication.login_with_password(
                request_context,
                email=payload.email,
                password=payload.password,
            )
        except WebAccountBannedError as error:
            raise AccountBannedError() from error
        except WebAuthenticationFailedError as error:
            raise AuthenticationFailedError() from error

        # set_access_token_to_cookie(request, response, token, samesite="None", httponly=False)
        return AccessTokenResultResponse(result="success", data=AccessTokenData(access_token=token)).model_dump(
            mode="json"
        )


# this api helps frontend to check whether user is authenticated
# TODO: remove in the future. frontend should redirect to login page by catching 401 status
@web_ns.route("/login/status")
class LoginStatusApi(Resource):
    @web_anonymous_admission()
    @web_ns.doc("web_app_login_status")
    @web_ns.doc(description="Check login status")
    @web_ns.doc(params=query_params_from_model(LoginStatusQuery))
    @web_ns.doc(
        responses={
            200: "Login status",
            401: "Login status",
        }
    )
    @web_ns.response(200, "Login status", web_ns.models[LoginStatusResponse.__name__])
    @model_validate(LoginStatusQuery)
    def get(self, query: LoginStatusQuery, _request_context: RequestContext):
        status = application_services().web_authentication.get_login_status(
            app_code=query.app_code,
            user_id=query.user_id,
            access_token=extract_webapp_access_token(request),
            app_session_token=extract_webapp_passport(query.app_code, request) if query.app_code else None,
        )
        return LoginStatusResponse(
            logged_in=status.logged_in,
            app_logged_in=status.app_logged_in,
        ).model_dump(mode="json")


@web_ns.route("/logout")
class LogoutApi(Resource):
    @web_anonymous_admission()
    @web_ns.doc("web_app_logout")
    @web_ns.doc(description="Logout user from web application")
    @web_ns.doc(
        responses={
            200: "Logout successful",
        }
    )
    @web_ns.response(200, "Logout successful", web_ns.models[SimpleResultResponse.__name__])
    def post(self, _request_context: RequestContext):
        # response-contract:ignore hand-crafted response
        response = make_response(SimpleResultResponse(result="success").model_dump(mode="json"))
        # enterprise SSO sets same site to None in https deployment
        # so we need to logout by calling api
        clear_webapp_access_token_from_cookie(response, samesite="None")
        return response


@web_ns.route("/email-code-login")
class EmailCodeLoginSendEmailApi(Resource):
    @web_anonymous_admission(editions=_ENTERPRISE_ONLY)
    @web_ns.doc("send_email_code_login")
    @web_ns.doc(description="Send email verification code for login")
    @web_ns.expect(web_ns.models[EmailCodeLoginSendPayload.__name__])
    @web_ns.doc(
        responses={
            200: "Email code sent successfully",
            400: "Bad request - invalid email format",
            404: "Account not found",
        }
    )
    @web_ns.response(200, "Email code sent successfully", web_ns.models[SimpleResultDataResponse.__name__])
    @model_validate(EmailCodeLoginSendPayload)
    def post(self, payload: EmailCodeLoginSendPayload, _request_context: RequestContext):
        try:
            token = application_services().web_authentication.send_email_login_code(
                email=payload.email,
                language=payload.language,
            )
        except WebAccountBannedError as error:
            raise Unauthorized("Account is banned.") from error
        except WebAuthenticationFailedError as error:
            raise AuthenticationFailedError() from error
        return SimpleResultDataResponse(result="success", data=token).model_dump(mode="json")


@web_ns.route("/email-code-login/validity")
class EmailCodeLoginApi(Resource):
    @web_anonymous_admission(editions=_ENTERPRISE_ONLY)
    @web_ns.doc("verify_email_code_login")
    @web_ns.doc(description="Verify email code and complete login")
    @web_ns.expect(web_ns.models[EmailCodeLoginVerifyPayload.__name__])
    @web_ns.doc(
        responses={
            200: "Email code verified and login successful",
            400: "Bad request - invalid code or token",
            401: "Invalid token or expired code",
            404: "Account not found",
        }
    )
    @web_ns.response(
        200,
        "Email code verified and login successful",
        web_ns.models[AccessTokenResultResponse.__name__],
    )
    @decrypt_code_field
    @model_validate(EmailCodeLoginVerifyPayload)
    def post(self, payload: EmailCodeLoginVerifyPayload, request_context: RequestContext):
        try:
            token = application_services().web_authentication.login_with_email_code(
                request_context,
                email=payload.email,
                code=payload.code,
                token=payload.token,
            )
        except WebInvalidTokenError as error:
            raise InvalidTokenError() from error
        except WebInvalidEmailError as error:
            raise InvalidEmailError() from error
        except WebInvalidCodeError as error:
            raise EmailCodeError() from error
        except WebAccountBannedError as error:
            raise AccountBannedError() from error
        except WebAuthenticationFailedError as error:
            raise AuthenticationFailedError() from error

        # set_access_token_to_cookie(request, response, token, samesite="None", httponly=False)
        return AccessTokenResultResponse(result="success", data=AccessTokenData(access_token=token)).model_dump(
            mode="json"
        )
