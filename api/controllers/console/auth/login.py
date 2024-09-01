from typing import cast

import flask_login
from flask import request
from flask_restful import Resource, reqparse

import services
from controllers.console import api
from controllers.console.setup import setup_required
from libs.helper import email, get_remote_ip
from libs.password import valid_password
from models import Account
from services.account_service import AccountService, TenantService


class LoginApi(Resource):
    """Resource for user login."""

    @setup_required
    def post(self):
        """Authenticate user and login."""
        parser = reqparse.RequestParser()
        parser.add_argument("email", type=email, required=True, location="json")
        parser.add_argument("password", type=valid_password, required=True, location="json")
        parser.add_argument("remember_me", type=bool, required=False, default=False, location="json")
        args = parser.parse_args()

        # todo: Verify the recaptcha

        try:
            account = AccountService.authenticate(args["email"], args["password"])
        except services.errors.account.AccountLoginError as e:
            return {"code": "unauthorized", "message": str(e)}, 401

        # SELF_HOSTED only have one workspace
        tenants = TenantService.get_join_tenants(account)
        if len(tenants) == 0:
            return {
                "result": "fail",
                "data": "workspace not found, please contact system admin to invite you to join in a workspace",
            }

        token = AccountService.login(account, ip_address=get_remote_ip(request))

        return {"result": "success", "data": token}


class LogoutApi(Resource):
    @setup_required
    def get(self):
        account = cast(Account, flask_login.current_user)
        token = request.headers.get("Authorization", "").split(" ")[1]
        AccountService.logout(account=account, token=token)
        flask_login.logout_user()
        return {"result": "success"}


class ResetPasswordApi(Resource):
    @setup_required
    def get(self):
        # parser = reqparse.RequestParser()
        # parser.add_argument('email', type=email, required=True, location='json')
        # args = parser.parse_args()

        # import mailchimp_transactional as MailchimpTransactional
        # from mailchimp_transactional.api_client import ApiClientError

        # account = {'email': args['email']}
        # account = AccountService.get_by_email(args['email'])
        # if account is None:
        #     raise ValueError('Email not found')
        # new_password = AccountService.generate_password()
        # AccountService.update_password(account, new_password)

        # todo: Send email
        # MAILCHIMP_API_KEY = dify_config.MAILCHIMP_TRANSACTIONAL_API_KEY
        # mailchimp = MailchimpTransactional(MAILCHIMP_API_KEY)

        # message = {
        #     'from_email': 'noreply@example.com',
        #     'to': [{'email': account['email']}],
        #     'subject': 'Reset your Dify password',
        #     'html': """
        #         <p>Dear User,</p>
        #         <p>The Dify team has generated a new password for you, details as follows:</p>
        #         <p><strong>{new_password}</strong></p>
        #         <p>Please change your password to log in as soon as possible.</p>
        #         <p>Regards,</p>
        #         <p>The Dify Team</p>
        #     """
        # }

        # response = mailchimp.messages.send({
        #     'message': message,
        #     # required for transactional email
        #     ' settings': {
        #         'sandbox_mode': dify_config.MAILCHIMP_SANDBOX_MODE,
        #     },
        # })

        # Check if MSG was sent
        # if response.status_code != 200:
        #     # handle error
        #     pass

        return {"result": "success"}


api.add_resource(LoginApi, "/login")
api.add_resource(LogoutApi, "/logout")
