from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator

from configs import dify_config
from constants.languages import get_valid_language, languages
from controllers.common.fields import SimpleResultDataResponse, VerificationTokenResponse
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.auth.error import (
    EmailAlreadyInUseError,
    EmailCodeError,
    EmailRegisterLimitError,
    InvalidEmailError,
    InvalidTokenError,
    PasswordMismatchError,
)
from enums import DeploymentEdition
from extensions.ext_database import db
from fields.base import ResponseModel
from libs.helper import EmailStr, extract_remote_ip
from libs.helper import timezone as validate_timezone_string
from libs.password import valid_password
from models import Account
from services.account_service import AccountService
from services.billing_service import BillingService
from services.errors.account import (
    AccountRegisterError,
    SeatsLimitExceededError,
)
from services.errors.account import (
    EmailDomainSuspendedError as EmailDomainSuspendedRegistrationError,
)

from ..error import AccountInFreezeError, EmailDomainSuspendedError, EmailSendIpLimitError, SeatsLimitExceeded
from ..wraps import email_password_login_enabled, email_register_enabled, model_validate, setup_required


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
    @setup_required
    @email_password_login_enabled
    @email_register_enabled
    @console_ns.expect(console_ns.models[EmailRegisterSendPayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[SimpleResultDataResponse.__name__])
    @model_validate(EmailRegisterSendPayload)
    def post(self, req_data: EmailRegisterSendPayload):
        normalized_email = req_data.email.lower()

        ip_address = extract_remote_ip(request)
        if AccountService.is_email_send_ip_limit(ip_address):
            raise EmailSendIpLimitError()
        language = "en-US"
        if req_data.language is not None and req_data.language in languages:
            language = req_data.language

        if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD:
            freeze_type = BillingService.get_email_freeze_type(normalized_email)
            if freeze_type:
                if freeze_type == "email_domain_suspended":
                    raise EmailDomainSuspendedError()
                raise AccountInFreezeError()

        account = AccountService.get_account_by_email_with_case_fallback(req_data.email, session=db.session())
        token = AccountService.send_email_register_email(email=normalized_email, account=account, language=language)
        return {"result": "success", "data": token}


@console_ns.route("/email-register/validity")
class EmailRegisterCheckApi(Resource):
    @setup_required
    @email_password_login_enabled
    @email_register_enabled
    @console_ns.expect(console_ns.models[EmailRegisterValidityPayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[VerificationTokenResponse.__name__])
    @model_validate(EmailRegisterValidityPayload)
    def post(self, req_data: EmailRegisterValidityPayload):

        user_email = req_data.email.lower()

        is_email_register_error_rate_limit = AccountService.is_email_register_error_rate_limit(user_email)
        if is_email_register_error_rate_limit:
            raise EmailRegisterLimitError()

        token_data = AccountService.get_email_register_data(req_data.token)
        if token_data is None:
            raise InvalidTokenError()

        token_email = token_data.get("email")
        normalized_token_email = token_email.lower() if isinstance(token_email, str) else token_email

        if user_email != normalized_token_email:
            raise InvalidEmailError()

        if req_data.code != token_data.get("code"):
            AccountService.add_email_register_error_rate_limit(user_email)
            raise EmailCodeError()

        # Verified, revoke the first token
        AccountService.revoke_email_register_token(req_data.token)

        # Refresh token data by generating a new token
        _, new_token = AccountService.generate_email_register_token(
            user_email, code=req_data.code, additional_data={"phase": "register"}
        )

        AccountService.reset_email_register_error_rate_limit(user_email)
        return {"is_valid": True, "email": normalized_token_email, "token": new_token}


@console_ns.route("/email-register")
class EmailRegisterResetApi(Resource):
    @setup_required
    @email_password_login_enabled
    @email_register_enabled
    @console_ns.expect(console_ns.models[EmailRegisterResetPayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[EmailRegisterResetResponse.__name__])
    @model_validate(EmailRegisterResetPayload)
    def post(self, req_data: EmailRegisterResetPayload):

        # Validate passwords match
        if req_data.new_password != req_data.password_confirm:
            raise PasswordMismatchError()

        # Validate token and get register data
        register_data = AccountService.get_email_register_data(req_data.token)
        if not register_data:
            raise InvalidTokenError()
        # Must use token in reset phase
        if register_data.get("phase", "") != "register":
            raise InvalidTokenError()

        # Revoke token to prevent reuse
        AccountService.revoke_email_register_token(req_data.token)

        email = register_data.get("email", "")
        normalized_email = email.lower()

        account = AccountService.get_account_by_email_with_case_fallback(email, session=db.session())

        if account:
            raise EmailAlreadyInUseError()

        ip_address = extract_remote_ip(request)
        account = self._create_new_account(
            email=normalized_email,
            password=req_data.password_confirm,
            timezone=req_data.timezone,
            language=req_data.language,
            ip_address=ip_address,
        )
        token_pair = AccountService.login(account=account, session=db.session(), ip_address=ip_address)
        AccountService.reset_login_error_rate_limit(normalized_email)

        return {"result": "success", "data": token_pair.model_dump()}

    def _create_new_account(
        self,
        email: str,
        password: str,
        timezone: str | None = None,
        language: str | None = None,
        ip_address: str | None = None,
    ) -> Account:
        try:
            return AccountService.create_account_and_tenant(
                email=email,
                name=email,
                password=password,
                interface_language=get_valid_language(language),
                timezone=timezone,
                ip_address=ip_address,
                session=db.session(),
            )
        except SeatsLimitExceededError:
            raise SeatsLimitExceeded()
        except EmailDomainSuspendedRegistrationError as exc:
            raise EmailDomainSuspendedError() from exc
        except AccountRegisterError as exc:
            raise AccountInFreezeError() from exc
