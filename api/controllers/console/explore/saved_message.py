from uuid import UUID

from flask import request
from pydantic import TypeAdapter
from werkzeug.exceptions import NotFound

from controllers.common.controller_schemas import SavedMessageCreatePayload, SavedMessageListQuery
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.app.error import AppUnavailableError
from controllers.console.explore.error import NotCompletionAppError
from controllers.console.explore.wraps import InstalledAppResource
from controllers.console.wraps import with_current_user
from fields.conversation_fields import ResultResponse
from fields.message_fields import SavedMessageInfiniteScrollPagination, SavedMessageItem
from models import Account
from models.model import InstalledApp
from services.errors.message import MessageNotExistsError
from services.saved_message_service import SavedMessageService

register_schema_models(console_ns, SavedMessageListQuery, SavedMessageCreatePayload)
register_response_schema_models(console_ns, ResultResponse, SavedMessageInfiniteScrollPagination)


@console_ns.route("/installed-apps/<uuid:installed_app_id>/saved-messages", endpoint="installed_app_saved_messages")
class SavedMessageListApi(InstalledAppResource):
    @console_ns.doc(params=query_params_from_model(SavedMessageListQuery))
    @console_ns.response(200, "Success", console_ns.models[SavedMessageInfiniteScrollPagination.__name__])
    @with_current_user
    def get(self, current_user: Account, installed_app: InstalledApp):
        app_model = installed_app.app
        if app_model is None:
            raise AppUnavailableError()
        if app_model.mode != "completion":
            raise NotCompletionAppError()

        args = SavedMessageListQuery.model_validate(request.args.to_dict())

        pagination = SavedMessageService.pagination_by_last_id(
            app_model,
            current_user,
            str(args.last_id) if args.last_id else None,
            args.limit,
        )
        adapter = TypeAdapter(SavedMessageItem)
        items = [adapter.validate_python(message, from_attributes=True) for message in pagination.data]
        return SavedMessageInfiniteScrollPagination(
            limit=pagination.limit,
            has_more=pagination.has_more,
            data=items,
        ).model_dump(mode="json")

    @console_ns.expect(console_ns.models[SavedMessageCreatePayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[ResultResponse.__name__])
    @with_current_user
    def post(self, current_user: Account, installed_app: InstalledApp):
        app_model = installed_app.app
        if app_model is None:
            raise AppUnavailableError()
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
    @console_ns.response(204, "Saved message deleted successfully")
    @with_current_user
    def delete(self, current_user: Account, installed_app: InstalledApp, message_id: UUID):
        app_model = installed_app.app
        if app_model is None:
            raise AppUnavailableError()

        message_id_str = str(message_id)

        if app_model.mode != "completion":
            raise NotCompletionAppError()

        SavedMessageService.delete(app_model, current_user, message_id_str)

        return "", 204
