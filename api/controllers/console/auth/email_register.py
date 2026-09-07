from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator

from controllers.common.fields import SimpleResultDataResponse, VerificationTokenResponse
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.auth.error import (
    EmailAlreadyInUseError,
    EmailCodeError,
    EmailRegisterLimitError,
    EmailRegisterRateLimitExceededError,
    InvalidEmailError,
    InvalidTokenError,
    NormalizedEmailAlreadyInUseError,
    PasswordMismatchError,
)
from controllers.console.flask_admission import console_email_registration_admission
from controllers.console.wraps import model_validate
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.helper import EmailStr, dump_response, extract_remote_ip
from libs.helper import timezone as validate_timezone_string
from libs.password import valid_password
from services.account_errors import (
    AccountEmailAlreadyInUseError,
    AccountEmailDomainSuspendedError,
    AccountEmailFrozenError,
    AccountNormalizedEmailAlreadyInUseError,
    EmailRegistrationPasswordMismatchError,
    EmailRegistrationSeatsLimitError,
    EmailRegistrationSendIPLimitedError,
    EmailRegistrationSendRateLimitError,
    EmailRegistrationVerificationLimitError,
    InvalidEmailRegistrationAddressError,
    InvalidEmailRegistrationCodeError,
    InvalidEmailRegistrationTokenError,
)

from ..error import AccountInFreezeError, EmailDomainSuspendedError, EmailSendIpLimitError, SeatsLimitExceeded


class EmailRegisterSendPayload(BaseModel):
    email: EmailStr = Field(..., description="Email address")
    language: str | None = Field(default=None, description="Language code")


class EmailRegisterValidityPayload(BaseModel):
    email: EmailStr = Field(...)
    code: str = Field(...)
    token: str = Field(...)


class EmailRegisterResetPayload(BaseModel):
    token: str = Field(...)
    new_password: str = Field(...)
    password_confirm: str = Field(...)
    language: str | None = Field(default=None)
    timezone: str | None = Field(default=None)

    @field_validator("new_password", "password_confirm")
    @classmethod
    def validate_password(cls, value: str) -> str:
        return valid_password(value)

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return validate_timezone_string(value)


class EmailRegisterTokenPairResponse(ResponseModel):
    access_token: str
    refresh_token: str
    csrf_token: str


class EmailRegisterResetResponse(ResponseModel):
    result: str
    data: EmailRegisterTokenPairResponse


register_schema_models(console_ns, EmailRegisterSendPayload, EmailRegisterValidityPayload, EmailRegisterResetPayload)
register_response_schema_models(
    console_ns,
    SimpleResultDataResponse,
    VerificationTokenResponse,
    EmailRegisterResetResponse,
)


@console_ns.route("/email-register/send-email")
class EmailRegisterSendEmailApi(Resource):
    @console_ns.expect(console_ns.models[EmailRegisterSendPayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[SimpleResultDataResponse.__name__])
    @console_email_registration_admission
    @model_validate(EmailRegisterSendPayload)
    def post(self, args: EmailRegisterSendPayload):
        try:
            token = application_services().accounts.email_registration.send_code(
                remote_ip=extract_remote_ip(request),
                requested_email=args.email,
                requested_language=args.language,
            )
        except EmailRegistrationSendIPLimitedError:
            raise EmailSendIpLimitError() from None
        except EmailRegistrationSendRateLimitError as error:
            raise EmailRegisterRateLimitExceededError(error.retry_after_minutes) from None
        except AccountEmailDomainSuspendedError:
            raise EmailDomainSuspendedError() from None
        except AccountEmailFrozenError:
            raise AccountInFreezeError() from None
        return dump_response(SimpleResultDataResponse, {"result": "success", "data": token})


@console_ns.route("/email-register/validity")
class EmailRegisterCheckApi(Resource):
    @console_ns.expect(console_ns.models[EmailRegisterValidityPayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[VerificationTokenResponse.__name__])
    @console_email_registration_admission
    @model_validate(EmailRegisterValidityPayload)
    def post(self, args: EmailRegisterValidityPayload):
        try:
            verification = application_services().accounts.email_registration.verify_code(
                email=args.email,
                code=args.code,
                token=args.token,
            )
        except EmailRegistrationVerificationLimitError:
            raise EmailRegisterLimitError() from None
        except InvalidEmailRegistrationTokenError:
            raise InvalidTokenError() from None
        except InvalidEmailRegistrationAddressError:
            raise InvalidEmailError() from None
        except InvalidEmailRegistrationCodeError:
            raise EmailCodeError() from None
        return dump_response(
            VerificationTokenResponse,
            {
                "is_valid": True,
                "email": verification.email,
                "token": verification.token,
            },
        )


@console_ns.route("/email-register")
class EmailRegisterResetApi(Resource):
    @console_ns.expect(console_ns.models[EmailRegisterResetPayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[EmailRegisterResetResponse.__name__])
    @console_email_registration_admission
    @model_validate(EmailRegisterResetPayload)
    def post(self, args: EmailRegisterResetPayload):
        try:
            token_pair = application_services().accounts.email_registration.register(
                remote_ip=extract_remote_ip(request),
                token=args.token,
                new_password=args.new_password,
                password_confirm=args.password_confirm,
                language=args.language,
                timezone=args.timezone,
            )
        except EmailRegistrationPasswordMismatchError:
            raise PasswordMismatchError() from None
        except InvalidEmailRegistrationTokenError:
            raise InvalidTokenError() from None
        except AccountNormalizedEmailAlreadyInUseError:
            raise NormalizedEmailAlreadyInUseError() from None
        except AccountEmailAlreadyInUseError:
            raise EmailAlreadyInUseError() from None
        except EmailRegistrationSeatsLimitError:
            raise SeatsLimitExceeded() from None
        except AccountEmailDomainSuspendedError:
            raise EmailDomainSuspendedError() from None
        except AccountEmailFrozenError:
            raise AccountInFreezeError() from None

        return dump_response(
            EmailRegisterResetResponse,
            {"result": "success", "data": token_pair},
        )
