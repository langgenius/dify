import logging

from flask_restful import Resource, fields, marshal_with, reqparse
from flask_restful.inputs import int_range
from werkzeug.exceptions import BadRequest, InternalServerError, NotFound

import services
from controllers.service_api import api
from controllers.service_api.app.error import NotChatAppError
from controllers.service_api.wraps import FetchUserArg, WhereisUserArg, validate_app_token
from core.app.entities.app_invoke_entities import InvokeFrom
from fields.conversation_fields import message_file_fields
from libs.helper import TimestampField, uuid_value
from models.model import App, AppMode, EndUser
from services.errors.message import SuggestedQuestionsAfterAnswerDisabledError
from services.message_service import MessageService


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
        "message_files": fields.List(fields.String, attribute="files"),
    }

    message_fields = {
        "id": fields.String,
        "conversation_id": fields.String,
        "inputs": fields.Raw,
        "query": fields.String,
        "answer": fields.String(attribute="re_sign_file_url_answer"),
        "message_files": fields.List(fields.Nested(message_file_fields), attribute="files"),
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

    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.QUERY))
    @marshal_with(message_infinite_scroll_pagination_fields)
    def get(self, app_model: App, end_user: EndUser):
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in [AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT]:
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
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.JSON, required=True))
    def post(self, app_model: App, end_user: EndUser, message_id):
        message_id = str(message_id)

        parser = reqparse.RequestParser()
        parser.add_argument("rating", type=str, choices=["like", "dislike", None], location="json")
        args = parser.parse_args()

        try:
            MessageService.create_feedback(app_model, message_id, end_user, args["rating"])
        except services.errors.message.MessageNotExistsError:
            raise NotFound("Message Not Exists.")

        return {"result": "success"}


class MessageSuggestedApi(Resource):
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.QUERY, required=True))
    def get(self, app_model: App, end_user: EndUser, message_id):
        message_id = str(message_id)
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in [AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT]:
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
