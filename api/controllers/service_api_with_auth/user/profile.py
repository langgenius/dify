from flask import Blueprint
from flask_restful import Api, Resource # type: ignore

from controllers.service_api_with_auth import api

class UserProfile(Resource):
    def get(self):
        """Get user profile.
        ---
        tags:
          - user/profile
        summary: Get profile
        description: Get current user's profile information
        security:
          - ApiKeyAuth: []
        responses:
          200:
            description: Profile retrieved successfully
            schema:
              type: object
              properties:
                username:
                  type: string
                gender:
                  type: string
                  enum: [male, female, unknown]
                major:
                  type: string
                email:
                  type: string
                  format: email
          401:
            description: Invalid or missing token
        """
        pass

    def put(self):
        """Update user profile.
        ---
        tags:
          - user/profile
        summary: Update profile
        description: Update user profile information
        security:
          - ApiKeyAuth: []
        parameters:
          - name: body
            in: body
            required: true
            schema:
              type: object
              properties:
                username:
                  type: string
                  maxLength: 10
                  pattern: ^[a-zA-Z\u4e00-\u9fa5]+$
                  description: Username (Chinese or English only)
                gender:
                  type: string
                  enum: [male, female, unknown]
                major:
                  type: string
                  maxLength: 20
        responses:
          200:
            description: Profile updated successfully
            schema:
              type: object
              properties:
                success:
                  type: boolean
                  example: true
          400:
            description: Invalid profile data
          401:
            description: Invalid or missing token
        """
        pass

api.add_resource(UserProfile, '/user/profile')