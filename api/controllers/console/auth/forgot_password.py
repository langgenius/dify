import base64
import secrets

from flask import request
from flask_restx import Resource, fields, reqparse
from sqlalchemy import select
from sqlalchemy.orm import Session

from controllers.console import api, console_ns
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
from libs.helper import email, extract_remote_ip
from libs.password import hash_password, valid_password
from models import Account
from services.account_service import AccountService, TenantService
from services.feature_service import FeatureService


@console_ns.route("/forgot-password")
class ForgotPasswordSendEmailApi(Resource):
    @api.doc("send_forgot_password_email")
    @api.doc(description="Send password reset email")
    @api.expect(
        api.model(
            "ForgotPasswordEmailRequest",
            {
                "email": fields.String(required=True, description="Email address"),
                "language": fields.String(description="Language for email (zh-Hans/en-US)"),
            },
        )
    )
    @api.response(
        200,
        "Email sent successfully",
        api.model(
            "ForgotPasswordEmailResponse",
            {
                "result": fields.String(description="Operation result"),
                "data": fields.String(description="Reset token"),
                "code": fields.String(description="Error code if account not found"),
            },
        ),
    )
    @api.response(400, "Invalid email or rate limit exceeded")
    @setup_required
    @email_password_login_enabled
    def post(self):
        parser = (
            reqparse.RequestParser()
            .add_argument("email", type=email, required=True, location="json")
            .add_argument("language", type=str, required=False, location="json")
        )
        args = parser.parse_args()

        ip_address = extract_remote_ip(request)
        if AccountService.is_email_send_ip_limit(ip_address):
            raise EmailSendIpLimitError()

        if args["language"] is not None and args["language"] == "zh-Hans":
            language = "zh-Hans"
        else:
            language = "en-US"

        with Session(db.engine) as session:
            account = session.execute(select(Account).filter_by(email=args["email"])).scalar_one_or_none()

        token = AccountService.send_reset_password_email(
            account=account,
            email=args["email"],
            language=language,
            is_allow_register=FeatureService.get_system_features().is_allow_register,
        )

        return {"result": "success", "data": token}


@console_ns.route("/forgot-password/validity")
class ForgotPasswordCheckApi(Resource):
    @api.doc("check_forgot_password_code")
    @api.doc(description="Verify password reset code")
    @api.expect(
        api.model(
            "ForgotPasswordCheckRequest",
            {
                "email": fields.String(required=True, description="Email address"),
                "code": fields.String(required=True, description="Verification code"),
                "token": fields.String(required=True, description="Reset token"),
            },
        )
    )
    @api.response(
        200,
        "Code verified successfully",
        api.model(
            "ForgotPasswordCheckResponse",
            {
                "is_valid": fields.Boolean(description="Whether code is valid"),
                "email": fields.String(description="Email address"),
                "token": fields.String(description="New reset token"),
            },
        ),
    )
    @api.response(400, "Invalid code or token")
    @setup_required
    @email_password_login_enabled
    def post(self):
        parser = (
            reqparse.RequestParser()
            .add_argument("email", type=str, required=True, location="json")
            .add_argument("code", type=str, required=True, location="json")
            .add_argument("token", type=str, required=True, nullable=False, location="json")
        )
        args = parser.parse_args()

        user_email = args["email"]

        is_forgot_password_error_rate_limit = AccountService.is_forgot_password_error_rate_limit(args["email"])
        if is_forgot_password_error_rate_limit:
            raise EmailPasswordResetLimitError()

        token_data = AccountService.get_reset_password_data(args["token"])
        if token_data is None:
            raise InvalidTokenError()

        if user_email != token_data.get("email"):
            raise InvalidEmailError()

        if args["code"] != token_data.get("code"):
            AccountService.add_forgot_password_error_rate_limit(args["email"])
            raise EmailCodeError()

        # Verified, revoke the first token
        AccountService.revoke_reset_password_token(args["token"])

        # Refresh token data by generating a new token
        _, new_token = AccountService.generate_reset_password_token(
            user_email, code=args["code"], additional_data={"phase": "reset"}
        )

        AccountService.reset_forgot_password_error_rate_limit(args["email"])
        return {"is_valid": True, "email": token_data.get("email"), "token": new_token}


@console_ns.route("/forgot-password/resets")
class ForgotPasswordResetApi(Resource):
    @api.doc("reset_password")
    @api.doc(description="Reset password with verification token")
    @api.expect(
        api.model(
            "ForgotPasswordResetRequest",
            {
                "token": fields.String(required=True, description="Verification token"),
                "new_password": fields.String(required=True, description="New password"),
                "password_confirm": fields.String(required=True, description="Password confirmation"),
            },
        )
    )
    @api.response(
        200,
        "Password reset successfully",
        api.model("ForgotPasswordResetResponse", {"result": fields.String(description="Operation result")}),
    )
    @api.response(400, "Invalid token or password mismatch")
    @setup_required
    @email_password_login_enabled
    def post(self):
        parser = (
            reqparse.RequestParser()
            .add_argument("token", type=str, required=True, nullable=False, location="json")
            .add_argument("new_password", type=valid_password, required=True, nullable=False, location="json")
            .add_argument("password_confirm", type=valid_password, required=True, nullable=False, location="json")
        )
        args = parser.parse_args()

        # Validate passwords match
        if args["new_password"] != args["password_confirm"]:
            raise PasswordMismatchError()

        # Validate token and get reset data
        reset_data = AccountService.get_reset_password_data(args["token"])
        if not reset_data:
            raise InvalidTokenError()
        # Must use token in reset phase
        if reset_data.get("phase", "") != "reset":
            raise InvalidTokenError()

        # Revoke token to prevent reuse
        AccountService.revoke_reset_password_token(args["token"])

        # Generate secure salt and hash password
        salt = secrets.token_bytes(16)
        password_hashed = hash_password(args["new_password"], salt)

        email = reset_data.get("email", "")

        with Session(db.engine) as session:
            account = session.execute(select(Account).filter_by(email=email)).scalar_one_or_none()

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
