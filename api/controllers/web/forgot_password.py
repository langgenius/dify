import base64
import secrets

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from controllers.common.schema import register_schema_models
from controllers.console.auth.error import (
    AuthenticationFailedError,
    EmailCodeError,
    EmailPasswordResetLimitError,
    InvalidEmailError,
    InvalidTokenError,
    PasswordMismatchError,
)
from controllers.console.error import EmailSendIpLimitError
from controllers.console.wraps import email_password_login_enabled, only_edition_enterprise, setup_required
from controllers.web import web_ns
from extensions.ext_database import db
from libs.helper import EmailStr, extract_remote_ip
from libs.password import hash_password, valid_password
from models.account import Account
from services.account_service import AccountService


class ForgotPasswordSendPayload(BaseModel):
    email: EmailStr
    language: str | None = None


class ForgotPasswordCheckPayload(BaseModel):
    email: EmailStr
    code: str
    token: str = Field(min_length=1)


class ForgotPasswordResetPayload(BaseModel):
    token: str = Field(min_length=1)
    new_password: str
    password_confirm: str

    @field_validator("new_password", "password_confirm")
    @classmethod
    def validate_password(cls, value: str) -> str:
        return valid_password(value)


register_schema_models(web_ns, ForgotPasswordSendPayload, ForgotPasswordCheckPayload, ForgotPasswordResetPayload)


@web_ns.route("/forgot-password")
class ForgotPasswordSendEmailApi(Resource):
    @web_ns.expect(web_ns.models[ForgotPasswordSendPayload.__name__])
    @only_edition_enterprise
    @setup_required
    @email_password_login_enabled
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
    def post(self):
        payload = ForgotPasswordSendPayload.model_validate(web_ns.payload or {})

        request_email = payload.email
        normalized_email = request_email.lower()

        ip_address = extract_remote_ip(request)
        if AccountService.is_email_send_ip_limit(ip_address):
            raise EmailSendIpLimitError()

        if payload.language == "zh-Hans":
            language = "zh-Hans"
        else:
            language = "en-US"

        with Session(db.engine) as session:
            account = AccountService.get_account_by_email_with_case_fallback(request_email, session=session)
        token = None
        if account is None:
            raise AuthenticationFailedError()
        else:
            token = AccountService.send_reset_password_email(account=account, email=normalized_email, language=language)

        return {"result": "success", "data": token}


@web_ns.route("/forgot-password/validity")
class ForgotPasswordCheckApi(Resource):
    @web_ns.expect(web_ns.models[ForgotPasswordCheckPayload.__name__])
    @only_edition_enterprise
    @setup_required
    @email_password_login_enabled
    @web_ns.doc("check_forgot_password_token")
    @web_ns.doc(description="Verify password reset token validity")
    @web_ns.doc(
        responses={200: "Token is valid", 400: "Bad request - invalid token format", 401: "Invalid or expired token"}
    )
    def post(self):
        payload = ForgotPasswordCheckPayload.model_validate(web_ns.payload or {})

        user_email = payload.email.lower()

        is_forgot_password_error_rate_limit = AccountService.is_forgot_password_error_rate_limit(user_email)
        if is_forgot_password_error_rate_limit:
            raise EmailPasswordResetLimitError()

        token_data = AccountService.get_reset_password_data(payload.token)
        if token_data is None:
            raise InvalidTokenError()

        token_email = token_data.get("email")
        if not isinstance(token_email, str):
            raise InvalidEmailError()
        normalized_token_email = token_email.lower()

        if user_email != normalized_token_email:
            raise InvalidEmailError()

        if payload.code != token_data.get("code"):
            AccountService.add_forgot_password_error_rate_limit(user_email)
            raise EmailCodeError()

        # Verified, revoke the first token
        AccountService.revoke_reset_password_token(payload.token)

        # Refresh token data by generating a new token
        _, new_token = AccountService.generate_reset_password_token(
            token_email, code=payload.code, additional_data={"phase": "reset"}
        )

        AccountService.reset_forgot_password_error_rate_limit(user_email)
        return {"is_valid": True, "email": normalized_token_email, "token": new_token}


@web_ns.route("/forgot-password/resets")
class ForgotPasswordResetApi(Resource):
    @web_ns.expect(web_ns.models[ForgotPasswordResetPayload.__name__])
    @only_edition_enterprise
    @setup_required
    @email_password_login_enabled
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
    def post(self):
        payload = ForgotPasswordResetPayload.model_validate(web_ns.payload or {})

        # Validate passwords match
        if payload.new_password != payload.password_confirm:
            raise PasswordMismatchError()

        # Validate token and get reset data
        reset_data = AccountService.get_reset_password_data(payload.token)
        if not reset_data:
            raise InvalidTokenError()
        # Must use token in reset phase
        if reset_data.get("phase", "") != "reset":
            raise InvalidTokenError()

        # Revoke token to prevent reuse
        AccountService.revoke_reset_password_token(payload.token)

        # Generate secure salt and hash password
        salt = secrets.token_bytes(16)
        password_hashed = hash_password(payload.new_password, salt)

        email = reset_data.get("email", "")

        with Session(db.engine) as session:
            account = AccountService.get_account_by_email_with_case_fallback(email, session=session)

            if account:
                self._update_existing_account(account, password_hashed, salt, session)
            else:
                raise AuthenticationFailedError()

        return {"result": "success"}

    def _update_existing_account(self, account: Account, password_hashed, salt, session):
        # Update existing account credentials
        account.password = base64.b64encode(password_hashed).decode()
        account.password_salt = base64.b64encode(salt).decode()
        session.commit()
