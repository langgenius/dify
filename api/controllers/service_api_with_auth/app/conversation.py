import services
from controllers.service_api_with_auth import api
from controllers.service_api_with_auth.app.error import NotChatAppError
from controllers.service_api_with_auth.wraps import (
    FetchUserArg,
    WhereisUserArg,
    validate_app_token,
)
from core.app.entities.app_invoke_entities import InvokeFrom
from extensions.ext_database import db
from fields.conversation_fields import (
    conversation_delete_fields,
    conversation_infinite_scroll_pagination_fields,
    simple_conversation_fields,
)
from flask_restful import Resource, marshal_with, reqparse  # type: ignore
from flask_restful.inputs import int_range  # type: ignore
from libs.helper import uuid_value
from models.model import App, AppMode, EndUser
from services.conversation_service import ConversationService
from sqlalchemy.orm import Session  # type: ignore
from werkzeug.exceptions import NotFound


class ConversationApi(Resource):
    @validate_app_token
    @marshal_with(conversation_infinite_scroll_pagination_fields)
    def get(self, app_model: App, end_user: EndUser):
        """Get conversations list.
        ---
        tags:
          - app/conversation
        summary: List conversations
        description: Get a paginated list of conversations for the current user
        security:
          - ApiKeyAuth: []
        parameters:
          - name: last_id
            in: query
            type: string
            format: uuid
            description: ID of the last conversation for pagination
          - name: limit
            in: query
            type: integer
            minimum: 1
            maximum: 100
            default: 20
            description: Number of conversations to return
          - name: sort_by
            in: query
            type: string
            enum: [created_at, -created_at, updated_at, -updated_at]
            default: -updated_at
            description: Field to sort by, prefix with - for descending order
        responses:
          200:
            description: Conversations retrieved successfully
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
        parser.add_argument("last_id", type=uuid_value, location="args")
        parser.add_argument("limit", type=int_range(1, 100), required=False, default=20, location="args")
        parser.add_argument(
            "sort_by",
            type=str,
            choices=["created_at", "-created_at", "updated_at", "-updated_at"],
            required=False,
            default="-updated_at",
            location="args",
        )
        args = parser.parse_args()

        try:
            with Session(db.engine) as session:
                return ConversationService.pagination_by_last_id(
                    session=session,
                    app_model=app_model,
                    user=end_user,
                    last_id=args["last_id"],
                    limit=args["limit"],
                    invoke_from=InvokeFrom.SERVICE_API,
                    sort_by=args["sort_by"],
                )
        except services.errors.conversation.LastConversationNotExistsError:
            raise NotFound("Last Conversation Not Exists.")


class ConversationDetailApi(Resource):
    @validate_app_token
    @marshal_with(conversation_delete_fields)
    def delete(self, app_model: App, end_user: EndUser, c_id):
        """Delete a conversation.
        ---
        tags:
          - app/conversation
        summary: Delete conversation
        description: Delete a specific conversation
        security:
          - ApiKeyAuth: []
        parameters:
          - name: c_id
            in: path
            required: true
            type: string
            format: uuid
            description: ID of the conversation to delete
        responses:
          200:
            description: Conversation deleted successfully
            schema:
              type: object
              properties:
                result:
                  type: string
                  example: success
          401:
            description: Invalid or missing token
          404:
            description: Conversation not found or not a chat app
        """
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        conversation_id = str(c_id)

        try:
            ConversationService.delete(app_model, conversation_id, end_user)
        except services.errors.conversation.ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")
        return {"result": "success"}, 200


class ConversationRenameApi(Resource):
    @validate_app_token
    @marshal_with(simple_conversation_fields)
    def post(self, app_model: App, end_user: EndUser, c_id):
        """Rename a conversation.
        ---
        tags:
          - app/conversation
        summary: Rename conversation
        description: Change the name of a specific conversation
        security:
          - ApiKeyAuth: []
        parameters:
          - name: c_id
            in: path
            required: true
            type: string
            format: uuid
            description: ID of the conversation to rename
          - name: body
            in: body
            required: true
            schema:
              type: object
              required:
                - name
              properties:
                name:
                  type: string
                  description: New name for the conversation
                auto_generate:
                  type: boolean
                  default: false
                  description: Whether to auto-generate the name
        responses:
          200:
            description: Conversation renamed successfully
            schema:
              type: object
              properties:
                id:
                  type: string
                  format: uuid
                name:
                  type: string
          400:
            description: Invalid request
          401:
            description: Invalid or missing token
          404:
            description: Conversation not found or not a chat app
        """
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        conversation_id = str(c_id)

        parser = reqparse.RequestParser()
        parser.add_argument("name", type=str, required=False, location="json")
        parser.add_argument("auto_generate", type=bool, required=False, default=False, location="json")
        args = parser.parse_args()

        try:
            return ConversationService.rename(app_model, conversation_id, end_user, args["name"], args["auto_generate"])
        except services.errors.conversation.ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")


api.add_resource(ConversationRenameApi, "/conversations/<uuid:c_id>/name", endpoint="conversation_name")
api.add_resource(ConversationApi, "/conversations")
api.add_resource(ConversationDetailApi, "/conversations/<uuid:c_id>", endpoint="conversation_detail")
