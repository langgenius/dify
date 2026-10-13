from http import HTTPStatus
from typing import Literal
from uuid import UUID

import sqlalchemy as sa
from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from controllers.common.errors import InvalidArgumentError, UnauthorizedError
from controllers.common.rbac import PlainApp, RBACCheck
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.common.session import with_session
from controllers.console import console_ns
from controllers.console.app.error import AppNotFoundError
from controllers.console.app.wraps import get_app_model
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import (
    RBACPermission,
    account_initialization_required,
    edit_permission_required,
    rbac_permission_required,
    setup_required,
    validate_request,
    with_current_user,
)
from enums.account import TenantAccountRole
from extensions.ext_application_services import application_services
from fields.conversation_fields import (
    Conversation as ConversationResponse,
)
from fields.conversation_fields import (
    ConversationDetail as ConversationDetailResponse,
)
from fields.conversation_fields import (
    ConversationMessageDetail as ConversationMessageDetailResponse,
)
from fields.conversation_fields import (
    ConversationPagination as ConversationPaginationResponse,
)
from fields.conversation_fields import ConversationResponseSource
from fields.conversation_fields import (
    ConversationWithSummaryPagination as ConversationWithSummaryPaginationResponse,
)
from libs.datetime_utils import naive_utc_now, parse_time_range
from libs.helper import dump_response
from libs.login import login_required
from machinery.context import RequestContext
from models import Conversation
from models.account import Account
from models.model import App, AppMode
from services.app.console_service import ConsoleAppNotFoundError
from services.conversation_service import ConversationService
from services.entities.conversation_entities import ConsoleConversationFilters
from services.errors.base import NoPermissionError
from services.errors.conversation import ConversationNotExistsError


class BaseConversationQuery(BaseModel):
    keyword: str | None = Field(default=None, description="Search keyword")
    start: str | None = Field(default=None, description="Start date (YYYY-MM-DD HH:MM)")
    end: str | None = Field(default=None, description="End date (YYYY-MM-DD HH:MM)")
    annotation_status: Literal["annotated", "not_annotated", "all"] = Field(
        default="all", description="Annotation status filter"
    )
    page: int = Field(default=1, ge=1, le=99999, description="Page number")
    limit: int = Field(default=20, ge=1, le=100, description="Page size (1-100)")

    @field_validator("start", "end", mode="before")
    @classmethod
    def blank_to_none(cls, value: str | None) -> str | None:
        if value == "":
            return None
        return value


class CompletionConversationQuery(BaseConversationQuery):
    pass


class ChatConversationQuery(BaseConversationQuery):
    sort_by: Literal["created_at", "-created_at", "updated_at", "-updated_at"] = Field(
        default="-updated_at", description="Sort field and direction"
    )


register_schema_models(
    console_ns,
    CompletionConversationQuery,
    ChatConversationQuery,
)
register_response_schema_models(
    console_ns,
    ConversationResponse,
    ConversationPaginationResponse,
    ConversationMessageDetailResponse,
    ConversationWithSummaryPaginationResponse,
    ConversationDetailResponse,
)


@console_ns.route("/apps/<uuid:app_id>/completion-conversations")
class CompletionConversationApi(Resource):
    @console_ns.doc("list_completion_conversations")
    @console_ns.doc(description="Get completion conversations with pagination and filtering")
    @console_ns.doc(params={"app_id": "Application ID", **query_params_from_model(CompletionConversationQuery)})
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[ConversationPaginationResponse.__name__])
    @console_ns.response(HTTPStatus.BAD_REQUEST, "Invalid date range")
    @console_ns.response(HTTPStatus.UNAUTHORIZED, "Authentication required")
    @console_ns.response(HTTPStatus.FORBIDDEN, "Insufficient permissions")
    @console_ns.response(HTTPStatus.NOT_FOUND, "App not found")
    @console_ns.response(HTTPStatus.UNPROCESSABLE_ENTITY, "Invalid query parameters")
    @console_account_admission(
        allowed_roles=frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR}),
        rbac_checks=(RBACCheck(RBACPermission.APP_VIEW_LAYOUT, PlainApp()),),
    )
    def get(self, request_context: RequestContext, app_id: UUID) -> dict[str, object]:
        queries = application_services().conversation_queries
        try:
            scope = queries.get_console_scope(request_context, str(app_id), kind="completion")
        except ConsoleAppNotFoundError as exc:
            raise AppNotFoundError(str(exc)) from exc
        except NoPermissionError as exc:
            raise UnauthorizedError(str(exc)) from exc
        req_data = validate_request(CompletionConversationQuery)
        try:
            start, end = parse_time_range(req_data.start, req_data.end, scope.timezone)
        except ValueError as exc:
            raise InvalidArgumentError(str(exc)) from exc
        try:
            page = queries.get_console_page(
                scope=scope,
                filters=ConsoleConversationFilters(
                    keyword=req_data.keyword,
                    start=start,
                    end=end.replace(second=59) if end else None,
                    annotation_status=req_data.annotation_status,
                    sort_by="-created_at",
                    page=req_data.page,
                    limit=req_data.limit,
                ),
            )
        except ConsoleAppNotFoundError as exc:
            raise AppNotFoundError(str(exc)) from exc
        return dump_response(ConversationPaginationResponse, page)


@console_ns.route("/apps/<uuid:app_id>/completion-conversations/<uuid:conversation_id>")
class CompletionConversationDetailApi(Resource):
    @console_ns.doc("get_completion_conversation")
    @console_ns.doc(description="Get completion conversation details with messages")
    @console_ns.doc(params={"app_id": "Application ID", "conversation_id": "Conversation ID"})
    @console_ns.response(200, "Success", console_ns.models[ConversationMessageDetailResponse.__name__])
    @console_ns.response(403, "Insufficient permissions")
    @console_ns.response(404, "Conversation not found")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_current_user
    @rbac_permission_required(RBACCheck(RBACPermission.APP_VIEW_LAYOUT, PlainApp()))
    @with_session
    @get_app_model(mode=AppMode.COMPLETION)
    def get(self, session: Session, current_user: Account, app_model: App, conversation_id: UUID):
        conversation_id_str = str(conversation_id)
        return dump_response(
            ConversationMessageDetailResponse,
            ConversationResponseSource(
                _get_conversation(session, current_user, app_model, conversation_id_str), session=session
            ),
        )

    @console_ns.doc("delete_completion_conversation")
    @console_ns.doc(description="Delete a completion conversation")
    @console_ns.doc(params={"app_id": "Application ID", "conversation_id": "Conversation ID"})
    @console_ns.response(204, "Conversation deleted successfully")
    @console_ns.response(403, "Insufficient permissions")
    @console_ns.response(404, "Conversation not found")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACCheck(RBACPermission.APP_EDIT, PlainApp()))
    @with_current_user
    @with_session
    @get_app_model(mode=AppMode.COMPLETION)
    def delete(self, session: Session, current_user: Account, app_model: App, conversation_id: UUID):
        conversation_id_str = str(conversation_id)

        try:
            ConversationService.delete(app_model, conversation_id_str, current_user, session=session)
        except ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")

        return "", 204


@console_ns.route("/apps/<uuid:app_id>/chat-conversations")
class ChatConversationApi(Resource):
    @console_ns.doc("list_chat_conversations")
    @console_ns.doc(description="Get chat conversations with pagination and filtering")
    @console_ns.doc(params={"app_id": "Application ID", **query_params_from_model(ChatConversationQuery)})
    @console_ns.response(
        HTTPStatus.OK, "Success", console_ns.models[ConversationWithSummaryPaginationResponse.__name__]
    )
    @console_ns.response(HTTPStatus.BAD_REQUEST, "Invalid date range")
    @console_ns.response(HTTPStatus.UNAUTHORIZED, "Authentication required")
    @console_ns.response(HTTPStatus.FORBIDDEN, "Insufficient permissions")
    @console_ns.response(HTTPStatus.NOT_FOUND, "App not found")
    @console_ns.response(HTTPStatus.UNPROCESSABLE_ENTITY, "Invalid query parameters")
    @console_account_admission(
        allowed_roles=frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR}),
        rbac_checks=(RBACCheck(RBACPermission.APP_VIEW_LAYOUT, PlainApp()),),
    )
    def get(self, request_context: RequestContext, app_id: UUID) -> dict[str, object]:
        queries = application_services().conversation_queries
        try:
            scope = queries.get_console_scope(request_context, str(app_id), kind="chat")
        except ConsoleAppNotFoundError as exc:
            raise AppNotFoundError(str(exc)) from exc
        except NoPermissionError as exc:
            raise UnauthorizedError(str(exc)) from exc
        req_data = validate_request(ChatConversationQuery)
        try:
            start, end = parse_time_range(req_data.start, req_data.end, scope.timezone)
        except ValueError as exc:
            raise InvalidArgumentError(str(exc)) from exc
        try:
            page = queries.get_console_page(
                scope=scope,
                filters=ConsoleConversationFilters(
                    keyword=req_data.keyword,
                    start=start,
                    end=end.replace(second=59) if end else None,
                    annotation_status=req_data.annotation_status,
                    sort_by=req_data.sort_by,
                    page=req_data.page,
                    limit=req_data.limit,
                ),
            )
        except ConsoleAppNotFoundError as exc:
            raise AppNotFoundError(str(exc)) from exc
        return dump_response(ConversationWithSummaryPaginationResponse, page)


@console_ns.route("/apps/<uuid:app_id>/chat-conversations/<uuid:conversation_id>")
class ChatConversationDetailApi(Resource):
    @console_ns.doc("get_chat_conversation")
    @console_ns.doc(description="Get chat conversation details")
    @console_ns.doc(params={"app_id": "Application ID", "conversation_id": "Conversation ID"})
    @console_ns.response(200, "Success", console_ns.models[ConversationDetailResponse.__name__])
    @console_ns.response(403, "Insufficient permissions")
    @console_ns.response(404, "Conversation not found")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @with_current_user
    @rbac_permission_required(RBACCheck(RBACPermission.APP_VIEW_LAYOUT, PlainApp()))
    @with_session
    @get_app_model(mode=[AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT])
    def get(self, session: Session, current_user: Account, app_model: App, conversation_id: UUID):
        conversation_id_str = str(conversation_id)
        return dump_response(
            ConversationDetailResponse,
            ConversationResponseSource(
                _get_conversation(session, current_user, app_model, conversation_id_str), session=session
            ),
        )

    @console_ns.doc("delete_chat_conversation")
    @console_ns.doc(description="Delete a chat conversation")
    @console_ns.doc(params={"app_id": "Application ID", "conversation_id": "Conversation ID"})
    @console_ns.response(204, "Conversation deleted successfully")
    @console_ns.response(403, "Insufficient permissions")
    @console_ns.response(404, "Conversation not found")
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACCheck(RBACPermission.APP_EDIT, PlainApp()))
    @with_current_user
    @with_session
    @get_app_model(mode=[AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT])
    def delete(self, session: Session, current_user: Account, app_model: App, conversation_id: UUID):
        conversation_id_str = str(conversation_id)

        try:
            ConversationService.delete(app_model, conversation_id_str, current_user, session=session)
        except ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")

        return "", 204


def _get_conversation(session: Session, current_user: Account, app_model, conversation_id):
    conversation = session.scalar(
        sa.select(Conversation).where(Conversation.id == conversation_id, Conversation.app_id == app_model.id).limit(1)
    )

    if not conversation:
        raise NotFound("Conversation Not Exists.")

    session.execute(
        sa.update(Conversation)
        .where(Conversation.id == conversation_id, Conversation.read_at.is_(None))
        # Keep updated_at unchanged when only marking a conversation as read.
        .values(
            {
                Conversation.read_at: naive_utc_now(),
                Conversation.read_account_id: current_user.id,
                Conversation.updated_at: Conversation.updated_at,
            }
        )
    )
    session.flush()
    session.refresh(conversation)

    return conversation
