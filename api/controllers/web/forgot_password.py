from flask_restx import Resource

from controllers.common.fields import SimpleResultDataResponse, SimpleResultResponse, VerificationTokenResponse
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console.auth.error import (
    AuthenticationFailedError,
    EmailCodeError,
    EmailPasswordResetLimitError,
    InvalidEmailError,
    InvalidTokenError,
    PasswordMismatchError,
    PasswordResetRateLimitExceededError,
)
from controllers.console.error import EmailSendIpLimitError
from controllers.console.wraps import model_validate
from controllers.web import web_ns
from controllers.web.flask_admission import web_anonymous_admission
from enums import DeploymentEdition
from extensions.ext_application_services import application_services
from machinery.context import RequestContext
from services.entities.auth_entities import (
    ForgotPasswordCheckPayload,
    ForgotPasswordResetPayload,
    ForgotPasswordSendPayload,
)
from services.web_authentication_service import (
    WebAuthenticationFailedError,
    WebEmailDeliveryRateLimitError,
    WebEmailSendIPLimitedError,
    WebInvalidCodeError,
    WebInvalidEmailError,
    WebInvalidTokenError,
    WebPasswordMismatchError,
    WebPasswordResetVerificationLimitedError,
)

_ENTERPRISE_ONLY = frozenset({DeploymentEdition.ENTERPRISE})

register_schema_models(web_ns, ForgotPasswordSendPayload, ForgotPasswordCheckPayload, ForgotPasswordResetPayload)
register_response_schema_models(
    web_ns,
    SimpleResultDataResponse,
    SimpleResultResponse,
    VerificationTokenResponse,
)


@web_ns.route("/forgot-password")
class ForgotPasswordSendEmailApi(Resource):
    @web_ns.expect(web_ns.models[ForgotPasswordSendPayload.__name__])
    @web_anonymous_admission(editions=_ENTERPRISE_ONLY, require_email_password_login=True)
    @web_ns.doc("send_forgot_password_email")
    @web_ns.doc(description="Send password reset email")
    @web_ns.doc(
        responses={
            200: "Password reset email sent successfully",
            400: "Bad request - invalid email format",
            404: "Account not found",
            429: "Too many requests - rate limit exceeded",
        }
    )
    @web_ns.response(200, "Password reset email sent successfully", web_ns.models[SimpleResultDataResponse.__name__])
    @model_validate(ForgotPasswordSendPayload)
    def post(self, payload: ForgotPasswordSendPayload, request_context: RequestContext):
        try:
            token = application_services().web_authentication.send_reset_password_email(
                request_context,
                email=payload.email,
                language=payload.language,
            )
        except WebEmailSendIPLimitedError as error:
            raise EmailSendIpLimitError() from error
        except WebAuthenticationFailedError as error:
            raise AuthenticationFailedError() from error
        except WebEmailDeliveryRateLimitError as error:
            raise PasswordResetRateLimitExceededError(error.retry_after_minutes) from error

        return SimpleResultDataResponse(result="success", data=token).model_dump(mode="json")


@web_ns.route("/forgot-password/validity")
class ForgotPasswordCheckApi(Resource):
    @web_ns.expect(web_ns.models[ForgotPasswordCheckPayload.__name__])
    @web_anonymous_admission(editions=_ENTERPRISE_ONLY, require_email_password_login=True)
    @web_ns.doc("check_forgot_password_token")
    @web_ns.doc(description="Verify password reset token validity")
    @web_ns.doc(
        responses={200: "Token is valid", 400: "Bad request - invalid token format", 401: "Invalid or expired token"}
    )
    @web_ns.response(200, "Token is valid", web_ns.models[VerificationTokenResponse.__name__])
    @model_validate(ForgotPasswordCheckPayload)
    def post(self, payload: ForgotPasswordCheckPayload, _request_context: RequestContext):
        try:
            new_token = application_services().web_authentication.verify_reset_password_code(
                email=payload.email,
                code=payload.code,
                token=payload.token,
            )
        except WebPasswordResetVerificationLimitedError as error:
            raise EmailPasswordResetLimitError() from error
        except WebInvalidTokenError as error:
            raise InvalidTokenError() from error
        except WebInvalidEmailError as error:
            raise InvalidEmailError() from error
        except WebInvalidCodeError as error:
            raise EmailCodeError() from error

        return VerificationTokenResponse(
            is_valid=True,
            email=payload.email.lower(),
            token=new_token,
        ).model_dump(mode="json")


@web_ns.route("/forgot-password/resets")
class ForgotPasswordResetApi(Resource):
    @web_ns.expect(web_ns.models[ForgotPasswordResetPayload.__name__])
    @web_anonymous_admission(editions=_ENTERPRISE_ONLY, require_email_password_login=True)
    @web_ns.doc("reset_password")
    @web_ns.doc(description="Reset user password with verification token")
    @web_ns.doc(
        responses={
            200: "Password reset successfully",
            400: "Bad request - invalid parameters or password mismatch",
            401: "Invalid or expired token",
            404: "Account not found",
        }
    )
    @web_ns.response(200, "Password reset successfully", web_ns.models[SimpleResultResponse.__name__])
    @model_validate(ForgotPasswordResetPayload)
    def post(self, payload: ForgotPasswordResetPayload, _request_context: RequestContext):
        try:
            application_services().web_authentication.reset_password(
                token=payload.token,
                new_password=payload.new_password,
                password_confirmation=payload.password_confirm,
            )
        except WebPasswordMismatchError as error:
            raise PasswordMismatchError() from error
        except WebInvalidTokenError as error:
            raise InvalidTokenError() from error
        except WebAuthenticationFailedError as error:
            raise AuthenticationFailedError() from error

        return SimpleResultResponse(result="success").model_dump(mode="json")
