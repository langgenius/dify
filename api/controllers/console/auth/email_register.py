from flask import request
from flask_restx import Resource, reqparse
from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from constants.languages import languages
from controllers.console import api
from controllers.console.auth.error import (
    EmailAlreadyInUseError,
    EmailCodeError,
    EmailRegisterLimitError,
    InvalidEmailError,
    InvalidTokenError,
    PasswordMismatchError,
)
from controllers.console.error import AccountInFreezeError, EmailSendIpLimitError
from controllers.console.wraps import email_password_login_enabled, email_register_enabled, setup_required
from extensions.ext_database import db
from libs.helper import email, extract_remote_ip
from libs.password import valid_password
from models.account import Account
from services.account_service import AccountService
from services.billing_service import BillingService
from services.errors.account import AccountNotFoundError, AccountRegisterError


class EmailRegisterSendEmailApi(Resource):
    @setup_required
    @email_password_login_enabled
    @email_register_enabled
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("email", type=email, required=True, location="json")
        parser.add_argument("language", type=str, required=False, location="json")
        args = parser.parse_args()

        ip_address = extract_remote_ip(request)
        if AccountService.is_email_send_ip_limit(ip_address):
            raise EmailSendIpLimitError()
        language = "en-US"
        if args["language"] in languages:
            language = args["language"]

        if dify_config.BILLING_ENABLED and BillingService.is_email_in_freeze(args["email"]):
            raise AccountInFreezeError()

        with Session(db.engine) as session:
            account = session.execute(select(Account).filter_by(email=args["email"])).scalar_one_or_none()
        token = None
        token = AccountService.send_email_register_email(email=args["email"], account=account, language=language)
        return {"result": "success", "data": token}


class EmailRegisterCheckApi(Resource):
    @setup_required
    @email_password_login_enabled
    @email_register_enabled
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("email", type=str, required=True, location="json")
        parser.add_argument("code", type=str, required=True, location="json")
        parser.add_argument("token", type=str, required=True, nullable=False, location="json")
        args = parser.parse_args()

        user_email = args["email"]

        is_email_register_error_rate_limit = AccountService.is_email_register_error_rate_limit(args["email"])
        if is_email_register_error_rate_limit:
            raise EmailRegisterLimitError()

        token_data = AccountService.get_email_register_data(args["token"])
        if token_data is None:
            raise InvalidTokenError()

        if user_email != token_data.get("email"):
            raise InvalidEmailError()

        if args["code"] != token_data.get("code"):
            AccountService.add_email_register_error_rate_limit(args["email"])
            raise EmailCodeError()

        # Verified, revoke the first token
        AccountService.revoke_email_register_token(args["token"])

        # Refresh token data by generating a new token
        _, new_token = AccountService.generate_email_register_token(
            user_email, code=args["code"], additional_data={"phase": "register"}
        )

        AccountService.reset_email_register_error_rate_limit(args["email"])
        return {"is_valid": True, "email": token_data.get("email"), "token": new_token}


class EmailRegisterResetApi(Resource):
    @setup_required
    @email_password_login_enabled
    @email_register_enabled
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("token", type=str, required=True, nullable=False, location="json")
        parser.add_argument("new_password", type=valid_password, required=True, nullable=False, location="json")
        parser.add_argument("password_confirm", type=valid_password, required=True, nullable=False, location="json")
        args = parser.parse_args()

        # Validate passwords match
        if args["new_password"] != args["password_confirm"]:
            raise PasswordMismatchError()

        # Validate token and get register data
        register_data = AccountService.get_email_register_data(args["token"])
        if not register_data:
            raise InvalidTokenError()
        # Must use token in reset phase
        if register_data.get("phase", "") != "register":
            raise InvalidTokenError()

        # Revoke token to prevent reuse
        AccountService.revoke_email_register_token(args["token"])

        email = register_data.get("email", "")

        with Session(db.engine) as session:
            account = session.execute(select(Account).filter_by(email=email)).scalar_one_or_none()

            if account:
                raise EmailAlreadyInUseError()
            else:
                account = self._create_new_account(email, args["password_confirm"])
                if not account:
                    raise AccountNotFoundError()
                token_pair = AccountService.login(account=account, ip_address=extract_remote_ip(request))
                AccountService.reset_login_error_rate_limit(email)

        return {"result": "success", "data": token_pair.model_dump()}

    def _create_new_account(self, email, password) -> Account | None:
        # Create new account if allowed
        account = None
        try:
            account = AccountService.create_account_and_tenant(
                email=email,
                name=email,
                password=password,
                interface_language=languages[0],
            )
        except AccountRegisterError:
            raise AccountInFreezeError()

        return account


api.add_resource(EmailRegisterSendEmailApi, "/email-register/send-email")
api.add_resource(EmailRegisterCheckApi, "/email-register/validity")
api.add_resource(EmailRegisterResetApi, "/email-register")
