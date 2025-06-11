import base64
import secrets

from flask import request
from flask_restful import Resource, reqparse
from sqlalchemy import select
from sqlalchemy.orm import Session

from controllers.console.auth.error import (
    EmailCodeError,
    EmailPasswordResetLimitError,
    InvalidEmailError,
    InvalidTokenError,
    PasswordMismatchError,
)
from controllers.console.error import AccountNotFound, EmailSendIpLimitError
from controllers.console.wraps import email_password_login_enabled, only_edition_enterprise, setup_required
from controllers.web import api
from extensions.ext_database import db
from libs.helper import email, extract_remote_ip
from libs.password import hash_password, valid_password
from models.account import Account
from services.account_service import AccountService


class ForgotPasswordSendEmailApi(Resource):
    @only_edition_enterprise
    @setup_required
    @email_password_login_enabled
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("email", type=email, required=True, location="json")
        parser.add_argument("language", type=str, required=False, location="json")
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
        token = None
        if account is None:
            raise AccountNotFound()
        else:
            token = AccountService.send_reset_password_email(account=account, email=args["email"], language=language)

        return {"result": "success", "data": token}


class ForgotPasswordCheckApi(Resource):
    @only_edition_enterprise
    @setup_required
    @email_password_login_enabled
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("email", type=str, required=True, location="json")
        parser.add_argument("code", type=str, required=True, location="json")
        parser.add_argument("token", type=str, required=True, nullable=False, location="json")
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


class ForgotPasswordResetApi(Resource):
    @only_edition_enterprise
    @setup_required
    @email_password_login_enabled
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("token", type=str, required=True, nullable=False, location="json")
        parser.add_argument("new_password", type=valid_password, required=True, nullable=False, location="json")
        parser.add_argument("password_confirm", type=valid_password, required=True, nullable=False, location="json")
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


api.add_resource(ForgotPasswordSendEmailApi, "/forgot-password")
api.add_resource(ForgotPasswordCheckApi, "/forgot-password/validity")
api.add_resource(ForgotPasswordResetApi, "/forgot-password/resets")
