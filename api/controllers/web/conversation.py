from http import HTTPStatus
from typing import Literal
from uuid import UUID

from flask import request
from pydantic import BaseModel, Field, field_validator

from controllers.common.controller_schemas import ConversationRenamePayload
from controllers.common.errors import (
    ConversationCursorNotFoundHTTPError,
    ConversationFirstMessageNotFoundHTTPError,
    ConversationNotFoundHTTPError,
)
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console.wraps import model_validate
from controllers.web import web_ns
from controllers.web.error import NotChatAppError
from controllers.web.wraps import WebApiResource
from extensions.ext_application_services import application_services
from fields.conversation_fields import (
    ConversationInfiniteScrollPagination,
    ResultResponse,
    SimpleConversation,
)
from libs.helper import dump_response, uuid_value
from models.model import App, AppMode, EndUser
from services.entities.conversation_entities import EndUserConversationRef, EndUserConversationScope
from services.errors.conversation import ConversationNotExistsError, LastConversationNotExistsError
from services.errors.message import MessageNotExistsError


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


register_schema_models(web_ns, ConversationListQuery, ConversationRenamePayload)
register_response_schema_models(web_ns, ConversationInfiniteScrollPagination, ResultResponse, SimpleConversation)


@web_ns.route("/conversations")
class ConversationListApi(WebApiResource):
    @web_ns.doc("Get Conversation List")
    @web_ns.doc(description="Retrieve paginated list of conversations for a chat application.")
    @web_ns.doc(params=query_params_from_model(ConversationListQuery))
    @web_ns.doc(
        responses={
            HTTPStatus.OK: "Success",
            HTTPStatus.BAD_REQUEST: "Invalid conversation list query or app mode does not match the API route.",
            HTTPStatus.UNAUTHORIZED: "Unauthorized",
            HTTPStatus.FORBIDDEN: "Forbidden",
            HTTPStatus.NOT_FOUND: (
                "`conversation_cursor_not_found`: Cursor is outside the current list. "
                "`conversation_not_found`: The app or user is no longer available."
            ),
            HTTPStatus.INTERNAL_SERVER_ERROR: "Internal Server Error",
        }
    )
    @web_ns.response(HTTPStatus.OK, "Success", web_ns.models[ConversationInfiniteScrollPagination.__name__])
    def get(self, app_model: App, end_user: EndUser) -> dict[str, object]:
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT}:
            raise NotChatAppError()

        query = ConversationListQuery.model_validate(request.args.to_dict(flat=True))
        try:
            pagination = application_services().conversation_queries.get_page(
                scope=EndUserConversationScope(
                    app_id=app_model.id,
                    tenant_id=app_model.tenant_id,
                    end_user_id=end_user.id,
                ),
                invoke_from="web-app",
                last_id=query.last_id,
                limit=query.limit,
                pinned=query.pinned,
                sort_by=query.sort_by,
            )
            return dump_response(ConversationInfiniteScrollPagination, pagination)
        except LastConversationNotExistsError as error:
            raise ConversationCursorNotFoundHTTPError() from error
        except ConversationNotExistsError as error:
            raise ConversationNotFoundHTTPError() from error


@web_ns.route("/conversations/<uuid:c_id>")
class ConversationApi(WebApiResource):
    @web_ns.doc("Delete Conversation")
    @web_ns.doc(description="Delete a specific conversation.")
    @web_ns.doc(params={"c_id": {"description": "Conversation UUID", "type": "string", "required": True}})
    @web_ns.doc(
        responses={
            HTTPStatus.NO_CONTENT: "Conversation deleted successfully",
            HTTPStatus.BAD_REQUEST: "Bad Request",
            HTTPStatus.UNAUTHORIZED: "Unauthorized",
            HTTPStatus.FORBIDDEN: "Forbidden",
            HTTPStatus.NOT_FOUND: "`conversation_not_found`: Conversation does not exist for this user and app.",
            HTTPStatus.INTERNAL_SERVER_ERROR: "Internal Server Error",
        }
    )
    def delete(self, app_model: App, end_user: EndUser, c_id: UUID) -> tuple[str, HTTPStatus]:
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT}:
            raise NotChatAppError()

        conversation_id = str(c_id)
        try:
            application_services().conversation_commands.delete(
                ref=EndUserConversationRef(
                    app_id=app_model.id,
                    tenant_id=app_model.tenant_id,
                    end_user_id=end_user.id,
                    conversation_id=conversation_id,
                )
            )
        except ConversationNotExistsError as error:
            raise ConversationNotFoundHTTPError() from error
        return "", HTTPStatus.NO_CONTENT


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
            HTTPStatus.OK: "Conversation renamed successfully; model failure preserves the existing name.",
            HTTPStatus.BAD_REQUEST: "Bad Request",
            HTTPStatus.UNAUTHORIZED: "Unauthorized",
            HTTPStatus.FORBIDDEN: "Forbidden",
            HTTPStatus.NOT_FOUND: (
                "`conversation_not_found`: Conversation does not exist. "
                "`conversation_first_message_not_found`: No first message is available for automatic naming."
            ),
            HTTPStatus.UNPROCESSABLE_ENTITY: "Invalid conversation rename payload.",
            HTTPStatus.INTERNAL_SERVER_ERROR: "Internal Server Error",
        }
    )
    @web_ns.response(HTTPStatus.OK, "Conversation renamed successfully", web_ns.models[SimpleConversation.__name__])
    @web_ns.expect(web_ns.models[ConversationRenamePayload.__name__])
    @model_validate(ConversationRenamePayload)
    def post(
        self, payload: ConversationRenamePayload, app_model: App, end_user: EndUser, c_id: UUID
    ) -> dict[str, object]:
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT}:
            raise NotChatAppError()

        conversation_id = str(c_id)

        try:
            conversation = application_services().conversation_names.rename(
                ref=EndUserConversationRef(
                    app_id=app_model.id,
                    tenant_id=app_model.tenant_id,
                    end_user_id=end_user.id,
                    conversation_id=conversation_id,
                ),
                app_mode=app_model.mode,
                name=payload.name,
                auto_generate=payload.auto_generate,
            )
            return dump_response(SimpleConversation, conversation)
        except ConversationNotExistsError as error:
            raise ConversationNotFoundHTTPError() from error
        except MessageNotExistsError as error:
            raise ConversationFirstMessageNotFoundHTTPError() from error


@web_ns.route("/conversations/<uuid:c_id>/pin")
class ConversationPinApi(WebApiResource):
    @web_ns.doc("Pin Conversation")
    @web_ns.doc(description="Pin a specific conversation to keep it at the top of the list.")
    @web_ns.doc(params={"c_id": {"description": "Conversation UUID", "type": "string", "required": True}})
    @web_ns.doc(
        responses={
            HTTPStatus.OK: "Conversation pinned successfully",
            HTTPStatus.BAD_REQUEST: "Bad Request",
            HTTPStatus.UNAUTHORIZED: "Unauthorized",
            HTTPStatus.FORBIDDEN: "Forbidden",
            HTTPStatus.NOT_FOUND: "`conversation_not_found`: Conversation does not exist for this user and app.",
            HTTPStatus.INTERNAL_SERVER_ERROR: "Internal Server Error",
        }
    )
    @web_ns.response(HTTPStatus.OK, "Conversation pinned successfully", web_ns.models[ResultResponse.__name__])
    def patch(self, app_model: App, end_user: EndUser, c_id: UUID) -> dict[str, object]:
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT}:
            raise NotChatAppError()

        conversation_id = str(c_id)

        try:
            application_services().conversation_commands.set_pinned(
                ref=EndUserConversationRef(
                    app_id=app_model.id,
                    tenant_id=app_model.tenant_id,
                    end_user_id=end_user.id,
                    conversation_id=conversation_id,
                ),
                is_pinned=True,
            )
        except ConversationNotExistsError as error:
            raise ConversationNotFoundHTTPError() from error

        return ResultResponse(result="success").model_dump(mode="json")


@web_ns.route("/conversations/<uuid:c_id>/unpin")
class ConversationUnPinApi(WebApiResource):
    @web_ns.doc("Unpin Conversation")
    @web_ns.doc(description="Remove the current user's pin. Succeeds when the conversation is already unpinned.")
    @web_ns.doc(params={"c_id": {"description": "Conversation UUID", "type": "string", "required": True}})
    @web_ns.doc(
        responses={
            HTTPStatus.OK: "Conversation unpinned successfully",
            HTTPStatus.BAD_REQUEST: "Bad Request",
            HTTPStatus.UNAUTHORIZED: "Unauthorized",
            HTTPStatus.FORBIDDEN: "Forbidden",
            HTTPStatus.NOT_FOUND: "`conversation_not_found`: The app or user is no longer available.",
            HTTPStatus.INTERNAL_SERVER_ERROR: "Internal Server Error",
        }
    )
    @web_ns.response(HTTPStatus.OK, "Conversation unpinned successfully", web_ns.models[ResultResponse.__name__])
    def patch(self, app_model: App, end_user: EndUser, c_id: UUID) -> dict[str, object]:
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT}:
            raise NotChatAppError()

        conversation_id = str(c_id)
        try:
            application_services().conversation_commands.set_pinned(
                ref=EndUserConversationRef(
                    app_id=app_model.id,
                    tenant_id=app_model.tenant_id,
                    end_user_id=end_user.id,
                    conversation_id=conversation_id,
                ),
                is_pinned=False,
            )
        except ConversationNotExistsError as error:
            raise ConversationNotFoundHTTPError() from error

        return ResultResponse(result="success").model_dump(mode="json")
