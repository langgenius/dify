import base64
import secrets

from flask import request
from flask_restx import Resource, fields
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from controllers.console import console_ns
from controllers.console.auth.error import (
    EmailCodeError,
    EmailPasswordResetLimitError,
    InvalidEmailError,
    InvalidTokenError,
    PasswordMismatchError,
)
from controllers.console.error import AccountNotFound, EmailSendIpLimitError
from controllers.console.wraps import email_password_login_enabled, setup_required
from events.tenant_event import tenant_was_created
from extensions.ext_database import db
from libs.helper import EmailStr, extract_remote_ip
from libs.password import hash_password, valid_password
from services.account_service import AccountService, TenantService
from services.feature_service import FeatureService

DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


class ForgotPasswordSendPayload(BaseModel):
    email: EmailStr = Field(...)
    language: str | None = Field(default=None)


class ForgotPasswordCheckPayload(BaseModel):
    email: EmailStr = Field(...)
    code: str = Field(...)
    token: str = Field(...)


class ForgotPasswordResetPayload(BaseModel):
    token: str = Field(...)
    new_password: str = Field(...)
    password_confirm: str = Field(...)

    @field_validator("new_password", "password_confirm")
    @classmethod
    def validate_password(cls, value: str) -> str:
        return valid_password(value)


for model in (ForgotPasswordSendPayload, ForgotPasswordCheckPayload, ForgotPasswordResetPayload):
    console_ns.schema_model(model.__name__, model.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0))


@console_ns.route("/forgot-password")
class ForgotPasswordSendEmailApi(Resource):
    @console_ns.doc("send_forgot_password_email")
    @console_ns.doc(description="Send password reset email")
    @console_ns.expect(console_ns.models[ForgotPasswordSendPayload.__name__])
    @console_ns.response(
        200,
        "Email sent successfully",
        console_ns.model(
            "ForgotPasswordEmailResponse",
            {
                "result": fields.String(description="Operation result"),
                "data": fields.String(description="Reset token"),
                "code": fields.String(description="Error code if account not found"),
            },
        ),
    )
    @console_ns.response(400, "Invalid email or rate limit exceeded")
    @setup_required
    @email_password_login_enabled
    def post(self):
        args = ForgotPasswordSendPayload.model_validate(console_ns.payload)
        normalized_email = args.email.lower()

        ip_address = extract_remote_ip(request)
        if AccountService.is_email_send_ip_limit(ip_address):
            raise EmailSendIpLimitError()

        if args.language is not None and args.language == "zh-Hans":
            language = "zh-Hans"
        else:
            language = "en-US"

        with Session(db.engine) as session:
            account = AccountService.get_account_by_email_with_case_fallback(args.email, session=session)

        token = AccountService.send_reset_password_email(
            account=account,
            email=normalized_email,
            language=language,
            is_allow_register=FeatureService.get_system_features().is_allow_register,
        )

        return {"result": "success", "data": token}


@console_ns.route("/forgot-password/validity")
class ForgotPasswordCheckApi(Resource):
    @console_ns.doc("check_forgot_password_code")
    @console_ns.doc(description="Verify password reset code")
    @console_ns.expect(console_ns.models[ForgotPasswordCheckPayload.__name__])
    @console_ns.response(
        200,
        "Code verified successfully",
        console_ns.model(
            "ForgotPasswordCheckResponse",
            {
                "is_valid": fields.Boolean(description="Whether code is valid"),
                "email": fields.String(description="Email address"),
                "token": fields.String(description="New reset token"),
            },
        ),
    )
    @console_ns.response(400, "Invalid code or token")
    @setup_required
    @email_password_login_enabled
    def post(self):
        args = ForgotPasswordCheckPayload.model_validate(console_ns.payload)

        user_email = args.email.lower()

        is_forgot_password_error_rate_limit = AccountService.is_forgot_password_error_rate_limit(user_email)
        if is_forgot_password_error_rate_limit:
            raise EmailPasswordResetLimitError()

        token_data = AccountService.get_reset_password_data(args.token)
        if token_data is None:
            raise InvalidTokenError()

        token_email = token_data.get("email")
        if not isinstance(token_email, str):
            raise InvalidEmailError()
        normalized_token_email = token_email.lower()

        if user_email != normalized_token_email:
            raise InvalidEmailError()

        if args.code != token_data.get("code"):
            AccountService.add_forgot_password_error_rate_limit(user_email)
            raise EmailCodeError()

        # Verified, revoke the first token
        AccountService.revoke_reset_password_token(args.token)

        # Refresh token data by generating a new token
        _, new_token = AccountService.generate_reset_password_token(
            token_email, code=args.code, additional_data={"phase": "reset"}
        )

        AccountService.reset_forgot_password_error_rate_limit(user_email)
        return {"is_valid": True, "email": normalized_token_email, "token": new_token}


@console_ns.route("/forgot-password/resets")
class ForgotPasswordResetApi(Resource):
    @console_ns.doc("reset_password")
    @console_ns.doc(description="Reset password with verification token")
    @console_ns.expect(console_ns.models[ForgotPasswordResetPayload.__name__])
    @console_ns.response(
        200,
        "Password reset successfully",
        console_ns.model("ForgotPasswordResetResponse", {"result": fields.String(description="Operation result")}),
    )
    @console_ns.response(400, "Invalid token or password mismatch")
    @setup_required
    @email_password_login_enabled
    def post(self):
        args = ForgotPasswordResetPayload.model_validate(console_ns.payload)

        # Validate passwords match
        if args.new_password != args.password_confirm:
            raise PasswordMismatchError()

        # Validate token and get reset data
        reset_data = AccountService.get_reset_password_data(args.token)
        if not reset_data:
            raise InvalidTokenError()
        # Must use token in reset phase
        if reset_data.get("phase", "") != "reset":
            raise InvalidTokenError()

        # Revoke token to prevent reuse
        AccountService.revoke_reset_password_token(args.token)

        # Generate secure salt and hash password
        salt = secrets.token_bytes(16)
        password_hashed = hash_password(args.new_password, salt)

        email = reset_data.get("email", "")
        with Session(db.engine) as session:
            account = AccountService.get_account_by_email_with_case_fallback(email, session=session)

            if account:
                self._update_existing_account(account, password_hashed, salt, session)
            else:
                raise AccountNotFound()

        return {"result": "success"}

    def _update_existing_account(self, account, password_hashed, salt, session):
        # Update existing account credentials
        account.password = base64.b64encode(password_hashed).decode()
        account.password_salt = base64.b64encode(salt).decode()
        session.commit()

        # Create workspace if needed
        if (
            not TenantService.get_join_tenants(account)
            and FeatureService.get_system_features().is_allow_create_workspace
        ):
            tenant = TenantService.create_tenant(f"{account.name}'s Workspace")
            TenantService.create_tenant_member(tenant, account, role="owner")
            account.current_tenant = tenant
            tenant_was_created.send(tenant)
