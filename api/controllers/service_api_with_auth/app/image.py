from datetime import datetime, timedelta

from configs import dify_config
from controllers.service_api_with_auth import api
from controllers.service_api_with_auth.app.error import NotChatAppError, NotEnoughMessageCountError
from controllers.service_api_with_auth.wraps import validate_user_token_and_extract_info
from extensions.ext_database import db
from fields.end_user_fields import end_user_image_fields, end_user_image_list_pagination_fields
from flask_restful import Resource, marshal_with, reqparse  # type: ignore
from libs.helper import uuid_value
from models.model import App, AppMode, EndUser, UserGeneratedImage
from services.image_generation_service import ImageGenerationService
from werkzeug.exceptions import InternalServerError, NotFound


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
                - content_type
              properties:
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
                image_id:
                  type: string
                  description: ID of the generated image, futher to fetch the image details and status
                  example: 123e4567-e89b-12d3-a456-426614174000
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

        parser = reqparse.RequestParser()
        parser.add_argument(
            "content_type", required=True, type=str, choices=["self_message", "summary_advice"], location="json"
        )
        args = parser.parse_args()

        content_type = args["content_type"]

        if end_user.total_messages_count < dify_config.IMAGE_GENERATION_MIN_CONVERSATION_ROUNDS:
            raise NotEnoughMessageCountError()

        try:
            # Use the service to generate the image
            image_id = ImageGenerationService.generate_image(
                end_user=end_user,
                content_type=content_type,
            )

            return {"result": "success", "message": "Image generated successfully.", "image_id": image_id}
        except Exception:
            raise InternalServerError("Failed to generate image")


class ImageListApi(Resource):
    @validate_user_token_and_extract_info
    @marshal_with(end_user_image_list_pagination_fields)
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

        return ImageGenerationService.pagination_image_list(end_user=end_user, limit=limit, offset=offset)


class ImageDetailApi(Resource):
    @validate_user_token_and_extract_info
    @marshal_with(end_user_image_fields)
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
        image_id = str(image_id)
        return ImageGenerationService.get_image_by_id(image_id=image_id)


# Register API resources
api.add_resource(ImageGenerateApi, "/images/generate")
api.add_resource(ImageListApi, "/images")
api.add_resource(ImageDetailApi, "/images/<uuid:image_id>")
