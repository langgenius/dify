from flask_restx import fields, marshal_with, reqparse
from flask_restx.inputs import int_range
from werkzeug.exceptions import NotFound

from controllers.console import api
from controllers.console.explore.error import NotCompletionAppError
from controllers.console.explore.wraps import InstalledAppResource
from fields.conversation_fields import message_file_fields
from libs.helper import TimestampField, uuid_value
from libs.login import current_user
from models import Account
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


class SavedMessageListApi(InstalledAppResource):
    saved_message_infinite_scroll_pagination_fields = {
        "limit": fields.Integer,
        "has_more": fields.Boolean,
        "data": fields.List(fields.Nested(message_fields)),
    }

    @marshal_with(saved_message_infinite_scroll_pagination_fields)
    def get(self, installed_app):
        app_model = installed_app.app
        if app_model.mode != "completion":
            raise NotCompletionAppError()

        parser = reqparse.RequestParser()
        parser.add_argument("last_id", type=uuid_value, location="args")
        parser.add_argument("limit", type=int_range(1, 100), required=False, default=20, location="args")
        args = parser.parse_args()

        if not isinstance(current_user, Account):
            raise ValueError("current_user must be an Account instance")
        return SavedMessageService.pagination_by_last_id(app_model, current_user, args["last_id"], args["limit"])

    def post(self, installed_app):
        app_model = installed_app.app
        if app_model.mode != "completion":
            raise NotCompletionAppError()

        parser = reqparse.RequestParser()
        parser.add_argument("message_id", type=uuid_value, required=True, location="json")
        args = parser.parse_args()

        try:
            if not isinstance(current_user, Account):
                raise ValueError("current_user must be an Account instance")
            SavedMessageService.save(app_model, current_user, args["message_id"])
        except MessageNotExistsError:
            raise NotFound("Message Not Exists.")

        return {"result": "success"}


class SavedMessageApi(InstalledAppResource):
    def delete(self, installed_app, message_id):
        app_model = installed_app.app

        message_id = str(message_id)

        if app_model.mode != "completion":
            raise NotCompletionAppError()

        if not isinstance(current_user, Account):
            raise ValueError("current_user must be an Account instance")
        SavedMessageService.delete(app_model, current_user, message_id)

        return {"result": "success"}, 204


api.add_resource(
    SavedMessageListApi,
    "/installed-apps/<uuid:installed_app_id>/saved-messages",
    endpoint="installed_app_saved_messages",
)
api.add_resource(
    SavedMessageApi,
    "/installed-apps/<uuid:installed_app_id>/saved-messages/<uuid:message_id>",
    endpoint="installed_app_saved_message",
)
