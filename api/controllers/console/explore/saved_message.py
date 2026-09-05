from uuid import UUID

from flask import request
from werkzeug.exceptions import NotFound

from controllers.common.controller_schemas import SavedMessageCreatePayload, SavedMessageListQuery
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.app.error import AppUnavailableError
from controllers.console.explore.error import NotCompletionAppError
from controllers.console.explore.wraps import InstalledAppResource
from controllers.console.wraps import model_validate, with_current_user_id
from extensions.ext_application_services import application_services
from fields.conversation_fields import ResultResponse
from fields.message_fields import SavedMessageInfiniteScrollPagination
from libs.helper import dump_response
from models.model import InstalledApp
from services.app_definition_query_service import AppDefinitionUnavailableError
from services.errors.message import MessageNotExistsError
from services.saved_message_service import SavedMessageActor

register_schema_models(console_ns, SavedMessageListQuery, SavedMessageCreatePayload)
register_response_schema_models(console_ns, ResultResponse, SavedMessageInfiniteScrollPagination)


def _require_completion_app(installed_app: InstalledApp) -> str:
    app_id = installed_app.app_id
    try:
        mode = application_services().app_definitions.get_mode(app_id)
    except AppDefinitionUnavailableError:
        raise AppUnavailableError() from None

    if mode != "completion":
        raise NotCompletionAppError()
    return app_id


@console_ns.route("/installed-apps/<uuid:installed_app_id>/saved-messages", endpoint="installed_app_saved_messages")
class SavedMessageListApi(InstalledAppResource):
    @console_ns.doc(params=query_params_from_model(SavedMessageListQuery))
    @console_ns.response(200, "Success", console_ns.models[SavedMessageInfiniteScrollPagination.__name__])
    @with_current_user_id
    def get(
        self,
        current_user_id: str,
        installed_app: InstalledApp,
    ) -> dict[str, object]:
        app_id = _require_completion_app(installed_app)
        query = SavedMessageListQuery.model_validate(request.args.to_dict())

        pagination = application_services().saved_messages.pagination_by_last_id(
            app_id=app_id,
            actor=SavedMessageActor.account(current_user_id),
            last_id=str(query.last_id) if query.last_id else None,
            limit=query.limit,
        )
        return dump_response(SavedMessageInfiniteScrollPagination, pagination)

    @console_ns.expect(console_ns.models[SavedMessageCreatePayload.__name__])
    @console_ns.response(200, "Success", console_ns.models[ResultResponse.__name__])
    @with_current_user_id
    @model_validate(SavedMessageCreatePayload)
    def post(
        self,
        req_data: SavedMessageCreatePayload,
        current_user_id: str,
        installed_app: InstalledApp,
    ) -> dict[str, object]:
        app_id = _require_completion_app(installed_app)

        try:
            application_services().saved_messages.save(
                app_id=app_id,
                actor=SavedMessageActor.account(current_user_id),
                message_id=str(req_data.message_id),
            )
        except MessageNotExistsError:
            raise NotFound("Message Not Exists.")

        return ResultResponse(result="success").model_dump(mode="json")


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/saved-messages/<uuid:message_id>", endpoint="installed_app_saved_message"
)
class SavedMessageApi(InstalledAppResource):
    @console_ns.response(204, "Saved message deleted successfully")
    @with_current_user_id
    def delete(
        self,
        current_user_id: str,
        installed_app: InstalledApp,
        message_id: UUID,
    ) -> tuple[str, int]:
        app_id = _require_completion_app(installed_app)
        application_services().saved_messages.delete(
            app_id=app_id,
            actor=SavedMessageActor.account(current_user_id),
            message_id=str(message_id),
        )

        return "", 204
