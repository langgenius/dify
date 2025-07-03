from typing import cast

import flask_login  # type: ignore
from flask import request
from flask_restful import Resource, reqparse  # type: ignore

from configs import dify_config
from controllers.admin import api
from controllers.service_api_with_auth.error import AccountInFreezeError
from libs.helper import extract_remote_ip
from models.account import Account
from services.account_service import AccountService
from services.errors.account import AccountRegisterError


class SendVerificationCodeApi(Resource):
    def post(self):
        """Send verification code to admin's phone number or email.
        ---
        tags:
          - admin/api/auth
        summary: Send Verification Code
        description: Sends a verification code to the provided admin phone number or email for authentication
        parameters:
          - in: body
            name: body
            required: false
            schema:
              type: object
              properties:
                login_id:
                  type: string
                  description: Admin's phone number or email address
                  example: "admin@test.edu"
                phone:
                  type: string
                  description: (Legacy) Admin's phone number
                  example: "+1234567890"
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
            description: Invalid input format or missing required fields
          404:
            description: Phone number or email not registered as admin
        """
        parser = reqparse.RequestParser()
        parser.add_argument("login_id", type=str, required=False, location="json")
        parser.add_argument("phone", type=str, required=False, location="json")
        args = parser.parse_args()

        login_id = args.get("login_id")
        phone = args.get("phone")

        # Use login_id if provided, otherwise fall back to phone
        if login_id is None and phone is not None:
            login_id = phone
        elif login_id is None and phone is None:
            return {
                "result": "fail",
                "data": "Either login_id or phone is required",
            }, 400

        # Determine if login_id is an email or phone number
        is_email = "@" in login_id

        ip_address = extract_remote_ip(request)

        if AccountService.is_login_attempt_ip_limit(ip_address) and login_id not in {
            dify_config.DEBUG_ADMIN_EMAIL,
            dify_config.DEBUG_ADMIN_PHONE,
        }:
            return {
                "result": "fail",
                "data": "Too many requests from this IP address",
            }, 429

        try:
            # Use the unified method to check admin account
            account = AccountService.get_admin_through_login_id(login_id)
        except AccountRegisterError:
            raise AccountInFreezeError()

        if account is None:
            error_type = "Email" if is_email else "Phone number"
            return {
                "result": "fail",
                "data": f"{error_type} not registered as admin",
            }, 404

        # Send verification code
        if is_email:
            token = AccountService.send_email_code_login_email(email=login_id)
        else:
            token = AccountService.send_phone_code_login(phone=login_id)

        return {"result": "success", "data": token}


class LoginApi(Resource):
    def post(self):
        """Admin login with phone number/email and verification code.
        ---
        tags:
          - admin/api/auth
        summary: Admin Login
        description: Authenticates an admin using phone number/email and verification code
        parameters:
          - in: body
            name: body
            required: true
            schema:
              type: object
              required:
                - code
                - token
              properties:
                login_id:
                  type: string
                  description: Admin's phone number or email address
                  example: "admin@test.edu"
                phone:
                  type: string
                  description: (Legacy) Admin's phone number
                  example: "+1234567890"
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
                        email:
                          type: string
                        name:
                          type: string
                        role:
                          type: string
                          enum: [admin, super_admin]
          400:
            description: Invalid or expired verification code
          404:
            description: Phone number or email not registered
        """
        parser = reqparse.RequestParser()
        parser.add_argument("login_id", type=str, required=False, location="json")
        parser.add_argument("phone", type=str, required=False, location="json")
        parser.add_argument("code", type=str, required=True, location="json")
        parser.add_argument("token", type=str, required=True, location="json")
        args = parser.parse_args()

        login_id = args.get("login_id")
        phone = args.get("phone")

        # Use login_id if provided, otherwise fall back to phone
        if login_id is None and phone is not None:
            login_id = phone
        elif login_id is None and phone is None:
            return {
                "result": "fail",
                "data": "Either login_id or phone is required",
            }, 400

        # Determine if login_id is an email or phone number
        is_email = "@" in login_id

        # Handle verification based on identified type
        if is_email:
            # Email-based verification
            token_data = AccountService.get_email_code_login_data(args["token"])
            if token_data is None:
                return {"result": "fail", "data": "Invalid or expired token"}, 400

            if token_data.get("email") != login_id:
                return {"result": "fail", "data": "Email does not match"}, 400

            if token_data["code"] != args["code"]:
                return {"result": "fail", "data": "Invalid verification code"}, 400

            # Revoke the token after successful verification
            AccountService.revoke_email_code_login_token(args["token"])
        else:
            # Phone-based verification
            token_data = AccountService.get_phone_code_login_data(args["token"])
            if token_data is None:
                return {"result": "fail", "data": "Invalid or expired token"}, 400

            if token_data["phone"] != login_id:
                return {"result": "fail", "data": "Phone number does not match"}, 400

            if token_data["code"] != args["code"]:
                return {"result": "fail", "data": "Invalid verification code"}, 400

            # Revoke the token after successful verification
            AccountService.revoke_phone_code_login_token(args["token"])

        try:
            # Use the unified method to get admin account
            account = AccountService.get_admin_through_login_id(login_id)
        except AccountRegisterError:
            raise AccountInFreezeError()

        if account is None:
            error_type = "Email" if is_email else "Phone number"
            return {
                "result": "fail",
                "data": f"{error_type} not registered as admin",
            }, 404

        # Reset login error rate limit
        AccountService.reset_login_error_rate_limit(login_id)

        # Generate token for the authenticated admin
        token_pair = AccountService.login(account, ip_address=extract_remote_ip(request))

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
api.add_resource(SendVerificationCodeApi, "/auth/send-code")
api.add_resource(LoginApi, "/auth/login")
api.add_resource(LogoutApi, "/auth/logout")
api.add_resource(RefreshTokenApi, "/auth/refresh-token")
