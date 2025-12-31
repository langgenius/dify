from flask_restx import reqparse
from flask_restx.inputs import int_range
from werkzeug.exceptions import NotFound

from controllers.web import web_ns
from controllers.web.error import NotCompletionAppError
from controllers.web.wraps import WebApiResource
from fields.conversation_fields import MessageFile, ResultResponse
from fields.message_fields import (
    SavedMessageInfiniteScrollPagination,
    SavedMessageItem,
    SimpleFeedback,
    format_files_contained,
    to_timestamp,
)
from libs.helper import uuid_value
from services.errors.message import MessageNotExistsError
from services.saved_message_service import SavedMessageService


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

        parser = (
            reqparse.RequestParser()
            .add_argument("last_id", type=uuid_value, location="args")
            .add_argument("limit", type=int_range(1, 100), required=False, default=20, location="args")
        )
        args = parser.parse_args()

        pagination = SavedMessageService.pagination_by_last_id(app_model, end_user, args["last_id"], args["limit"])
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

        parser = reqparse.RequestParser().add_argument("message_id", type=uuid_value, required=True, location="json")
        args = parser.parse_args()

        try:
            SavedMessageService.save(app_model, end_user, args["message_id"])
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
