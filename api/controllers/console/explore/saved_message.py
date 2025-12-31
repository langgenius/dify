from flask import request
from pydantic import BaseModel, Field
from werkzeug.exceptions import NotFound

from controllers.common.schema import register_schema_models
from controllers.console import console_ns
from controllers.console.explore.error import NotCompletionAppError
from controllers.console.explore.wraps import InstalledAppResource
from fields.conversation_fields import MessageFile, ResultResponse
from fields.message_fields import (
    SavedMessageInfiniteScrollPagination,
    SavedMessageItem,
    SimpleFeedback,
    format_files_contained,
    to_timestamp,
)
from libs.helper import UUIDStrOrEmpty
from libs.login import current_account_with_tenant
from services.errors.message import MessageNotExistsError
from services.saved_message_service import SavedMessageService


class SavedMessageListQuery(BaseModel):
    last_id: UUIDStrOrEmpty | None = None
    limit: int = Field(default=20, ge=1, le=100)


class SavedMessageCreatePayload(BaseModel):
    message_id: UUIDStrOrEmpty


register_schema_models(console_ns, SavedMessageListQuery, SavedMessageCreatePayload)


@console_ns.route("/installed-apps/<uuid:installed_app_id>/saved-messages", endpoint="installed_app_saved_messages")
class SavedMessageListApi(InstalledAppResource):
    @console_ns.expect(console_ns.models[SavedMessageListQuery.__name__])
    def get(self, installed_app):
        current_user, _ = current_account_with_tenant()
        app_model = installed_app.app
        if app_model.mode != "completion":
            raise NotCompletionAppError()

        args = SavedMessageListQuery.model_validate(request.args.to_dict())

        pagination = SavedMessageService.pagination_by_last_id(
            app_model,
            current_user,
            str(args.last_id) if args.last_id else None,
            args.limit,
        )
        items: list[SavedMessageItem] = []
        for message in pagination.data:
            message_files = []
            for item in getattr(message, "message_files", []):
                if isinstance(item, dict):
                    message_files.append(MessageFile.model_validate(item))
                else:
                    message_files.append(
                        MessageFile(
                            id=str(item.id),
                            filename=getattr(item, "filename", ""),
                            type=item.type,
                            url=getattr(item, "url", None),
                            mime_type=getattr(item, "mime_type", None),
                            size=getattr(item, "size", None),
                            transfer_method=str(item.transfer_method),
                            belongs_to=getattr(item, "belongs_to", None),
                            upload_file_id=getattr(item, "upload_file_id", None),
                        )
                    )

            feedback = None
            user_feedback = getattr(message, "user_feedback", None)
            if user_feedback is not None:
                feedback = SimpleFeedback(rating=getattr(user_feedback, "rating", None))

            items.append(
                SavedMessageItem(
                    id=str(message.id),
                    inputs=format_files_contained(message.inputs),
                    query=message.query,
                    answer=message.answer,
                    message_files=message_files,
                    feedback=feedback,
                    created_at=to_timestamp(message.created_at),
                )
            )

        return SavedMessageInfiniteScrollPagination(
            limit=pagination.limit,
            has_more=pagination.has_more,
            data=items,
        ).model_dump(mode="json")

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

        return ResultResponse(result="success").model_dump(mode="json")


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

        return ResultResponse(result="success").model_dump(mode="json"), 204
