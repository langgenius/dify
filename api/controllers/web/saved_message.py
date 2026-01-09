from flask import request
from pydantic import BaseModel, Field, TypeAdapter
from werkzeug.exceptions import NotFound

from controllers.common.schema import register_schema_models
from controllers.web import web_ns
from controllers.web.error import NotCompletionAppError
from controllers.web.wraps import WebApiResource
from fields.conversation_fields import ResultResponse
from fields.message_fields import SavedMessageInfiniteScrollPagination, SavedMessageItem
from libs.helper import UUIDStrOrEmpty
from services.errors.message import MessageNotExistsError
from services.saved_message_service import SavedMessageService


class SavedMessageListQuery(BaseModel):
    last_id: UUIDStrOrEmpty | None = None
    limit: int = Field(default=20, ge=1, le=100)


class SavedMessageCreatePayload(BaseModel):
    message_id: UUIDStrOrEmpty


register_schema_models(web_ns, SavedMessageListQuery, SavedMessageCreatePayload)


@web_ns.route("/saved-messages")
class SavedMessageListApi(WebApiResource):
    @web_ns.doc("Get Saved Messages")
    @web_ns.doc(description="Retrieve paginated list of saved messages for a completion application.")
    @web_ns.doc(
        params={
            "last_id": {"description": "Last message ID for pagination", "type": "string", "required": False},
            "limit": {
                "description": "Number of messages to return (1-100)",
                "type": "integer",
                "required": False,
                "default": 20,
            },
        }
    )
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
    def get(self, app_model, end_user):
        if app_model.mode != "completion":
            raise NotCompletionAppError()

        raw_args = request.args.to_dict()
        query = SavedMessageListQuery.model_validate(raw_args)

        pagination = SavedMessageService.pagination_by_last_id(app_model, end_user, query.last_id, query.limit)
        adapter = TypeAdapter(SavedMessageItem)
        items = [adapter.validate_python(message, from_attributes=True) for message in pagination.data]
        return SavedMessageInfiniteScrollPagination(
            limit=pagination.limit,
            has_more=pagination.has_more,
            data=items,
        ).model_dump(mode="json")

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
    def post(self, app_model, end_user):
        if app_model.mode != "completion":
            raise NotCompletionAppError()

        payload = SavedMessageCreatePayload.model_validate(web_ns.payload or {})

        try:
            SavedMessageService.save(app_model, end_user, payload.message_id)
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
    def delete(self, app_model, end_user, message_id):
        message_id = str(message_id)

        if app_model.mode != "completion":
            raise NotCompletionAppError()

        SavedMessageService.delete(app_model, end_user, message_id)

        return ResultResponse(result="success").model_dump(mode="json"), 204
