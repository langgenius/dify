from typing import cast

import flask_login  # type: ignore
from configs import dify_config
from constants.languages import languages
from controllers.service_api_with_auth import api
from controllers.service_api_with_auth.auth.error import EmailCodeError, InvalidEmailError, InvalidTokenError
from controllers.service_api_with_auth.error import (
    AccountInFreezeError,
    EmailSendIpLimitError,
    OrganizationMismatchError,
    OrganizationNotFoundError,
    TenantNotFoundError,
)
from extensions.ext_database import db
from flask import request
from flask_restful import Resource, reqparse  # type: ignore
from libs.helper import email, extract_remote_ip
from models.account import Account
from services.account_service import AccountService, TenantService
from services.errors.account import AccountRegisterError
from services.organization_service import OrganizationService


class LogoutApi(Resource):
    def get(self):
        """Logout user.
        ---
        tags:
          - user/auth
        summary: Logout User
        description: Logs out the authenticated user and invalidates the session
        responses:
          200:
            description: Successfully logged out
            schema:
              type: object
              properties:
                result:
                  type: string
                  example: "success"
          401:
            description: Unauthorized, invalid or missing token
        """
        account = cast(Account, flask_login.current_user)
        if isinstance(account, flask_login.AnonymousUserMixin):
            return {"result": "success"}
        AccountService.logout(account=account)
        flask_login.logout_user()
        return {"result": "success"}


class EmailCodeLoginSendEmailApi(Resource):
    def post(self):
        """Send email code for login.
        ---
        tags:
          - user/auth
        summary: Email Code Login Email Sending
        description: Sends an email with a verification code for login
        parameters:
          - in: body
            name: body
            required: true
            schema:
              type: object
              required:
                - email
              properties:
                email:
                  type: string
                  description: The user's email
                  example: "test@test.edu"
                language:
                  type: string
                  description: Preferred language for the email
                  enum: ["en-US", "zh-Hans"]
        responses:
          200:
            description: Successfully sent the email code
            schema:
              type: object
              properties:
                result:
                  type: string
                  example: "success"
                data:
                  type: object
                  description: Token data
          429:
            description: Too many requests, IP limit reached
          404:
            description: Account not found
        """
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
        try:
            account = AccountService.get_user_through_email(args["email"])
        except AccountRegisterError as are:
            raise AccountInFreezeError()

        if account is None:
            token = AccountService.send_email_code_login_email(email=args["email"], language=language)
        else:
            token = AccountService.send_email_code_login_email(account=account, language=language)

        return {"result": "success", "data": token}


class EmailCodeLoginApi(Resource):
    def post(self):
        """Login using email code.
        ---
        tags:
          - user/auth
        summary: Email Code Login
        description: Allows the user to login using a verification code and token sent via email
        parameters:
          - in: body
            name: body
            required: true
            schema:
              type: object
              required:
                - email
                - code
                - token
              properties:
                email:
                  type: string
                  description: The user's email
                  example: "test@test.edu"
                code:
                  type: string
                  description: The verification code sent to the email
                  example: "111111"
                token:
                  type: string
                  description: The token associated with the email code login
        responses:
          200:
            description: Successfully logged in
            schema:
              type: object
              properties:
                result:
                  type: string
                  example: "success"
                data:
                  type: object
                  description: Token pair data
          400:
            description: Invalid token, email or code
        """
        parser = reqparse.RequestParser()
        parser.add_argument("email", type=str, required=True, location="json")
        parser.add_argument("code", type=str, required=True, location="json")
        parser.add_argument("token", type=str, required=True, location="json")
        args = parser.parse_args()

        user_email = args["email"]
        tenant_id = dify_config.DEFAULT_TENANT_ID

        token_data = AccountService.get_email_code_login_data(args["token"])
        if token_data is None:
            raise InvalidTokenError()

        if token_data["email"] != args["email"]:
            raise InvalidEmailError()

        if token_data["code"] != args["code"]:
            raise EmailCodeError()

        AccountService.revoke_email_code_login_token(args["token"])

        try:
            account = AccountService.get_user_through_email(user_email)
            tenant = TenantService.get_tenant_by_id(tenant_id)
        except AccountRegisterError as are:
            raise AccountInFreezeError()

        if tenant is None:
            raise TenantNotFoundError()

        # Find organization based on email domain
        organization = OrganizationService.find_organization_by_email_domain(user_email, tenant.id)

        if organization is None:
            raise OrganizationNotFoundError()

        is_new_user = account is None

        if account is None:

            # Create new account
            account = AccountService.create_account_in_tenant(
                tenant=tenant,
                email=user_email,
                name=user_email,
                interface_language=languages[0],
            )

            OrganizationService.assign_account_to_organization(account, organization.id)

        else:

            if account.current_organization_id is not None and account.current_organization_id != organization.id:
                raise OrganizationMismatchError()

            connected_tenant = TenantService.get_join_tenants(account)
            if connected_tenant is None or tenant not in connected_tenant:
                TenantService.create_tenant_member(tenant, account, role="end_user")

        token_pair = AccountService.login(account, ip_address=extract_remote_ip(request))
        AccountService.reset_login_error_rate_limit(args["email"])

        # Add is_new_user field to response data
        response_data = token_pair.model_dump()
        response_data["is_new_user"] = is_new_user

        return {"result": "success", "data": response_data}


class RefreshTokenApi(Resource):
    def post(self):
        """Refresh authentication token.
        ---
        tags:
          - user/auth
        summary: Refresh Token
        description: Refreshes an access token using a valid refresh token
        parameters:
          - in: body
            name: body
            required: true
            schema:
              type: object
              required:
                - refresh_token
              properties:
                refresh_token:
                  type: string
                  description: The refresh token provided in the request
        responses:
          200:
            description: Successfully refreshed token
            schema:
              type: object
              properties:
                result:
                  type: string
                  example: "success"
                data:
                  type: object
                  description: New token pair data
          401:
            description: Unauthorized, invalid or missing token
        """
        parser = reqparse.RequestParser()
        parser.add_argument("refresh_token", type=str, required=True, location="json")
        args = parser.parse_args()

        try:
            new_token_pair = AccountService.refresh_token(args["refresh_token"])
            return {"result": "success", "data": new_token_pair.model_dump()}
        except Exception as e:
            return {"result": "fail", "data": str(e)}, 401


api.add_resource(LogoutApi, "/auth/logout")
api.add_resource(EmailCodeLoginSendEmailApi, "/auth/email-code-login")
api.add_resource(EmailCodeLoginApi, "/auth/email-code-login/validity")
api.add_resource(RefreshTokenApi, "/auth/refresh-token")
