from typing import Literal

import sqlalchemy as sa
from flask import abort, request
from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, or_
from sqlalchemy.orm import selectinload
from werkzeug.exceptions import NotFound

from controllers.common.schema import register_schema_models
from controllers.console import console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, edit_permission_required, setup_required
from core.app.entities.app_invoke_entities import InvokeFrom
from extensions.ext_database import db
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
from fields.conversation_fields import (
    ResultResponse,
)
from libs.datetime_utils import naive_utc_now, parse_time_range
from libs.login import current_account_with_tenant, login_required
from models import Conversation, EndUser, Message, MessageAnnotation
from models.model import AppMode
from services.conversation_service import ConversationService
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
    ConversationResponse,
    ConversationPaginationResponse,
    ConversationMessageDetailResponse,
    ConversationWithSummaryPaginationResponse,
    ConversationDetailResponse,
    ResultResponse,
    CompletionConversationQuery,
    ChatConversationQuery,
)


@console_ns.route("/apps/<uuid:app_id>/completion-conversations")
class CompletionConversationApi(Resource):
    @console_ns.doc("list_completion_conversations")
    @console_ns.doc(description="Get completion conversations with pagination and filtering")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[CompletionConversationQuery.__name__])
    @console_ns.response(200, "Success", console_ns.models[ConversationPaginationResponse.__name__])
    @console_ns.response(403, "Insufficient permissions")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=AppMode.COMPLETION)
    @edit_permission_required
    def get(self, app_model):
        current_user, _ = current_account_with_tenant()
        args = CompletionConversationQuery.model_validate(request.args.to_dict(flat=True))

        query = sa.select(Conversation).where(
            Conversation.app_id == app_model.id, Conversation.mode == "completion", Conversation.is_deleted.is_(False)
        )

        if args.keyword:
            from libs.helper import escape_like_pattern

            escaped_keyword = escape_like_pattern(args.keyword)
            query = query.join(Message, Message.conversation_id == Conversation.id).where(
                or_(
                    Message.query.ilike(f"%{escaped_keyword}%", escape="\\"),
                    Message.answer.ilike(f"%{escaped_keyword}%", escape="\\"),
                )
            )

        account = current_user
        assert account.timezone is not None

        try:
            start_datetime_utc, end_datetime_utc = parse_time_range(args.start, args.end, account.timezone)
        except ValueError as e:
            abort(400, description=str(e))

        if start_datetime_utc:
            query = query.where(Conversation.created_at >= start_datetime_utc)

        if end_datetime_utc:
            end_datetime_utc = end_datetime_utc.replace(second=59)
            query = query.where(Conversation.created_at < end_datetime_utc)

        # FIXME, the type ignore in this file
        if args.annotation_status == "annotated":
            query = (
                query.options(selectinload(Conversation.message_annotations))  # type: ignore[arg-type]
                .join(  # type: ignore
                    MessageAnnotation, MessageAnnotation.conversation_id == Conversation.id
                )
                .distinct()
            )
        elif args.annotation_status == "not_annotated":
            query = (
                query.outerjoin(MessageAnnotation, MessageAnnotation.conversation_id == Conversation.id)
                .group_by(Conversation.id)
                .having(func.count(MessageAnnotation.id) == 0)
            )

        query = query.order_by(Conversation.created_at.desc())

        conversations = db.paginate(query, page=args.page, per_page=args.limit, error_out=False)

        return ConversationPaginationResponse.model_validate(conversations, from_attributes=True).model_dump(
            mode="json"
        )


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
    @get_app_model(mode=AppMode.COMPLETION)
    @edit_permission_required
    def get(self, app_model, conversation_id):
        conversation_id = str(conversation_id)
        return ConversationMessageDetailResponse.model_validate(
            _get_conversation(app_model, conversation_id), from_attributes=True
        ).model_dump(mode="json")

    @console_ns.doc("delete_completion_conversation")
    @console_ns.doc(description="Delete a completion conversation")
    @console_ns.doc(params={"app_id": "Application ID", "conversation_id": "Conversation ID"})
    @console_ns.response(204, "Conversation deleted successfully")
    @console_ns.response(403, "Insufficient permissions")
    @console_ns.response(404, "Conversation not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=AppMode.COMPLETION)
    @edit_permission_required
    def delete(self, app_model, conversation_id):
        current_user, _ = current_account_with_tenant()
        conversation_id = str(conversation_id)

        try:
            ConversationService.delete(app_model, conversation_id, current_user)
        except ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")

        return ResultResponse(result="success").model_dump(mode="json"), 204


@console_ns.route("/apps/<uuid:app_id>/chat-conversations")
class ChatConversationApi(Resource):
    @console_ns.doc("list_chat_conversations")
    @console_ns.doc(description="Get chat conversations with pagination, filtering and summary")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[ChatConversationQuery.__name__])
    @console_ns.response(200, "Success", console_ns.models[ConversationWithSummaryPaginationResponse.__name__])
    @console_ns.response(403, "Insufficient permissions")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT])
    @edit_permission_required
    def get(self, app_model):
        current_user, _ = current_account_with_tenant()
        args = ChatConversationQuery.model_validate(request.args.to_dict(flat=True))

        subquery = (
            sa.select(Conversation.id.label("conversation_id"), EndUser.session_id.label("from_end_user_session_id"))
            .outerjoin(EndUser, Conversation.from_end_user_id == EndUser.id)
            .subquery()
        )

        query = sa.select(Conversation).where(Conversation.app_id == app_model.id, Conversation.is_deleted.is_(False))

        if args.keyword:
            from libs.helper import escape_like_pattern

            escaped_keyword = escape_like_pattern(args.keyword)
            keyword_filter = f"%{escaped_keyword}%"
            query = (
                query.join(
                    Message,
                    Message.conversation_id == Conversation.id,
                )
                .join(subquery, subquery.c.conversation_id == Conversation.id)
                .where(
                    or_(
                        Message.query.ilike(keyword_filter, escape="\\"),
                        Message.answer.ilike(keyword_filter, escape="\\"),
                        Conversation.name.ilike(keyword_filter, escape="\\"),
                        Conversation.introduction.ilike(keyword_filter, escape="\\"),
                        subquery.c.from_end_user_session_id.ilike(keyword_filter, escape="\\"),
                    ),
                )
                .group_by(Conversation.id)
            )

        account = current_user
        assert account.timezone is not None

        try:
            start_datetime_utc, end_datetime_utc = parse_time_range(args.start, args.end, account.timezone)
        except ValueError as e:
            abort(400, description=str(e))

        if start_datetime_utc:
            match args.sort_by:
                case "updated_at" | "-updated_at":
                    query = query.where(Conversation.updated_at >= start_datetime_utc)
                case "created_at" | "-created_at" | _:
                    query = query.where(Conversation.created_at >= start_datetime_utc)

        if end_datetime_utc:
            end_datetime_utc = end_datetime_utc.replace(second=59)
            match args.sort_by:
                case "updated_at" | "-updated_at":
                    query = query.where(Conversation.updated_at <= end_datetime_utc)
                case "created_at" | "-created_at" | _:
                    query = query.where(Conversation.created_at <= end_datetime_utc)

        match args.annotation_status:
            case "annotated":
                query = (
                    query.options(selectinload(Conversation.message_annotations))  # type: ignore[arg-type]
                    .join(  # type: ignore
                        MessageAnnotation, MessageAnnotation.conversation_id == Conversation.id
                    )
                    .distinct()
                )
            case "not_annotated":
                query = (
                    query.outerjoin(MessageAnnotation, MessageAnnotation.conversation_id == Conversation.id)
                    .group_by(Conversation.id)
                    .having(func.count(MessageAnnotation.id) == 0)
                )
            case "all":
                pass

        if app_model.mode == AppMode.ADVANCED_CHAT:
            query = query.where(Conversation.invoke_from != InvokeFrom.DEBUGGER)

        match args.sort_by:
            case "created_at":
                query = query.order_by(Conversation.created_at.asc())
            case "-created_at":
                query = query.order_by(Conversation.created_at.desc())
            case "updated_at":
                query = query.order_by(Conversation.updated_at.asc())
            case "-updated_at":
                query = query.order_by(Conversation.updated_at.desc())
            case _:
                query = query.order_by(Conversation.created_at.desc())

        conversations = db.paginate(query, page=args.page, per_page=args.limit, error_out=False)

        return ConversationWithSummaryPaginationResponse.model_validate(conversations, from_attributes=True).model_dump(
            mode="json"
        )


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
    @get_app_model(mode=[AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT])
    @edit_permission_required
    def get(self, app_model, conversation_id):
        conversation_id = str(conversation_id)
        return ConversationDetailResponse.model_validate(
            _get_conversation(app_model, conversation_id), from_attributes=True
        ).model_dump(mode="json")

    @console_ns.doc("delete_chat_conversation")
    @console_ns.doc(description="Delete a chat conversation")
    @console_ns.doc(params={"app_id": "Application ID", "conversation_id": "Conversation ID"})
    @console_ns.response(204, "Conversation deleted successfully")
    @console_ns.response(403, "Insufficient permissions")
    @console_ns.response(404, "Conversation not found")
    @setup_required
    @login_required
    @get_app_model(mode=[AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT])
    @account_initialization_required
    @edit_permission_required
    def delete(self, app_model, conversation_id):
        current_user, _ = current_account_with_tenant()
        conversation_id = str(conversation_id)

        try:
            ConversationService.delete(app_model, conversation_id, current_user)
        except ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")

        return ResultResponse(result="success").model_dump(mode="json"), 204


def _get_conversation(app_model, conversation_id):
    current_user, _ = current_account_with_tenant()
    conversation = db.session.scalar(
        sa.select(Conversation).where(Conversation.id == conversation_id, Conversation.app_id == app_model.id).limit(1)
    )

    if not conversation:
        raise NotFound("Conversation Not Exists.")

    db.session.execute(
        sa.update(Conversation)
        .where(Conversation.id == conversation_id, Conversation.read_at.is_(None))
        # Keep updated_at unchanged when only marking a conversation as read.
        .values(
            read_at=naive_utc_now(),
            read_account_id=current_user.id,
            updated_at=Conversation.updated_at,
        )
    )
    db.session.commit()
    db.session.refresh(conversation)

    return conversation
