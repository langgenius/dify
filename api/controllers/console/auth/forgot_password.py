import base64
import logging
import secrets

from flask_restful import Resource, reqparse

from controllers.console import api
from controllers.console.auth.error import (
    InvalidEmailError,
    InvalidTokenError,
    PasswordMismatchError,
    PasswordResetRateLimitExceededError,
)
from controllers.console.setup import setup_required
from extensions.ext_database import db
from libs.helper import email as email_validate
from libs.password import hash_password, valid_password
from models.account import Account
from services.account_service import AccountService
from services.errors.account import RateLimitExceededError


class ForgotPasswordSendEmailApi(Resource):
    @setup_required
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("email", type=str, required=True, location="json")
        args = parser.parse_args()

        email = args["email"]

        if not email_validate(email):
            raise InvalidEmailError()

        account = Account.query.filter_by(email=email).first()

        if account:
            try:
                AccountService.send_reset_password_email(account=account)
            except RateLimitExceededError:
                logging.warning(f"Rate limit exceeded for email: {account.email}")
                raise PasswordResetRateLimitExceededError()
        else:
            # Return success to avoid revealing email registration status
            logging.warning(f"Attempt to reset password for unregistered email: {email}")

        return {"result": "success"}


class ForgotPasswordCheckApi(Resource):
    @setup_required
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("token", type=str, required=True, nullable=False, location="json")
        args = parser.parse_args()
        token = args["token"]

        reset_data = AccountService.get_reset_password_data(token)

        if reset_data is None:
            return {"is_valid": False, "email": None}
        return {"is_valid": True, "email": reset_data.get("email")}


class ForgotPasswordResetApi(Resource):
    @setup_required
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("token", type=str, required=True, nullable=False, location="json")
        parser.add_argument("new_password", type=valid_password, required=True, nullable=False, location="json")
        parser.add_argument("password_confirm", type=valid_password, required=True, nullable=False, location="json")
        args = parser.parse_args()

        new_password = args["new_password"]
        password_confirm = args["password_confirm"]

        if str(new_password).strip() != str(password_confirm).strip():
            raise PasswordMismatchError()

        token = args["token"]
        reset_data = AccountService.get_reset_password_data(token)

        if reset_data is None:
            raise InvalidTokenError()

        AccountService.revoke_reset_password_token(token)

        salt = secrets.token_bytes(16)
        base64_salt = base64.b64encode(salt).decode()

        password_hashed = hash_password(new_password, salt)
        base64_password_hashed = base64.b64encode(password_hashed).decode()

        account = Account.query.filter_by(email=reset_data.get("email")).first()
        account.password = base64_password_hashed
        account.password_salt = base64_salt
        db.session.commit()

        return {"result": "success"}


api.add_resource(ForgotPasswordSendEmailApi, "/forgot-password")
api.add_resource(ForgotPasswordCheckApi, "/forgot-password/validity")
api.add_resource(ForgotPasswordResetApi, "/forgot-password/resets")
