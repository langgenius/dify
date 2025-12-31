from flask_restx import reqparse
from flask_restx.inputs import int_range
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from controllers.web import web_ns
from controllers.web.error import NotChatAppError
from controllers.web.wraps import WebApiResource
from core.app.entities.app_invoke_entities import InvokeFrom
from extensions.ext_database import db
from fields.conversation_fields import (
    ConversationInfiniteScrollPagination,
    ResultResponse,
    SimpleConversation,
    format_files_contained,
    to_timestamp,
)
from libs.helper import uuid_value
from models.model import AppMode
from services.conversation_service import ConversationService
from services.errors.conversation import ConversationNotExistsError, LastConversationNotExistsError
from services.web_conversation_service import WebConversationService


@web_ns.route("/conversations")
class ConversationListApi(WebApiResource):
    @web_ns.doc("Get Conversation List")
    @web_ns.doc(description="Retrieve paginated list of conversations for a chat application.")
    @web_ns.doc(
        params={
            "last_id": {"description": "Last conversation ID for pagination", "type": "string", "required": False},
            "limit": {
                "description": "Number of conversations to return (1-100)",
                "type": "integer",
                "required": False,
                "default": 20,
            },
            "pinned": {
                "description": "Filter by pinned status",
                "type": "string",
                "enum": ["true", "false"],
                "required": False,
            },
            "sort_by": {
                "description": "Sort order",
                "type": "string",
                "enum": ["created_at", "-created_at", "updated_at", "-updated_at"],
                "required": False,
                "default": "-updated_at",
            },
        }
    )
    @web_ns.doc(
        responses={
            200: "Success",
            400: "Bad Request",
            401: "Unauthorized",
            403: "Forbidden",
            404: "App Not Found or Not a Chat App",
            500: "Internal Server Error",
        }
    )
    def get(self, app_model, end_user):
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        parser = (
            reqparse.RequestParser()
            .add_argument("last_id", type=uuid_value, location="args")
            .add_argument("limit", type=int_range(1, 100), required=False, default=20, location="args")
            .add_argument("pinned", type=str, choices=["true", "false", None], location="args")
            .add_argument(
                "sort_by",
                type=str,
                choices=["created_at", "-created_at", "updated_at", "-updated_at"],
                required=False,
                default="-updated_at",
                location="args",
            )
        )
        args = parser.parse_args()

        pinned = None
        if "pinned" in args and args["pinned"] is not None:
            pinned = args["pinned"] == "true"

        try:
            with Session(db.engine) as session:
                pagination = WebConversationService.pagination_by_last_id(
                    session=session,
                    app_model=app_model,
                    user=end_user,
                    last_id=args["last_id"],
                    limit=args["limit"],
                    invoke_from=InvokeFrom.WEB_APP,
                    pinned=pinned,
                    sort_by=args["sort_by"],
                )
                conversations = [
                    SimpleConversation(
                        id=str(item.id),
                        name=item.name,
                        inputs=format_files_contained(item.inputs),
                        status=item.status,
                        introduction=getattr(item, "introduction", None),
                        created_at=to_timestamp(item.created_at),
                        updated_at=to_timestamp(item.updated_at),
                    )
                    for item in pagination.data
                ]
                return ConversationInfiniteScrollPagination(
                    limit=pagination.limit,
                    has_more=pagination.has_more,
                    data=conversations,
                ).model_dump(mode="json")
        except LastConversationNotExistsError:
            raise NotFound("Last Conversation Not Exists.")


@web_ns.route("/conversations/<uuid:c_id>")
class ConversationApi(WebApiResource):
    @web_ns.doc("Delete Conversation")
    @web_ns.doc(description="Delete a specific conversation.")
    @web_ns.doc(params={"c_id": {"description": "Conversation UUID", "type": "string", "required": True}})
    @web_ns.doc(
        responses={
            204: "Conversation deleted successfully",
            400: "Bad Request",
            401: "Unauthorized",
            403: "Forbidden",
            404: "Conversation Not Found or Not a Chat App",
            500: "Internal Server Error",
        }
    )
    def delete(self, app_model, end_user, c_id):
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        conversation_id = str(c_id)
        try:
            ConversationService.delete(app_model, conversation_id, end_user)
        except ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")
        return ResultResponse(result="success").model_dump(mode="json"), 204


@web_ns.route("/conversations/<uuid:c_id>/name")
class ConversationRenameApi(WebApiResource):
    @web_ns.doc("Rename Conversation")
    @web_ns.doc(description="Rename a specific conversation with a custom name or auto-generate one.")
    @web_ns.doc(params={"c_id": {"description": "Conversation UUID", "type": "string", "required": True}})
    @web_ns.doc(
        params={
            "name": {"description": "New conversation name", "type": "string", "required": False},
            "auto_generate": {
                "description": "Auto-generate conversation name",
                "type": "boolean",
                "required": False,
                "default": False,
            },
        }
    )
    @web_ns.doc(
        responses={
            200: "Conversation renamed successfully",
            400: "Bad Request",
            401: "Unauthorized",
            403: "Forbidden",
            404: "Conversation Not Found or Not a Chat App",
            500: "Internal Server Error",
        }
    )
    def post(self, app_model, end_user, c_id):
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        conversation_id = str(c_id)

        parser = (
            reqparse.RequestParser()
            .add_argument("name", type=str, required=False, location="json")
            .add_argument("auto_generate", type=bool, required=False, default=False, location="json")
        )
        args = parser.parse_args()

        try:
            conversation = ConversationService.rename(
                app_model, conversation_id, end_user, args["name"], args["auto_generate"]
            )
            return SimpleConversation(
                id=str(conversation.id),
                name=conversation.name,
                inputs=format_files_contained(conversation.inputs),
                status=conversation.status,
                introduction=getattr(conversation, "introduction", None),
                created_at=to_timestamp(conversation.created_at),
                updated_at=to_timestamp(conversation.updated_at),
            ).model_dump(mode="json")
        except ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")


@web_ns.route("/conversations/<uuid:c_id>/pin")
class ConversationPinApi(WebApiResource):
    @web_ns.doc("Pin Conversation")
    @web_ns.doc(description="Pin a specific conversation to keep it at the top of the list.")
    @web_ns.doc(params={"c_id": {"description": "Conversation UUID", "type": "string", "required": True}})
    @web_ns.doc(
        responses={
            200: "Conversation pinned successfully",
            400: "Bad Request",
            401: "Unauthorized",
            403: "Forbidden",
            404: "Conversation Not Found or Not a Chat App",
            500: "Internal Server Error",
        }
    )
    def patch(self, app_model, end_user, c_id):
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        conversation_id = str(c_id)

        try:
            WebConversationService.pin(app_model, conversation_id, end_user)
        except ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")

        return ResultResponse(result="success").model_dump(mode="json")


@web_ns.route("/conversations/<uuid:c_id>/unpin")
class ConversationUnPinApi(WebApiResource):
    @web_ns.doc("Unpin Conversation")
    @web_ns.doc(description="Unpin a specific conversation to remove it from the top of the list.")
    @web_ns.doc(params={"c_id": {"description": "Conversation UUID", "type": "string", "required": True}})
    @web_ns.doc(
        responses={
            200: "Conversation unpinned successfully",
            400: "Bad Request",
            401: "Unauthorized",
            403: "Forbidden",
            404: "Conversation Not Found or Not a Chat App",
            500: "Internal Server Error",
        }
    )
    def patch(self, app_model, end_user, c_id):
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        conversation_id = str(c_id)
        WebConversationService.unpin(app_model, conversation_id, end_user)

        return ResultResponse(result="success").model_dump(mode="json")
