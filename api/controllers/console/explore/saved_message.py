from uuid import UUID

from flask import request
from flask_restx import fields, marshal_with
from pydantic import BaseModel, Field
from werkzeug.exceptions import NotFound

from controllers.common.schema import register_schema_models
from controllers.console import console_ns
from controllers.console.explore.error import NotCompletionAppError
from controllers.console.explore.wraps import InstalledAppResource
from fields.conversation_fields import message_file_fields
from libs.helper import TimestampField
from libs.login import current_account_with_tenant
from services.errors.message import MessageNotExistsError
from services.saved_message_service import SavedMessageService


class SavedMessageListQuery(BaseModel):
    last_id: UUID | None = None
    limit: int = Field(default=20, ge=1, le=100)


class SavedMessageCreatePayload(BaseModel):
    message_id: UUID


register_schema_models(console_ns, SavedMessageListQuery, SavedMessageCreatePayload)


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


@console_ns.route("/installed-apps/<uuid:installed_app_id>/saved-messages", endpoint="installed_app_saved_messages")
class SavedMessageListApi(InstalledAppResource):
    saved_message_infinite_scroll_pagination_fields = {
        "limit": fields.Integer,
        "has_more": fields.Boolean,
        "data": fields.List(fields.Nested(message_fields)),
    }

    @marshal_with(saved_message_infinite_scroll_pagination_fields)
    @console_ns.expect(console_ns.models[SavedMessageListQuery.__name__])
    def get(self, installed_app):
        current_user, _ = current_account_with_tenant()
        app_model = installed_app.app
        if app_model.mode != "completion":
            raise NotCompletionAppError()

        args = SavedMessageListQuery.model_validate(request.args.to_dict())

        return SavedMessageService.pagination_by_last_id(
            app_model,
            current_user,
            str(args.last_id) if args.last_id else None,
            args.limit,
        )

    @console_ns.expect(console_ns.models[SavedMessageCreatePayload.__name__])
    def post(self, installed_app):
        current_user, _ = current_account_with_tenant()
        app_model = installed_app.app
        if app_model.mode != "completion":
            raise NotCompletionAppError()

        payload = SavedMessageCreatePayload.model_validate(console_ns.payload or {})

        try:
            SavedMessageService.save(app_model, current_user, str(payload.message_id))
        except MessageNotExistsError:
            raise NotFound("Message Not Exists.")

        return {"result": "success"}


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/saved-messages/<uuid:message_id>", endpoint="installed_app_saved_message"
)
class SavedMessageApi(InstalledAppResource):
    def delete(self, installed_app, message_id):
        current_user, _ = current_account_with_tenant()
        app_model = installed_app.app

        message_id = str(message_id)

        if app_model.mode != "completion":
            raise NotCompletionAppError()

        SavedMessageService.delete(app_model, current_user, message_id)

        return {"result": "success"}, 204
