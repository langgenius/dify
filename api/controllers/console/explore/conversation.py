from typing import Any

from flask import request
from pydantic import BaseModel, Field, TypeAdapter, model_validator
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from controllers.common.schema import register_schema_models
from controllers.console.explore.error import NotChatAppError
from controllers.console.explore.wraps import InstalledAppResource
from core.app.entities.app_invoke_entities import InvokeFrom
from extensions.ext_database import db
from fields.conversation_fields import (
    ConversationInfiniteScrollPagination,
    ResultResponse,
    SimpleConversation,
)
from libs.helper import UUIDStrOrEmpty
from libs.login import current_user
from models import Account
from models.model import AppMode
from services.conversation_service import ConversationService
from services.errors.conversation import ConversationNotExistsError, LastConversationNotExistsError
from services.web_conversation_service import WebConversationService

from .. import console_ns


class ConversationListQuery(BaseModel):
    last_id: UUIDStrOrEmpty | None = None
    limit: int = Field(default=20, ge=1, le=100)
    pinned: bool | None = None


class ConversationRenamePayload(BaseModel):
    name: str | None = None
    auto_generate: bool = False

    @model_validator(mode="after")
    def validate_name_requirement(self):
        if not self.auto_generate:
            if self.name is None or not self.name.strip():
                raise ValueError("name is required when auto_generate is false")
        return self


register_schema_models(console_ns, ConversationListQuery, ConversationRenamePayload)


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/conversations",
    endpoint="installed_app_conversations",
)
class ConversationListApi(InstalledAppResource):
    @console_ns.expect(console_ns.models[ConversationListQuery.__name__])
    def get(self, installed_app):
        app_model = installed_app.app
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        raw_args: dict[str, Any] = {
            "last_id": request.args.get("last_id"),
            "limit": request.args.get("limit", default=20, type=int),
            "pinned": request.args.get("pinned"),
        }
        if raw_args["last_id"] is None:
            raw_args["last_id"] = None
        pinned_value = raw_args["pinned"]
        if isinstance(pinned_value, str):
            raw_args["pinned"] = pinned_value == "true"
        args = ConversationListQuery.model_validate(raw_args)

        try:
            if not isinstance(current_user, Account):
                raise ValueError("current_user must be an Account instance")
            with Session(db.engine) as session:
                pagination = WebConversationService.pagination_by_last_id(
                    session=session,
                    app_model=app_model,
                    user=current_user,
                    last_id=str(args.last_id) if args.last_id else None,
                    limit=args.limit,
                    invoke_from=InvokeFrom.EXPLORE,
                    pinned=args.pinned,
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


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/conversations/<uuid:c_id>",
    endpoint="installed_app_conversation",
)
class ConversationApi(InstalledAppResource):
    def delete(self, installed_app, c_id):
        app_model = installed_app.app
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        conversation_id = str(c_id)
        try:
            if not isinstance(current_user, Account):
                raise ValueError("current_user must be an Account instance")
            ConversationService.delete(app_model, conversation_id, current_user)
        except ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")

        return ResultResponse(result="success").model_dump(mode="json"), 204


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/conversations/<uuid:c_id>/name",
    endpoint="installed_app_conversation_rename",
)
class ConversationRenameApi(InstalledAppResource):
    @console_ns.expect(console_ns.models[ConversationRenamePayload.__name__])
    def post(self, installed_app, c_id):
        app_model = installed_app.app
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        conversation_id = str(c_id)

        payload = ConversationRenamePayload.model_validate(console_ns.payload or {})

        try:
            if not isinstance(current_user, Account):
                raise ValueError("current_user must be an Account instance")
            conversation = ConversationService.rename(
                app_model, conversation_id, current_user, payload.name, payload.auto_generate
            )
            return (
                TypeAdapter(SimpleConversation)
                .validate_python(conversation, from_attributes=True)
                .model_dump(mode="json")
            )
        except ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/conversations/<uuid:c_id>/pin",
    endpoint="installed_app_conversation_pin",
)
class ConversationPinApi(InstalledAppResource):
    def patch(self, installed_app, c_id):
        app_model = installed_app.app
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        conversation_id = str(c_id)

        try:
            if not isinstance(current_user, Account):
                raise ValueError("current_user must be an Account instance")
            WebConversationService.pin(app_model, conversation_id, current_user)
        except ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")

        return ResultResponse(result="success").model_dump(mode="json")


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/conversations/<uuid:c_id>/unpin",
    endpoint="installed_app_conversation_unpin",
)
class ConversationUnPinApi(InstalledAppResource):
    def patch(self, installed_app, c_id):
        app_model = installed_app.app
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        conversation_id = str(c_id)
        if not isinstance(current_user, Account):
            raise ValueError("current_user must be an Account instance")
        WebConversationService.unpin(app_model, conversation_id, current_user)

        return ResultResponse(result="success").model_dump(mode="json")
