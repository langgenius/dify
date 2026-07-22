from typing import Any
from uuid import UUID

from flask import request
from pydantic import BaseModel, Field, TypeAdapter
from sqlalchemy.orm import sessionmaker
from werkzeug.exceptions import NotFound

from controllers.common.controller_schemas import ConversationRenamePayload
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console.app.error import AppUnavailableError
from controllers.console.explore.error import NotChatAppError
from controllers.console.explore.wraps import InstalledAppResource
from controllers.console.wraps import with_current_user
from core.app.entities.app_invoke_entities import InvokeFrom
from extensions.ext_database import db
from fields.conversation_fields import (
    ConversationInfiniteScrollPagination,
    ConversationResponseSource,
    ResultResponse,
    SimpleConversation,
)
from libs.helper import UUIDStrOrEmpty
from models import Account
from models.model import AppMode, InstalledApp
from services.conversation_service import ConversationService
from services.errors.conversation import ConversationNotExistsError, LastConversationNotExistsError
from services.web_conversation_service import WebConversationService

from .. import console_ns


class ConversationListQuery(BaseModel):
    last_id: UUIDStrOrEmpty | None = None
    limit: int = Field(default=20, ge=1, le=100)
    pinned: bool | None = None


register_schema_models(console_ns, ConversationListQuery, ConversationRenamePayload)
register_response_schema_models(
    console_ns,
    ConversationInfiniteScrollPagination,
    ResultResponse,
    SimpleConversation,
)


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/conversations",
    endpoint="installed_app_conversations",
)
class ConversationListApi(InstalledAppResource):
    @console_ns.doc(params=query_params_from_model(ConversationListQuery))
    @console_ns.response(200, "Success", console_ns.models[ConversationInfiniteScrollPagination.__name__])
    @with_current_user
    def get(self, current_user: Account, installed_app: InstalledApp):
        app_model = installed_app.app_with_session(session=db.session())
        if app_model is None:
            raise AppUnavailableError()
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
            with sessionmaker(db.engine).begin() as session:
                pagination = WebConversationService.pagination_by_last_id(
                    session=session,
                    app_model=app_model,
                    user=current_user,
                    last_id=args.last_id or None,
                    limit=args.limit,
                    invoke_from=InvokeFrom.EXPLORE,
                    pinned=args.pinned,
                )
                adapter = TypeAdapter(SimpleConversation)
                conversations = [
                    adapter.validate_python(
                        ConversationResponseSource(item, session=session),
                        from_attributes=True,
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


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/conversations/<uuid:c_id>",
    endpoint="installed_app_conversation",
)
class ConversationApi(InstalledAppResource):
    @console_ns.response(204, "Conversation deleted successfully")
    @with_current_user
    def delete(self, current_user: Account, installed_app: InstalledApp, c_id: UUID):
        app_model = installed_app.app_with_session(session=db.session())
        if app_model is None:
            raise AppUnavailableError()
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        conversation_id = str(c_id)
        try:
            ConversationService.delete(app_model, conversation_id, current_user, session=db.session())
        except ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")

        return "", 204


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/conversations/<uuid:c_id>/name",
    endpoint="installed_app_conversation_rename",
)
class ConversationRenameApi(InstalledAppResource):
    @console_ns.expect(console_ns.models[ConversationRenamePayload.__name__])
    @console_ns.response(200, "Conversation renamed successfully", console_ns.models[SimpleConversation.__name__])
    @with_current_user
    def post(self, current_user: Account, installed_app: InstalledApp, c_id: UUID):
        app_model = installed_app.app_with_session(session=db.session())
        if app_model is None:
            raise AppUnavailableError()
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        conversation_id = str(c_id)

        payload = ConversationRenamePayload.model_validate(console_ns.payload or {})

        try:
            session = db.session()
            conversation = ConversationService.rename(
                app_model, conversation_id, current_user, payload.name, payload.auto_generate, session=session
            )
            return (
                TypeAdapter(SimpleConversation)
                .validate_python(ConversationResponseSource(conversation, session=session), from_attributes=True)
                .model_dump(mode="json")
            )
        except ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/conversations/<uuid:c_id>/pin",
    endpoint="installed_app_conversation_pin",
)
class ConversationPinApi(InstalledAppResource):
    @console_ns.response(200, "Success", console_ns.models[ResultResponse.__name__])
    @with_current_user
    def patch(self, current_user: Account, installed_app: InstalledApp, c_id: UUID):
        app_model = installed_app.app_with_session(session=db.session())
        if app_model is None:
            raise AppUnavailableError()
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        conversation_id = str(c_id)

        try:
            WebConversationService.pin(app_model, conversation_id, current_user, db.session())
        except ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")

        return ResultResponse(result="success").model_dump(mode="json")


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/conversations/<uuid:c_id>/unpin",
    endpoint="installed_app_conversation_unpin",
)
class ConversationUnPinApi(InstalledAppResource):
    @console_ns.response(200, "Success", console_ns.models[ResultResponse.__name__])
    @with_current_user
    def patch(self, current_user: Account, installed_app: InstalledApp, c_id: UUID):
        app_model = installed_app.app_with_session(session=db.session())
        if app_model is None:
            raise AppUnavailableError()
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        conversation_id = str(c_id)
        WebConversationService.unpin(app_model, conversation_id, current_user, db.session())

        return ResultResponse(result="success").model_dump(mode="json")
