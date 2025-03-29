import json
import logging
import os
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from controllers.service_api_with_auth import api
from controllers.service_api_with_auth.app.error import NotChatAppError
from controllers.service_api_with_auth.wraps import validate_user_token_and_extract_info
from core.app.entities.app_invoke_entities import InvokeFrom
from core.file import FileTransferMethod, FileType
from extensions.ext_database import db
from fields.end_user_fields import image_fields, image_list_fields
from flask_restful import Resource, fields, marshal_with, reqparse  # type: ignore
from libs.helper import TimestampField, uuid_value
from models.enums import CreatedByRole
from models.model import App, AppMode, Conversation, EndUser, Message, UserGeneratedImage
from models.types import StringUUID
from services.image_generation_service import ImageGenerationService
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest, InternalServerError, NotFound

# Constants
DEFAULT_DAILY_LIMIT = 5
MIN_CONVERSATION_ROUNDS = 10


class ImageGenerateApi(Resource):
    @validate_user_token_and_extract_info
    def post(self, app_model: App, end_user: EndUser):
        """Generate a personalized image based on conversation content.
        ---
        tags:
          - service/image
        summary: Generate a personalized image
        description: Generate an image with encouraging text based on conversation
        security:
          - ApiKeyAuth: []
        parameters:
          - name: body
            in: body
            required: true
            schema:
              type: object
              required:
                - conversation_id
                - content_type
              properties:
                conversation_id:
                  type: string
                  format: uuid
                  description: ID of the conversation to use for image generation
                content_type:
                  type: string
                  enum: [self_message, summary_advice]
                  description: Type of text content to generate
        responses:
          200:
            description: Image generation started
            schema:
              type: object
              properties:
                result:
                  type: string
                  example: success
                message:
                  type: string
                  example: Image generation started
          400:
            description: Invalid request or conversation not suitable
          401:
            description: Invalid or missing token
          403:
            description: Daily limit reached
          404:
            description: Conversation not found or not a chat app
        """
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        parser = reqparse.RequestParser()
        parser.add_argument("conversation_id", required=True, type=uuid_value, location="json")
        parser.add_argument(
            "content_type", required=True, type=str, choices=["self_message", "summary_advice"], location="json"
        )
        args = parser.parse_args()

        conversation_id = str(args["conversation_id"])
        content_type = args["content_type"]

        # Check if conversation exists
        conversation = (
            db.session.query(Conversation)
            .filter(
                Conversation.id == conversation_id,
                Conversation.app_id == app_model.id,
                Conversation.from_end_user_id == end_user.id,
            )
            .first()
        )

        if not conversation:
            raise NotFound("Conversation not found")

        # Check if conversation has enough rounds
        messages_count = db.session.query(Message).filter(Message.conversation_id == conversation_id).count()

        if messages_count < MIN_CONVERSATION_ROUNDS:
            return {
                "result": "error",
                "message": "I need to know more about you before creating an image. Please continue our conversation.",
            }, 400

        # Check if user has reached daily limit
        today = datetime.utcnow().date()
        tomorrow = today + timedelta(days=1)
        today_start = datetime.combine(today, datetime.min.time())
        today_end = datetime.combine(tomorrow, datetime.min.time())

        daily_count = (
            db.session.query(UserGeneratedImage)
            .filter(
                UserGeneratedImage.end_user_id == end_user.id,
                UserGeneratedImage.created_at >= today_start,
                UserGeneratedImage.created_at < today_end,
            )
            .count()
        )

        if daily_count >= DEFAULT_DAILY_LIMIT:
            return {
                "result": "error",
                "message": (
                    f"You've reached your daily limit of {DEFAULT_DAILY_LIMIT} generated images. Please try again tomorrow."
                ),
            }, 403

        try:
            # Use the service to generate the image
            # This would typically be done asynchronously in a background task
            # For simplicity, we're doing it synchronously here
            image_id = ImageGenerationService.process_image_generation_request(
                app_id=str(app_model.id),
                conversation_id=conversation_id,
                end_user_id=str(end_user.id),
                content_type=content_type,
            )

            if image_id:
                return {"result": "success", "message": "Image generated successfully.", "image_id": image_id}
            else:
                return {"result": "error", "message": "Failed to generate image. Please try again later."}, 500

        except Exception as e:
            raise InternalServerError("Failed to generate image")


class ImageListApi(Resource):
    @validate_user_token_and_extract_info
    @marshal_with(image_list_fields)
    def get(self, app_model: App, end_user: EndUser):
        """Get user-generated images list.
        ---
        tags:
          - service/image
        summary: List user generated images
        description: Get a list of images generated for the current user
        security:
          - ApiKeyAuth: []
        parameters:
          - name: limit
            in: query
            type: integer
            minimum: 1
            maximum: 100
            default: 20
            description: Number of images to return
          - name: offset
            in: query
            type: integer
            minimum: 0
            default: 0
            description: Offset for pagination
        responses:
          200:
            description: Images retrieved successfully
            schema:
              type: object
              properties:
                data:
                  type: array
                  items:
                    type: object
                has_more:
                  type: boolean
          401:
            description: Invalid or missing token
          404:
            description: Not a chat app
        """
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        parser = reqparse.RequestParser()
        parser.add_argument("limit", type=int, required=False, default=20, location="args")
        parser.add_argument("offset", type=int, required=False, default=0, location="args")
        args = parser.parse_args()

        limit = min(args["limit"], 100)
        offset = max(args["offset"], 0)

        # Get images for the user
        query = (
            db.session.query(UserGeneratedImage)
            .filter(UserGeneratedImage.app_id == app_model.id, UserGeneratedImage.end_user_id == end_user.id)
            .order_by(UserGeneratedImage.created_at.desc())
        )

        total_count = query.count()
        images = query.limit(limit).offset(offset).all()

        return {"data": images, "has_more": (offset + limit) < total_count}


class ImageDetailApi(Resource):
    @validate_user_token_and_extract_info
    @marshal_with(image_fields)
    def get(self, app_model: App, end_user: EndUser, image_id):
        """Get a specific generated image.
        ---
        tags:
          - service/image
        summary: Get image details
        description: Get details of a specific generated image
        security:
          - ApiKeyAuth: []
        parameters:
          - name: image_id
            in: path
            required: true
            type: string
            format: uuid
            description: ID of the image to retrieve
        responses:
          200:
            description: Image retrieved successfully
            schema:
              type: object
          401:
            description: Invalid or missing token
          404:
            description: Image not found or not a chat app
        """
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        image_id = str(image_id)

        # Get the image
        image = (
            db.session.query(UserGeneratedImage)
            .filter(
                UserGeneratedImage.id == image_id,
                UserGeneratedImage.app_id == app_model.id,
                UserGeneratedImage.end_user_id == end_user.id,
            )
            .first()
        )

        if not image:
            raise NotFound("Image not found")

        return image


# Register API resources
api.add_resource(ImageGenerateApi, "/images/generate")
api.add_resource(ImageListApi, "/images")
api.add_resource(ImageDetailApi, "/images/<uuid:image_id>", endpoint="image_detail")
