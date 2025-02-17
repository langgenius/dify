from flask_restful import fields, marshal_with, reqparse  # type: ignore
from flask_restful.inputs import int_range  # type: ignore
from werkzeug.exceptions import NotFound

from controllers.web import api
from controllers.web.error import NotCompletionAppError
from controllers.web.wraps import WebApiResource
from fields.conversation_fields import message_file_fields
from libs.helper import TimestampField, uuid_value
from services.errors.message import MessageNotExistsError
from services.saved_message_service import SavedMessageService

feedback_fields = {"rating": fields.String}

message_fields = {
    "id": fields.String,
    "inputs": fields.Raw,
    "query": fields.String,
    "answer": fields.String,
    "message_files": fields.List(fields.Nested(message_file_fields)),
    "feedback": fields.Nested(feedback_fields, attribute="user_feedback", allow_null=True),
    "created_at": TimestampField,
}


class SavedMessageListApi(WebApiResource):
    saved_message_infinite_scroll_pagination_fields = {
        "limit": fields.Integer,
        "has_more": fields.Boolean,
        "data": fields.List(fields.Nested(message_fields)),
    }

    @marshal_with(saved_message_infinite_scroll_pagination_fields)
    def get(self, app_model, end_user):
        if app_model.mode != "completion":
            raise NotCompletionAppError()

        parser = reqparse.RequestParser()
        parser.add_argument("last_id", type=uuid_value, location="args")
        parser.add_argument("limit", type=int_range(1, 100), required=False, default=20, location="args")
        args = parser.parse_args()

        return SavedMessageService.pagination_by_last_id(app_model, end_user, args["last_id"], args["limit"])

    def post(self, app_model, end_user):
        if app_model.mode != "completion":
            raise NotCompletionAppError()

        parser = reqparse.RequestParser()
        parser.add_argument("message_id", type=uuid_value, required=True, location="json")
        args = parser.parse_args()

        try:
            SavedMessageService.save(app_model, end_user, args["message_id"])
        except MessageNotExistsError:
            raise NotFound("Message Not Exists.")

        return {"result": "success"}


class SavedMessageApi(WebApiResource):
    def delete(self, app_model, end_user, message_id):
        message_id = str(message_id)

        if app_model.mode != "completion":
            raise NotCompletionAppError()

        SavedMessageService.delete(app_model, end_user, message_id)

        return {"result": "success"}


api.add_resource(SavedMessageListApi, "/saved-messages")
api.add_resource(SavedMessageApi, "/saved-messages/<uuid:message_id>")
