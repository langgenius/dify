import services
from controllers.admin import api
from controllers.admin.students.error import NotChatAppError
from controllers.admin.wraps import validate_admin_token_and_extract_info
from fields.conversation_fields import message_file_fields
from fields.raws import FilesContainedField
from flask_restful import Resource, fields, marshal_with, reqparse  # type: ignore
from flask_restful.inputs import int_range  # type: ignore
from libs.helper import TimestampField, uuid_value
from models.model import Account, App, AppMode
from services.end_user_service import EndUserService
from services.message_service import MessageService
from werkzeug.exceptions import NotFound


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

    @validate_admin_token_and_extract_info
    @marshal_with(message_infinite_scroll_pagination_fields)
    def get(self, app_model: App, account: Account, student_id: str):
        """Get messages list.
        ---
        tags:
          - admin/api/students
        summary: List messages
        description: Get a paginated list of messages for a conversation
        security:
          - ApiKeyAuth: []
        parameters:
          - name: student_id
            in: path
            required: true
            type: string
            format: uuid
            description: ID of the student to get messages for
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

        end_user = EndUserService.load_end_user_by_id(student_id)
        if not end_user:
            raise NotFound("Student not found")

        # Ensure student belongs to admin's organization
        if account.current_organization_id and end_user.organization_id != account.current_organization_id:
            raise NotFound("Student not found in your organization")

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


api.add_resource(MessageListApi, "/students/<string:student_id>/messages")
