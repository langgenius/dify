from flask import Blueprint
from flask_restful import Api, Resource # type: ignore

from controllers.admin import api

class SendVerificationCodeApi(Resource):
    def post(self):
        """Send verification code to admin's phone number.
        ---
        tags:
          - admin/auth
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
                success:
                  type: boolean
                message:
                  type: string
          400:
            description: Invalid phone number format
          404:
            description: Phone number not registered as admin
        """
        pass

class LoginApi(Resource):
    def post(self):
        """Admin login with phone number and verification code.
        ---
        tags:
          - admin/auth
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
              properties:
                phone:
                  type: string
                  description: Admin's phone number
                  example: "13800138000"
                code:
                  type: string
                  description: Verification code
                  example: "123456"
        responses:
          200:
            description: Login successful
            schema:
              type: object
              properties:
                token:
                  type: string
                  description: JWT access token
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
        pass

class LogoutApi(Resource):
    def post(self):
        """Admin logout.
        ---
        tags:
          - admin/auth
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
                success:
                  type: boolean
          401:
            description: Missing or invalid token
        """
        pass

class RefreshTokenApi(Resource):
    def post(self):
        """Refresh authentication token.
        ---
        tags:
          - admin/auth
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
                  example: "success"
                data:
                  type: object
                  description: New token pair data
          401:
            description: Unauthorized, invalid or missing token
        """
        pass

# Register the resources
api.add_resource(SendVerificationCodeApi, '/auth/send-code')
api.add_resource(LoginApi, '/auth/login')
api.add_resource(LogoutApi, '/auth/logout')
api.add_resource(RefreshTokenApi, '/auth/refresh-token')