from uuid import UUID

from werkzeug.exceptions import NotFound

from controllers.common.controller_schemas import SavedMessageCreatePayload, SavedMessageListQuery
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console.wraps import model_validate
from controllers.web import web_ns
from controllers.web.error import NotCompletionAppError
from controllers.web.wraps import WebApiResource
from extensions.ext_application_services import application_services
from fields.conversation_fields import ResultResponse
from fields.message_fields import SavedMessageInfiniteScrollPagination
from libs.helper import dump_response
from models.model import App, EndUser
from services.errors.message import MessageNotExistsError
from services.saved_message_service import SavedMessageActor

register_schema_models(web_ns, SavedMessageListQuery, SavedMessageCreatePayload)
register_response_schema_models(web_ns, ResultResponse, SavedMessageInfiniteScrollPagination)


@web_ns.route("/saved-messages")
class SavedMessageListApi(WebApiResource):
    @web_ns.doc("Get Saved Messages")
    @web_ns.doc(description="Retrieve paginated list of saved messages for a completion application.")
    @web_ns.doc(params=query_params_from_model(SavedMessageListQuery))
    @web_ns.doc(
        responses={
            200: "Success",
            400: "Bad Request - Not a completion app",
            401: "Unauthorized",
            403: "Forbidden",
            404: "App Not Found",
            500: "Internal Server Error",
        }
    )
    @web_ns.response(200, "Success", web_ns.models[SavedMessageInfiniteScrollPagination.__name__])
    @model_validate(SavedMessageListQuery)
    def get(self, query: SavedMessageListQuery, app_model: App, end_user: EndUser) -> dict[str, object]:
        if app_model.mode != "completion":
            raise NotCompletionAppError()

        pagination = application_services().saved_messages.pagination_by_last_id(
            app_id=app_model.id,
            actor=SavedMessageActor.end_user(end_user.id),
            last_id=query.last_id,
            limit=query.limit,
        )
        return dump_response(SavedMessageInfiniteScrollPagination, pagination)

    @web_ns.doc("Save Message")
    @web_ns.doc(description="Save a specific message for later reference.")
    @web_ns.doc(
        params={
            "message_id": {"description": "Message UUID to save", "type": "string", "required": True},
        }
    )
    @web_ns.doc(
        responses={
            200: "Message saved successfully",
            400: "Bad Request - Not a completion app",
            401: "Unauthorized",
            403: "Forbidden",
            404: "Message Not Found",
            500: "Internal Server Error",
        }
    )
    @web_ns.response(200, "Message saved successfully", web_ns.models[ResultResponse.__name__])
    @web_ns.expect(web_ns.models[SavedMessageCreatePayload.__name__])
    @model_validate(SavedMessageCreatePayload)
    def post(self, payload: SavedMessageCreatePayload, app_model: App, end_user: EndUser) -> dict[str, object]:
        if app_model.mode != "completion":
            raise NotCompletionAppError()

        try:
            application_services().saved_messages.save(
                app_id=app_model.id,
                actor=SavedMessageActor.end_user(end_user.id),
                message_id=payload.message_id,
            )
        except MessageNotExistsError:
            raise NotFound("Message Not Exists.")

        return ResultResponse(result="success").model_dump(mode="json")


@web_ns.route("/saved-messages/<uuid:message_id>")
class SavedMessageApi(WebApiResource):
    @web_ns.doc("Delete Saved Message")
    @web_ns.doc(description="Remove a message from saved messages.")
    @web_ns.doc(params={"message_id": {"description": "Message UUID to delete", "type": "string", "required": True}})
    @web_ns.doc(
        responses={
            204: "Message removed successfully",
            400: "Bad Request - Not a completion app",
            401: "Unauthorized",
            403: "Forbidden",
            404: "Message Not Found",
            500: "Internal Server Error",
        }
    )
    @web_ns.response(204, "Message removed successfully")
    def delete(self, app_model: App, end_user: EndUser, message_id: UUID) -> tuple[str, int]:
        message_id_str = str(message_id)

        if app_model.mode != "completion":
            raise NotCompletionAppError()

        application_services().saved_messages.delete(
            app_id=app_model.id,
            actor=SavedMessageActor.end_user(end_user.id),
            message_id=message_id_str,
        )

        return "", 204
