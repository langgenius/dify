import flask_login
from flask import current_app, request
from flask_restful import Resource, reqparse

import services
from controllers.console import api
from controllers.console.setup import setup_required
from libs.helper import email
from libs.password import valid_password
from services.account_service import AccountService, TenantService


class LoginApi(Resource):
    """Resource for user login."""

    @setup_required
    def post(self):
        """Authenticate user and login."""
        parser = reqparse.RequestParser()
        parser.add_argument('email', type=email, required=True, location='json')
        parser.add_argument('password', type=valid_password, required=True, location='json')
        parser.add_argument('remember_me', type=bool, required=False, default=False, location='json')
        args = parser.parse_args()

        # todo: Verify the recaptcha

        try:
            account = AccountService.authenticate(args['email'], args['password'])
        except services.errors.account.AccountLoginError:
            return {'code': 'unauthorized', 'message': 'Invalid email or password'}, 401

        TenantService.create_owner_tenant_if_not_exist(account)

        AccountService.update_last_login(account, request)

        # todo: return the user info
        token = AccountService.get_account_jwt_token(account)

        return {'result': 'success', 'data': token}


class LogoutApi(Resource):

    @setup_required
    def get(self):
        flask_login.logout_user()
        return {'result': 'success'}


class InitPasswordRestApi(Resource):
    """Resource for user to request password reset."""

    @setup_required
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument('email', type=email, required=True, location='json')
        args = parser.parse_args()

        account = AccountService.get_by_email(args['email'])
        if account is None:
            # for security reason, donnot tell user if the email is not found
            return {'result': 'success'}
        token = AccountService.create_reset_password_token(account.id)
        # TODO Send mail to user
        message = {
            'from_email': 'noreply@example.com',
            'to': [{'email': account.email}],
            'subject': 'Reset your Dify password',
            'html': f"""
                <p>Dear User,</p>
                <p>Your requested reset password, please go to </p> 
                <p><a>/finish-password-reset?user_id={account.id}token={token}</a></p>
                <p>Regards,</p>
                <p>The Dify Team</p> 
            """
        }

        return {'result': 'success'}

class FinishPasswordRestApi(Resource):
    """Verify and reset password."""

    @setup_required
    def get(self):
        """Verify only, return 200 if matched"""
        parser = reqparse.RequestParser()
        parser.add_argument('user_id', type=str, required=True, location='args')
        parser.add_argument('token', type=str, required=True, location='args')
        args = parser.parse_args()

        user_id = args['user_id']
        token = args['token']
        if AccountService.check_reset_password_token(user_id, token):
            return {'result': 'success'}
        raise ValueError('Invalid token')

    @setup_required
    def post(self):
        """Reset password"""
        parser = reqparse.RequestParser()
        parser.add_argument('user_id', type=str, required=True, location='json')
        parser.add_argument('token', type=str, required=True, location='json')
        parser.add_argument('password', type=valid_password, required=True, location='json')
        args = parser.parse_args()

        # import mailchimp_transactional as MailchimpTransactional
        # from mailchimp_transactional.api_client import ApiClientError
        user_id = args['user_id']
        token = args['token']
        password = args['password']
        if AccountService.check_reset_password_token(user_id, token):
            account = AccountService.load_user(user_id)
            if not account:
                # for security reason, donnot tell user if the email is not found
                raise ValueError('Invalid token')
            AccountService.change_account_password(account, password)
            return {'result': 'success'}
        raise ValueError('Invalid token')

api.add_resource(LoginApi, '/login')
api.add_resource(LogoutApi, '/logout')
api.add_resource(InitPasswordRestApi, '/password-reset/init')
api.add_resource(FinishPasswordRestApi, '/password-reset/finish')