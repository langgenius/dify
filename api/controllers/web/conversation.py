from typing import Literal

from flask import request
from pydantic import BaseModel, Field, TypeAdapter, field_validator, model_validator
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from controllers.common.schema import register_schema_models
from controllers.web import web_ns
from controllers.web.error import NotChatAppError
from controllers.web.wraps import WebApiResource
from core.app.entities.app_invoke_entities import InvokeFrom
from extensions.ext_database import db
from fields.conversation_fields import (
    ConversationInfiniteScrollPagination,
    ResultResponse,
    SimpleConversation,
)
from libs.helper import uuid_value
from models.model import AppMode
from services.conversation_service import ConversationService
from services.errors.conversation import ConversationNotExistsError, LastConversationNotExistsError
from services.web_conversation_service import WebConversationService


class ConversationListQuery(BaseModel):
    last_id: str | None = None
    limit: int = Field(default=20, ge=1, le=100)
    pinned: bool | None = None
    sort_by: Literal["created_at", "-created_at", "updated_at", "-updated_at"] = "-updated_at"

    @field_validator("last_id")
    @classmethod
    def validate_last_id(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return uuid_value(value)


class ConversationRenamePayload(BaseModel):
    name: str | None = None
    auto_generate: bool = False

    @model_validator(mode="after")
    def validate_name_requirement(self):
        if not self.auto_generate:
            if self.name is None or not self.name.strip():
                raise ValueError("name is required when auto_generate is false")
        return self


register_schema_models(web_ns, ConversationListQuery, ConversationRenamePayload)


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

        raw_args = request.args.to_dict()
        query = ConversationListQuery.model_validate(raw_args)

        try:
            with Session(db.engine) as session:
                pagination = WebConversationService.pagination_by_last_id(
                    session=session,
                    app_model=app_model,
                    user=end_user,
                    last_id=query.last_id,
                    limit=query.limit,
                    invoke_from=InvokeFrom.WEB_APP,
                    pinned=query.pinned,
                    sort_by=query.sort_by,
                )
                adapter = TypeAdapter(SimpleConversation)
                conversations = [adapter.validate_python(item, from_attributes=True) for item in pagination.data]
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

        payload = ConversationRenamePayload.model_validate(web_ns.payload or {})

        try:
            conversation = ConversationService.rename(
                app_model, conversation_id, end_user, payload.name, payload.auto_generate
            )
            return (
                TypeAdapter(SimpleConversation)
                .validate_python(conversation, from_attributes=True)
                .model_dump(mode="json")
            )
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
