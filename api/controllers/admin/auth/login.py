from typing import cast

import flask_login  # type: ignore
from controllers.admin import api
from controllers.service_api_with_auth.auth.error import InvalidTokenError
from controllers.service_api_with_auth.error import AccountInFreezeError, AccountNotFound
from flask import Blueprint, request
from flask_restful import Api, Resource, reqparse  # type: ignore
from libs.helper import extract_remote_ip
from models.account import Account
from services.account_service import AccountService
from services.errors.account import AccountRegisterError


class SendVerificationCodeApi(Resource):
    def post(self):
        """Send verification code to admin's phone number.
        ---
        tags:
          - admin/api/auth
        summary: Send Verification Code
        description: Sends a verification code to the provided admin phone number for authentication
        parameters:
          - in: body
            name: body
            required: true
            schema:
              type: object
              required:
                - phone
              properties:
                phone:
                  type: string
                  description: Admin's phone number
                  example: "13800138000"
        responses:
          200:
            description: Code sent successfully
            schema:
              type: object
              properties:
                result:
                  type: string
                data:
                  type: string
          400:
            description: Invalid phone number format
          404:
            description: Phone number not registered as admin
        """
        parser = reqparse.RequestParser()
        parser.add_argument("phone", type=str, required=True, location="json")
        args = parser.parse_args()

        ip_address = extract_remote_ip(request)
        if AccountService.is_phone_send_ip_limit(ip_address):
            return {"result": "fail", "data": "Too many requests from this IP address"}, 429

        try:
            # find account by phone number & chech role is end_admin
            account = AccountService.get_admin_through_phone(args["phone"])
        except AccountRegisterError:
            raise AccountInFreezeError()

        if account is None:
            return {"result": "fail", "data": "Phone number not registered as admin"}, 404

        token = AccountService.send_phone_code_login(phone=args["phone"])

        return {"result": "success", "data": token}


class LoginApi(Resource):
    def post(self):
        """Admin login with phone number and verification code.
        ---
        tags:
          - admin/api/auth
        summary: Admin Login
        description: Authenticates an admin using phone number and verification code
        parameters:
          - in: body
            name: body
            required: true
            schema:
              type: object
              required:
                - phone
                - code
                - token
              properties:
                phone:
                  type: string
                  description: Admin's phone number
                  example: "13800138000"
                code:
                  type: string
                  description: Verification code
                  example: "111111"
                token:
                  type: string
                  description: Verification token
        responses:
          200:
            description: Login successful
            schema:
              type: object
              properties:
                result:
                  type: string
                data:
                  type: object
                  properties:
                    token:
                      type: string
                    user:
                      type: object
                      properties:
                        id:
                          type: string
                        phone:
                          type: string
                        name:
                          type: string
                        role:
                          type: string
                          enum: [admin, super_admin]
          400:
            description: Invalid or expired verification code
          404:
            description: Phone number not registered
        """
        parser = reqparse.RequestParser()
        parser.add_argument("phone", type=str, required=True, location="json")
        parser.add_argument("code", type=str, required=True, location="json")
        parser.add_argument("token", type=str, required=True, location="json")
        args = parser.parse_args()

        # Verify the token and code
        token_data = AccountService.get_phone_code_login_data(args["token"])
        if token_data is None:
            return {"result": "fail", "data": "Invalid or expired token"}, 400

        if token_data["phone"] != args["phone"]:
            return {"result": "fail", "data": "Phone number does not match"}, 400

        if token_data["code"] != args["code"]:
            return {"result": "fail", "data": "Invalid verification code"}, 400

        # Revoke the token after successful verification
        AccountService.revoke_phone_code_login_token(args["token"])

        try:
            account = AccountService.get_admin_through_phone(args["phone"])
        except AccountRegisterError:
            raise AccountInFreezeError()

        if account is None:
            return {"result": "fail", "data": "Phone number not registered as admin"}, 404

        # Generate token for the authenticated admin
        token_pair = AccountService.login(account, ip_address=extract_remote_ip(request))
        AccountService.reset_login_error_rate_limit(args["phone"])

        response_data = token_pair.model_dump()

        return {"result": "success", "data": response_data}


class LogoutApi(Resource):
    def post(self):
        """Admin logout.
        ---
        tags:
          - admin/api/auth
        summary: Admin Logout
        description: Logs out the authenticated admin and invalidates the JWT token
        security:
          - ApiKeyAuth: []
        responses:
          200:
            description: Logout successful
            schema:
              type: object
              properties:
                result:
                  type: string
          401:
            description: Missing or invalid token
        """
        account = cast(Account, flask_login.current_user)

        if isinstance(account, flask_login.AnonymousUserMixin):
            return {"result": "success"}

        AccountService.logout(account=account)
        flask_login.logout_user()

        return {"result": "success"}


class RefreshTokenApi(Resource):
    def post(self):
        """Refresh authentication token.
        ---
        tags:
          - admin/api/auth
        summary: Refresh Token
        description: Refreshes an access token using a valid refresh token
        security:
          - ApiKeyAuth: []
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


# Register the resources
api.add_resource(SendVerificationCodeApi, '/auth/send-code')
api.add_resource(LoginApi, '/auth/login')
api.add_resource(LogoutApi, '/auth/logout')
api.add_resource(RefreshTokenApi, '/auth/refresh-token')
