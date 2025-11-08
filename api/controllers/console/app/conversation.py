import sqlalchemy as sa
from flask import abort
from flask_restx import Resource, marshal_with, reqparse
from flask_restx.inputs import int_range
from sqlalchemy import func, or_
from sqlalchemy.orm import joinedload
from werkzeug.exceptions import NotFound

from controllers.console import api, console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, edit_permission_required, setup_required
from core.app.entities.app_invoke_entities import InvokeFrom
from extensions.ext_database import db
from fields.conversation_fields import (
    conversation_detail_fields,
    conversation_message_detail_fields,
    conversation_pagination_fields,
    conversation_with_summary_pagination_fields,
)
from libs.datetime_utils import naive_utc_now, parse_time_range
from libs.helper import DatetimeString
from libs.login import current_account_with_tenant, login_required
from models import Conversation, EndUser, Message, MessageAnnotation
from models.model import AppMode
from services.conversation_service import ConversationService
from services.errors.conversation import ConversationNotExistsError


@console_ns.route("/apps/<uuid:app_id>/completion-conversations")
class CompletionConversationApi(Resource):
    @api.doc("list_completion_conversations")
    @api.doc(description="Get completion conversations with pagination and filtering")
    @api.doc(params={"app_id": "Application ID"})
    @api.expect(
        api.parser()
        .add_argument("keyword", type=str, location="args", help="Search keyword")
        .add_argument("start", type=str, location="args", help="Start date (YYYY-MM-DD HH:MM)")
        .add_argument("end", type=str, location="args", help="End date (YYYY-MM-DD HH:MM)")
        .add_argument(
            "annotation_status",
            type=str,
            location="args",
            choices=["annotated", "not_annotated", "all"],
            default="all",
            help="Annotation status filter",
        )
        .add_argument("page", type=int, location="args", default=1, help="Page number")
        .add_argument("limit", type=int, location="args", default=20, help="Page size (1-100)")
    )
    @api.response(200, "Success", conversation_pagination_fields)
    @api.response(403, "Insufficient permissions")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=AppMode.COMPLETION)
    @marshal_with(conversation_pagination_fields)
    @edit_permission_required
    def get(self, app_model):
        current_user, _ = current_account_with_tenant()
        parser = (
            reqparse.RequestParser()
            .add_argument("keyword", type=str, location="args")
            .add_argument("start", type=DatetimeString("%Y-%m-%d %H:%M"), location="args")
            .add_argument("end", type=DatetimeString("%Y-%m-%d %H:%M"), location="args")
            .add_argument(
                "annotation_status",
                type=str,
                choices=["annotated", "not_annotated", "all"],
                default="all",
                location="args",
            )
            .add_argument("page", type=int_range(1, 99999), default=1, location="args")
            .add_argument("limit", type=int_range(1, 100), default=20, location="args")
        )
        args = parser.parse_args()

        query = sa.select(Conversation).where(
            Conversation.app_id == app_model.id, Conversation.mode == "completion", Conversation.is_deleted.is_(False)
        )

        if args["keyword"]:
            query = query.join(Message, Message.conversation_id == Conversation.id).where(
                or_(
                    Message.query.ilike(f"%{args['keyword']}%"),
                    Message.answer.ilike(f"%{args['keyword']}%"),
                )
            )

        account = current_user
        assert account.timezone is not None

        try:
            start_datetime_utc, end_datetime_utc = parse_time_range(args["start"], args["end"], account.timezone)
        except ValueError as e:
            abort(400, description=str(e))

        if start_datetime_utc:
            query = query.where(Conversation.created_at >= start_datetime_utc)

        if end_datetime_utc:
            end_datetime_utc = end_datetime_utc.replace(second=59)
            query = query.where(Conversation.created_at < end_datetime_utc)

        # FIXME, the type ignore in this file
        if args["annotation_status"] == "annotated":
            query = query.options(joinedload(Conversation.message_annotations)).join(  # type: ignore
                MessageAnnotation, MessageAnnotation.conversation_id == Conversation.id
            )
        elif args["annotation_status"] == "not_annotated":
            query = (
                query.outerjoin(MessageAnnotation, MessageAnnotation.conversation_id == Conversation.id)
                .group_by(Conversation.id)
                .having(func.count(MessageAnnotation.id) == 0)
            )

        query = query.order_by(Conversation.created_at.desc())

        conversations = db.paginate(query, page=args["page"], per_page=args["limit"], error_out=False)

        return conversations


@console_ns.route("/apps/<uuid:app_id>/completion-conversations/<uuid:conversation_id>")
class CompletionConversationDetailApi(Resource):
    @api.doc("get_completion_conversation")
    @api.doc(description="Get completion conversation details with messages")
    @api.doc(params={"app_id": "Application ID", "conversation_id": "Conversation ID"})
    @api.response(200, "Success", conversation_message_detail_fields)
    @api.response(403, "Insufficient permissions")
    @api.response(404, "Conversation not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=AppMode.COMPLETION)
    @marshal_with(conversation_message_detail_fields)
    @edit_permission_required
    def get(self, app_model, conversation_id):
        conversation_id = str(conversation_id)

        return _get_conversation(app_model, conversation_id)

    @api.doc("delete_completion_conversation")
    @api.doc(description="Delete a completion conversation")
    @api.doc(params={"app_id": "Application ID", "conversation_id": "Conversation ID"})
    @api.response(204, "Conversation deleted successfully")
    @api.response(403, "Insufficient permissions")
    @api.response(404, "Conversation not found")
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

        return {"result": "success"}, 204


@console_ns.route("/apps/<uuid:app_id>/chat-conversations")
class ChatConversationApi(Resource):
    @api.doc("list_chat_conversations")
    @api.doc(description="Get chat conversations with pagination, filtering and summary")
    @api.doc(params={"app_id": "Application ID"})
    @api.expect(
        api.parser()
        .add_argument("keyword", type=str, location="args", help="Search keyword")
        .add_argument("start", type=str, location="args", help="Start date (YYYY-MM-DD HH:MM)")
        .add_argument("end", type=str, location="args", help="End date (YYYY-MM-DD HH:MM)")
        .add_argument(
            "annotation_status",
            type=str,
            location="args",
            choices=["annotated", "not_annotated", "all"],
            default="all",
            help="Annotation status filter",
        )
        .add_argument("message_count_gte", type=int, location="args", help="Minimum message count")
        .add_argument("page", type=int, location="args", default=1, help="Page number")
        .add_argument("limit", type=int, location="args", default=20, help="Page size (1-100)")
        .add_argument(
            "sort_by",
            type=str,
            location="args",
            choices=["created_at", "-created_at", "updated_at", "-updated_at"],
            default="-updated_at",
            help="Sort field and direction",
        )
    )
    @api.response(200, "Success", conversation_with_summary_pagination_fields)
    @api.response(403, "Insufficient permissions")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT])
    @marshal_with(conversation_with_summary_pagination_fields)
    @edit_permission_required
    def get(self, app_model):
        current_user, _ = current_account_with_tenant()
        parser = (
            reqparse.RequestParser()
            .add_argument("keyword", type=str, location="args")
            .add_argument("start", type=DatetimeString("%Y-%m-%d %H:%M"), location="args")
            .add_argument("end", type=DatetimeString("%Y-%m-%d %H:%M"), location="args")
            .add_argument(
                "annotation_status",
                type=str,
                choices=["annotated", "not_annotated", "all"],
                default="all",
                location="args",
            )
            .add_argument("message_count_gte", type=int_range(1, 99999), required=False, location="args")
            .add_argument("page", type=int_range(1, 99999), required=False, default=1, location="args")
            .add_argument("limit", type=int_range(1, 100), required=False, default=20, location="args")
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

        subquery = (
            db.session.query(
                Conversation.id.label("conversation_id"), EndUser.session_id.label("from_end_user_session_id")
            )
            .outerjoin(EndUser, Conversation.from_end_user_id == EndUser.id)
            .subquery()
        )

        query = sa.select(Conversation).where(Conversation.app_id == app_model.id, Conversation.is_deleted.is_(False))

        if args["keyword"]:
            keyword_filter = f"%{args['keyword']}%"
            query = (
                query.join(
                    Message,
                    Message.conversation_id == Conversation.id,
                )
                .join(subquery, subquery.c.conversation_id == Conversation.id)
                .where(
                    or_(
                        Message.query.ilike(keyword_filter),
                        Message.answer.ilike(keyword_filter),
                        Conversation.name.ilike(keyword_filter),
                        Conversation.introduction.ilike(keyword_filter),
                        subquery.c.from_end_user_session_id.ilike(keyword_filter),
                    ),
                )
                .group_by(Conversation.id)
            )

        account = current_user
        assert account.timezone is not None

        try:
            start_datetime_utc, end_datetime_utc = parse_time_range(args["start"], args["end"], account.timezone)
        except ValueError as e:
            abort(400, description=str(e))

        if start_datetime_utc:
            match args["sort_by"]:
                case "updated_at" | "-updated_at":
                    query = query.where(Conversation.updated_at >= start_datetime_utc)
                case "created_at" | "-created_at" | _:
                    query = query.where(Conversation.created_at >= start_datetime_utc)

        if end_datetime_utc:
            end_datetime_utc = end_datetime_utc.replace(second=59)
            match args["sort_by"]:
                case "updated_at" | "-updated_at":
                    query = query.where(Conversation.updated_at <= end_datetime_utc)
                case "created_at" | "-created_at" | _:
                    query = query.where(Conversation.created_at <= end_datetime_utc)

        if args["annotation_status"] == "annotated":
            query = query.options(joinedload(Conversation.message_annotations)).join(  # type: ignore
                MessageAnnotation, MessageAnnotation.conversation_id == Conversation.id
            )
        elif args["annotation_status"] == "not_annotated":
            query = (
                query.outerjoin(MessageAnnotation, MessageAnnotation.conversation_id == Conversation.id)
                .group_by(Conversation.id)
                .having(func.count(MessageAnnotation.id) == 0)
            )

        if args["message_count_gte"] and args["message_count_gte"] >= 1:
            query = (
                query.options(joinedload(Conversation.messages))  # type: ignore
                .join(Message, Message.conversation_id == Conversation.id)
                .group_by(Conversation.id)
                .having(func.count(Message.id) >= args["message_count_gte"])
            )

        if app_model.mode == AppMode.ADVANCED_CHAT:
            query = query.where(Conversation.invoke_from != InvokeFrom.DEBUGGER)

        match args["sort_by"]:
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

        conversations = db.paginate(query, page=args["page"], per_page=args["limit"], error_out=False)

        return conversations


@console_ns.route("/apps/<uuid:app_id>/chat-conversations/<uuid:conversation_id>")
class ChatConversationDetailApi(Resource):
    @api.doc("get_chat_conversation")
    @api.doc(description="Get chat conversation details")
    @api.doc(params={"app_id": "Application ID", "conversation_id": "Conversation ID"})
    @api.response(200, "Success", conversation_detail_fields)
    @api.response(403, "Insufficient permissions")
    @api.response(404, "Conversation not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT])
    @marshal_with(conversation_detail_fields)
    @edit_permission_required
    def get(self, app_model, conversation_id):
        conversation_id = str(conversation_id)

        return _get_conversation(app_model, conversation_id)

    @api.doc("delete_chat_conversation")
    @api.doc(description="Delete a chat conversation")
    @api.doc(params={"app_id": "Application ID", "conversation_id": "Conversation ID"})
    @api.response(204, "Conversation deleted successfully")
    @api.response(403, "Insufficient permissions")
    @api.response(404, "Conversation not found")
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

        return {"result": "success"}, 204


def _get_conversation(app_model, conversation_id):
    current_user, _ = current_account_with_tenant()
    conversation = (
        db.session.query(Conversation)
        .where(Conversation.id == conversation_id, Conversation.app_id == app_model.id)
        .first()
    )

    if not conversation:
        raise NotFound("Conversation Not Exists.")

    if not conversation.read_at:
        conversation.read_at = naive_utc_now()
        conversation.read_account_id = current_user.id
        db.session.commit()

    return conversation
