from datetime import datetime
from http import HTTPStatus
from typing import Literal
from uuid import UUID

from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from configs import dify_config
from controllers.common.errors import (
    ConversationNotFoundHTTPError,
    ForbiddenError,
    InvalidArgumentError,
    PaidPlanRequiredError,
    UnauthorizedError,
)
from controllers.common.rbac import PlainApp, RBACCheck
from controllers.common.schema import (
    query_params_from_model,
    query_params_from_request,
    register_response_schema_models,
    register_schema_models,
)
from controllers.console import console_ns
from controllers.console.app.error import AppNotFoundError
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import RBACPermission, is_cloud_edition_billing_paid_plan, validate_request
from enums import DeploymentEdition
from enums.account import TenantAccountRole
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
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
from libs.exception import BaseHTTPException
from libs.external_api import error_responses
from libs.helper import dump_response
from libs.login import current_account_with_tenant
from machinery.context import RequestContext
from services.app.console_service import ConsoleAppNotFoundError
from services.entities.conversation_entities import (
    ConsoleConversationFilters,
    ConsoleConversationLogFilters,
)
from services.errors.base import NoPermissionError
from services.errors.conversation import ConversationNotExistsError


class ConversationLogFilterQuery(BaseModel):
    keyword: str | None = Field(default=None, description="Search keyword")
    start: str | None = Field(default=None, description="Start date (YYYY-MM-DD HH:MM)")
    end: str | None = Field(default=None, description="End date (YYYY-MM-DD HH:MM)")
    annotation_status: Literal["annotated", "not_annotated", "all"] = Field(
        default="all", description="Annotation status filter"
    )

    @field_validator("start", "end", mode="before")
    @classmethod
    def blank_to_none(cls, value: str | None) -> str | None:
        if value == "":
            return None
        return value


class BaseConversationQuery(ConversationLogFilterQuery):
    page: int = Field(default=1, ge=1, le=99999, description="Page number")
    limit: int = Field(default=20, ge=1, le=100, description="Page size (1-100)")


class CompletionConversationQuery(BaseConversationQuery):
    pass


class ChatConversationFilterQuery(ConversationLogFilterQuery):
    sort_by: Literal["created_at", "-created_at", "updated_at", "-updated_at"] = Field(
        default="-updated_at", description="Sort field and direction"
    )
    end_user_ids: list[UUID] = Field(default_factory=list, description="End user IDs to include")
    account_ids: list[UUID] = Field(default_factory=list, description="Account IDs to include")


class ChatConversationQuery(BaseConversationQuery, ChatConversationFilterQuery):
    pass


class ConversationLogExportPreviewQuery(ChatConversationFilterQuery):
    model_config = ConfigDict(extra="forbid")


class _ConversationLogQueryValidationError(BaseHTTPException):
    error_code = "unprocessable_entity"
    code = HTTPStatus.UNPROCESSABLE_ENTITY


def _validate_log_query[QueryT: ChatConversationFilterQuery](model: type[QueryT]) -> QueryT:
    """Read repeated identity IDs and preserve the Console list's sanitized 422 response."""
    try:
        return query_params_from_request(model, list_fields=("end_user_ids", "account_ids"))
    except ValidationError as exc:
        raise _ConversationLogQueryValidationError(
            exc.json(include_url=False, include_input=False, include_context=False)
        ) from None


class ConversationLogExportCountsResponse(ResponseModel):
    conversation_count: int = Field(ge=0)
    message_count: int = Field(ge=0, description="CSV data rows across all matched conversations")


class ConversationLogExportPreviewResponse(ResponseModel):
    counts: ConversationLogExportCountsResponse | None = Field(description="Null if the count query timed out")


def _parse_log_time_range(query: ConversationLogFilterQuery, timezone: str) -> tuple[datetime | None, datetime | None]:
    """Normalize account-local Logs bounds, including the last second of the end minute."""
    try:
        start, end = parse_time_range(query.start, query.end, timezone)
    except ValueError as exc:
        raise InvalidArgumentError(str(exc)) from exc
    return start, end.replace(second=59) if end else None


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
    ConversationLogExportPreviewResponse,
)


@console_ns.route("/apps/<uuid:app_id>/completion-conversations")
class CompletionConversationApi(Resource):
    @error_responses(AppNotFoundError)
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
    @error_responses(AppNotFoundError, ConversationNotFoundHTTPError)
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

    @error_responses(AppNotFoundError, ConversationNotFoundHTTPError)
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
    @error_responses(AppNotFoundError)
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
        req_data = _validate_log_query(ChatConversationQuery)
        start, end = _parse_log_time_range(req_data, scope.timezone)
        try:
            page = queries.get_console_page(
                scope=scope,
                filters=ConsoleConversationFilters(
                    keyword=req_data.keyword,
                    start=start,
                    end=end,
                    annotation_status=req_data.annotation_status,
                    sort_by=req_data.sort_by,
                    end_user_ids=tuple(str(user_id) for user_id in req_data.end_user_ids),
                    account_ids=tuple(str(account_id) for account_id in req_data.account_ids),
                    page=req_data.page,
                    limit=req_data.limit,
                ),
            )
        except ConsoleAppNotFoundError as exc:
            raise AppNotFoundError(str(exc)) from exc
        return dump_response(ConversationWithSummaryPaginationResponse, page)


@console_ns.route("/apps/<uuid:app_id>/conversation-log-exports/preview")
class ConversationLogExportPreviewApi(Resource):
    @error_responses(AppNotFoundError, ForbiddenError, PaidPlanRequiredError)
    @console_ns.doc("preview_conversation_log_export")
    @console_ns.doc(description="Count the conversations and rows that match the application's chat Logs filters")
    @console_ns.doc(params={"app_id": "Application ID", **query_params_from_model(ConversationLogExportPreviewQuery)})
    @console_ns.response(
        HTTPStatus.OK, "Export preview", console_ns.models[ConversationLogExportPreviewResponse.__name__]
    )
    @console_account_admission(rbac_checks=(RBACCheck(RBACPermission.APP_LOG_AND_ANNOTATION, PlainApp()),))
    def get(self, request_context: RequestContext, app_id: UUID) -> dict[str, object]:
        """Preview a conversation log export for a workspace Owner or Admin with application Logs access."""
        # Export requires a privileged workspace role even when RBAC is enabled.
        if not TenantAccountRole.is_privileged_role(current_account_with_tenant().account.role):
            raise ForbiddenError()

        queries = application_services().conversation_queries
        try:
            scope = queries.get_console_scope(request_context, str(app_id), kind="chat")
        except ConsoleAppNotFoundError as exc:
            raise AppNotFoundError(str(exc)) from exc
        except NoPermissionError as exc:
            raise UnauthorizedError(str(exc)) from exc

        if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD and not is_cloud_edition_billing_paid_plan(
            scope.tenant_id
        ):
            raise PaidPlanRequiredError()
        query = _validate_log_query(ConversationLogExportPreviewQuery)
        start, end = _parse_log_time_range(query, scope.timezone)
        try:
            counts = queries.get_console_log_export_counts(
                scope=scope,
                filters=ConsoleConversationLogFilters(
                    keyword=query.keyword,
                    start=start,
                    end=end,
                    annotation_status=query.annotation_status,
                    sort_by=query.sort_by,
                    end_user_ids=tuple(str(user_id) for user_id in query.end_user_ids),
                    account_ids=tuple(str(account_id) for account_id in query.account_ids),
                ),
            )
        except ConsoleAppNotFoundError as exc:
            raise AppNotFoundError(str(exc)) from exc
        return dump_response(ConversationLogExportPreviewResponse, {"counts": counts})


@console_ns.route("/apps/<uuid:app_id>/chat-conversations/<uuid:conversation_id>")
class ChatConversationDetailApi(Resource):
    @error_responses(AppNotFoundError, ConversationNotFoundHTTPError)
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

    @error_responses(AppNotFoundError, ConversationNotFoundHTTPError)
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


@console_ns.route("/apps/<uuid:app_id>/advanced-chat/workflows/draft/conversations/workspaces/retire")
class AdvancedChatDebugConversationWorkspacesRetireApi(Resource):
    @error_responses(AppNotFoundError)
    @console_ns.doc("retire_advanced_chat_debug_conversation_workspaces")
    @console_ns.doc(description="Retire the Agent workspaces of the caller's ended Chatflow debug conversations")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(HTTPStatus.NO_CONTENT, "Workspaces retired")
    @console_ns.response(HTTPStatus.UNAUTHORIZED, "Authentication required")
    @console_ns.response(HTTPStatus.FORBIDDEN, "Insufficient permissions")
    @console_ns.response(HTTPStatus.NOT_FOUND, "App not found")
    @console_account_admission(
        allowed_roles=frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR}),
        rbac_checks=(RBACCheck(RBACPermission.APP_TEST_AND_RUN, PlainApp()),),
    )
    def post(self, request_context: RequestContext, app_id: UUID) -> tuple[str, HTTPStatus]:
        try:
            application_services().conversation_commands.retire_console_debug_agent_workspaces(
                request_context, str(app_id)
            )
        except ConsoleAppNotFoundError as exc:
            raise AppNotFoundError(str(exc)) from exc
        return "", HTTPStatus.NO_CONTENT
