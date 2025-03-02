import logging

import services
from controllers.service_api_with_auth import api
from controllers.service_api_with_auth.app.error import NotChatAppError
from controllers.service_api_with_auth.wraps import FetchUserArg, WhereisUserArg, validate_user_token_and_extract_info
from core.app.entities.app_invoke_entities import InvokeFrom
from fields.conversation_fields import message_file_fields
from fields.raws import FilesContainedField
from flask_restful import Resource, fields, marshal_with, reqparse  # type: ignore
from flask_restful.inputs import int_range  # type: ignore
from libs.helper import TimestampField, uuid_value
from models.model import App, AppMode, EndUser
from services.errors.message import SuggestedQuestionsAfterAnswerDisabledError
from services.message_service import MessageService
from werkzeug.exceptions import BadRequest, InternalServerError, NotFound


class MessageListApi(Resource):
    feedback_fields = {"rating": fields.String}
    retriever_resource_fields = {
        "id": fields.String,
        "message_id": fields.String,
        "position": fields.Integer,
        "dataset_id": fields.String,
        "dataset_name": fields.String,
        "document_id": fields.String,
        "document_name": fields.String,
        "data_source_type": fields.String,
        "segment_id": fields.String,
        "score": fields.Float,
        "hit_count": fields.Integer,
        "word_count": fields.Integer,
        "segment_position": fields.Integer,
        "index_node_hash": fields.String,
        "content": fields.String,
        "created_at": TimestampField,
    }

    agent_thought_fields = {
        "id": fields.String,
        "chain_id": fields.String,
        "message_id": fields.String,
        "position": fields.Integer,
        "thought": fields.String,
        "tool": fields.String,
        "tool_labels": fields.Raw,
        "tool_input": fields.String,
        "created_at": TimestampField,
        "observation": fields.String,
        "message_files": fields.List(fields.Nested(message_file_fields)),
    }

    message_fields = {
        "id": fields.String,
        "conversation_id": fields.String,
        "parent_message_id": fields.String,
        "inputs": FilesContainedField,
        "query": fields.String,
        "answer": fields.String(attribute="re_sign_file_url_answer"),
        "message_files": fields.List(fields.Nested(message_file_fields)),
        "feedback": fields.Nested(feedback_fields, attribute="user_feedback", allow_null=True),
        "retriever_resources": fields.List(fields.Nested(retriever_resource_fields)),
        "created_at": TimestampField,
        "agent_thoughts": fields.List(fields.Nested(agent_thought_fields)),
        "status": fields.String,
        "error": fields.String,
    }

    message_infinite_scroll_pagination_fields = {
        "limit": fields.Integer,
        "has_more": fields.Boolean,
        "data": fields.List(fields.Nested(message_fields)),
    }

    @validate_user_token_and_extract_info
    @marshal_with(message_infinite_scroll_pagination_fields)
    def get(self, app_model: App, end_user: EndUser):
        """Get messages list.
        ---
        tags:
          - service/message
        summary: List messages
        description: Get a paginated list of messages for a conversation
        security:
          - ApiKeyAuth: []
        parameters:
          - name: conversation_id
            in: query
            required: true
            type: string
            format: uuid
            description: ID of the conversation to get messages for
          - name: first_id
            in: query
            type: string
            format: uuid
            description: ID of the first message for pagination
          - name: limit
            in: query
            type: integer
            minimum: 1
            maximum: 100
            default: 20
            description: Number of messages to return
        responses:
          200:
            description: Messages retrieved successfully
            schema:
              type: object
              properties:
                limit:
                  type: integer
                has_more:
                  type: boolean
                data:
                  type: array
                  items:
                    type: object
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

        parser = reqparse.RequestParser()
        parser.add_argument("conversation_id", required=True, type=uuid_value, location="args")
        parser.add_argument("first_id", type=uuid_value, location="args")
        parser.add_argument("limit", type=int_range(1, 100), required=False, default=20, location="args")
        args = parser.parse_args()

        try:
            return MessageService.pagination_by_first_id(
                app_model, end_user, args["conversation_id"], args["first_id"], args["limit"]
            )
        except services.errors.conversation.ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")
        except services.errors.message.FirstMessageNotExistsError:
            raise NotFound("First Message Not Exists.")


class MessageFeedbackApi(Resource):
    @validate_user_token_and_extract_info
    def post(self, app_model: App, end_user: EndUser, message_id):
        """Submit feedback for a message.
        ---
        tags:
          - service/message
        summary: Submit message feedback
        description: Submit user feedback for a specific message
        security:
          - ApiKeyAuth: []
        parameters:
          - name: message_id
            in: path
            required: true
            type: string
            format: uuid
            description: ID of the message to provide feedback for
          - name: body
            in: body
            required: true
            schema:
              type: object
              required:
                - rating
              properties:
                rating:
                  type: string
                  enum: [like, dislike, null]
                  description: User's rating of the message
                content:
                  type: string
                  description: Additional feedback content
        responses:
          200:
            description: Feedback submitted successfully
            schema:
              type: object
              properties:
                result:
                  type: string
                  example: success
          400:
            description: Invalid request
          401:
            description: Invalid or missing token
          404:
            description: Message not found or not a chat app
        """
        message_id = str(message_id)

        parser = reqparse.RequestParser()
        parser.add_argument("rating", type=str, choices=["like", "dislike", None], location="json")
        parser.add_argument("content", type=str, location="json")
        args = parser.parse_args()

        try:
            MessageService.create_feedback(
                app_model=app_model,
                message_id=message_id,
                user=end_user,
                rating=args.get("rating"),
                content=args.get("content"),
            )
        except services.errors.message.MessageNotExistsError:
            raise NotFound("Message Not Exists.")

        return {"result": "success"}


class MessageSuggestedApi(Resource):
    @validate_user_token_and_extract_info
    def get(self, app_model: App, end_user: EndUser, message_id):
        """Get suggested questions for a message.
        ---
        tags:
          - service/message
        summary: Get suggested questions
        description: Get suggested follow-up questions for a specific message
        security:
          - ApiKeyAuth: []
        parameters:
          - name: message_id
            in: path
            required: true
            type: string
            format: uuid
            description: ID of the message to get suggestions for
        responses:
          200:
            description: Suggested questions retrieved successfully
            schema:
              type: object
              properties:
                result:
                  type: string
                  example: success
                data:
                  type: array
                  items:
                    type: string
          400:
            description: Invalid request or suggestions disabled
          401:
            description: Invalid or missing token
          404:
            description: Message not found or not a chat app
        """
        message_id = str(message_id)
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        try:
            questions = MessageService.get_suggested_questions_after_answer(
                app_model=app_model, user=end_user, message_id=message_id, invoke_from=InvokeFrom.SERVICE_API
            )
        except services.errors.message.MessageNotExistsError:
            raise NotFound("Message Not Exists.")
        except SuggestedQuestionsAfterAnswerDisabledError:
            raise BadRequest("Suggested Questions Is Disabled.")
        except Exception:
            logging.exception("internal server error.")
            raise InternalServerError()

        return {"result": "success", "data": questions}


api.add_resource(MessageListApi, "/messages")
api.add_resource(MessageFeedbackApi, "/messages/<uuid:message_id>/feedbacks")
api.add_resource(MessageSuggestedApi, "/messages/<uuid:message_id>/suggested")
