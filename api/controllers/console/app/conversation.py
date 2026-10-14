from http import HTTPStatus
from typing import Literal
from uuid import UUID

from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator

from controllers.common.errors import ConversationNotFoundHTTPError, InvalidArgumentError, UnauthorizedError
from controllers.common.rbac import PlainApp, RBACCheck
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.app.error import AppNotFoundError
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import RBACPermission, validate_request
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
from fields.conversation_fields import (
    ConversationWithSummaryPagination as ConversationWithSummaryPaginationResponse,
)
from libs.datetime_utils import parse_time_range
from libs.helper import dump_response
from machinery.context import RequestContext
from services.app.console_service import ConsoleAppNotFoundError
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
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[ConversationMessageDetailResponse.__name__])
    @console_ns.response(HTTPStatus.UNAUTHORIZED, "Authentication required")
    @console_ns.response(HTTPStatus.FORBIDDEN, "Insufficient permissions")
    @console_ns.response(HTTPStatus.NOT_FOUND, "App or conversation not found")
    @console_account_admission(
        allowed_roles=frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR}),
        rbac_checks=(RBACCheck(RBACPermission.APP_VIEW_LAYOUT, PlainApp()),),
    )
    def get(self, request_context: RequestContext, app_id: UUID, conversation_id: UUID) -> dict[str, object]:
        services = application_services()
        try:
            detail = services.conversation_queries.get_console_detail(
                request_context, str(app_id), str(conversation_id), kind="completion"
            )
            response = dump_response(ConversationMessageDetailResponse, detail)
            # Preserve the Console read receipt only after rendering succeeds.
            services.conversation_commands.mark_console_read(
                request_context, str(app_id), str(conversation_id), kind="completion"
            )
        except ConsoleAppNotFoundError as exc:
            raise AppNotFoundError(str(exc)) from exc
        except ConversationNotExistsError as exc:
            raise ConversationNotFoundHTTPError() from exc
        return response

    @console_ns.doc("delete_completion_conversation")
    @console_ns.doc(description="Delete a completion conversation")
    @console_ns.doc(params={"app_id": "Application ID", "conversation_id": "Conversation ID"})
    @console_ns.response(HTTPStatus.NO_CONTENT, "Conversation deleted successfully")
    @console_ns.response(HTTPStatus.UNAUTHORIZED, "Authentication required")
    @console_ns.response(HTTPStatus.FORBIDDEN, "Insufficient permissions")
    @console_ns.response(HTTPStatus.NOT_FOUND, "App or conversation not found")
    @console_account_admission(
        allowed_roles=frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR}),
        rbac_checks=(RBACCheck(RBACPermission.APP_EDIT, PlainApp()),),
    )
    def delete(self, request_context: RequestContext, app_id: UUID, conversation_id: UUID) -> tuple[str, HTTPStatus]:
        try:
            application_services().conversation_commands.delete_console(
                request_context, str(app_id), str(conversation_id), kind="completion"
            )
        except ConsoleAppNotFoundError as exc:
            raise AppNotFoundError(str(exc)) from exc
        except ConversationNotExistsError as exc:
            raise ConversationNotFoundHTTPError() from exc
        return "", HTTPStatus.NO_CONTENT


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
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[ConversationDetailResponse.__name__])
    @console_ns.response(HTTPStatus.UNAUTHORIZED, "Authentication required")
    @console_ns.response(HTTPStatus.FORBIDDEN, "Insufficient permissions")
    @console_ns.response(HTTPStatus.NOT_FOUND, "App or conversation not found")
    @console_account_admission(
        allowed_roles=frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR}),
        rbac_checks=(RBACCheck(RBACPermission.APP_VIEW_LAYOUT, PlainApp()),),
    )
    def get(self, request_context: RequestContext, app_id: UUID, conversation_id: UUID) -> dict[str, object]:
        services = application_services()
        try:
            detail = services.conversation_queries.get_console_detail(
                request_context, str(app_id), str(conversation_id), kind="chat"
            )
            response = dump_response(ConversationDetailResponse, detail)
            # Preserve the Console read receipt only after rendering succeeds.
            services.conversation_commands.mark_console_read(
                request_context, str(app_id), str(conversation_id), kind="chat"
            )
        except ConsoleAppNotFoundError as exc:
            raise AppNotFoundError(str(exc)) from exc
        except ConversationNotExistsError as exc:
            raise ConversationNotFoundHTTPError() from exc
        return response

    @console_ns.doc("delete_chat_conversation")
    @console_ns.doc(description="Delete a chat conversation")
    @console_ns.doc(params={"app_id": "Application ID", "conversation_id": "Conversation ID"})
    @console_ns.response(HTTPStatus.NO_CONTENT, "Conversation deleted successfully")
    @console_ns.response(HTTPStatus.UNAUTHORIZED, "Authentication required")
    @console_ns.response(HTTPStatus.FORBIDDEN, "Insufficient permissions")
    @console_ns.response(HTTPStatus.NOT_FOUND, "App or conversation not found")
    @console_account_admission(
        allowed_roles=frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR}),
        rbac_checks=(RBACCheck(RBACPermission.APP_EDIT, PlainApp()),),
    )
    def delete(self, request_context: RequestContext, app_id: UUID, conversation_id: UUID) -> tuple[str, HTTPStatus]:
        try:
            application_services().conversation_commands.delete_console(
                request_context, str(app_id), str(conversation_id), kind="chat"
            )
        except ConsoleAppNotFoundError as exc:
            raise AppNotFoundError(str(exc)) from exc
        except ConversationNotExistsError as exc:
            raise ConversationNotFoundHTTPError() from exc
        return "", HTTPStatus.NO_CONTENT
