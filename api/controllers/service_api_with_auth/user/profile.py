import re

from controllers.service_api_with_auth import api
from controllers.service_api_with_auth.wraps import validate_user_token_and_extract_info
from flask import Blueprint, request
from flask_restful import Api, Resource  # type: ignore
from models.model import App, EndUser
from services.end_user_service import EndUserService


class UserProfile(Resource):
    @validate_user_token_and_extract_info
    def get(self, app_model: App, end_user: EndUser):
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
        # Use the service to get user profile
        profile = EndUserService.get_user_profile(end_user.external_user_id)
        return profile

    @validate_user_token_and_extract_info
    def put(self, app_model: App, end_user: EndUser):
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
        data = request.get_json()
        validated_data = {}

        # Validate username if provided
        if 'username' in data:
            username = data['username']
            # Validate username (Chinese or English only, max 10 chars)
            if not re.match(r'^[a-zA-Z\u4e00-\u9fa5]+$', username) or len(username) > 10:
                return {"success": False, "message": "Invalid username format"}, 400
            validated_data['username'] = username

        # Validate gender if provided
        if 'gender' in data:
            gender_str = data['gender']
            if gender_str not in ["unknown", "male", "female"]:
                return {"success": False, "message": "Invalid gender value"}, 400
            validated_data['gender'] = gender_str

        # Validate major if provided
        if 'major' in data:
            major = data['major']

            if isinstance(major, str) and len(major) > 20:
                return {"success": False, "message": "Major exceeds maximum length"}, 400
            elif major is not None:  # Handle non-string or None values appropriately
                return {"success": False, "message": "Major must be a string value"}, 400

            validated_data['major'] = major

        # Use the service to update user profile
        success, error = EndUserService.update_user_profile(end_user, validated_data)

        if not success:
            return {"success": False, "message": error or "Failed to update profile"}, 500

        return {"success": True}


api.add_resource(UserProfile, '/user/profile')
