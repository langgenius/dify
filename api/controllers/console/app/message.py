import logging
from typing import Literal

from flask import request
from flask_restx import Resource, fields, marshal_with
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import exists, select
from werkzeug.exceptions import InternalServerError, NotFound

from controllers.console import console_ns
from controllers.console.app.error import (
    CompletionRequestError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.console.app.wraps import get_app_model
from controllers.console.explore.error import AppSuggestedQuestionsAfterAnswerDisabledError
from controllers.console.wraps import (
    account_initialization_required,
    edit_permission_required,
    setup_required,
)
from core.app.entities.app_invoke_entities import InvokeFrom
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.model_runtime.errors.invoke import InvokeError
from extensions.ext_database import db
from fields.raws import FilesContainedField
from libs.helper import TimestampField, uuid_value
from libs.infinite_scroll_pagination import InfiniteScrollPagination
from libs.login import current_account_with_tenant, login_required
from models.model import AppMode, Conversation, Message, MessageAnnotation, MessageFeedback
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import MessageNotExistsError, SuggestedQuestionsAfterAnswerDisabledError
from services.message_service import MessageService

logger = logging.getLogger(__name__)
DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


class ChatMessagesQuery(BaseModel):
    conversation_id: str = Field(..., description="Conversation ID")
    first_id: str | None = Field(default=None, description="First message ID for pagination")
    limit: int = Field(default=20, ge=1, le=100, description="Number of messages to return (1-100)")

    @field_validator("first_id", mode="before")
    @classmethod
    def empty_to_none(cls, value: str | None) -> str | None:
        if value == "":
            return None
        return value

    @field_validator("conversation_id", "first_id")
    @classmethod
    def validate_uuid(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return uuid_value(value)


class MessageFeedbackPayload(BaseModel):
    message_id: str = Field(..., description="Message ID")
    rating: Literal["like", "dislike"] | None = Field(default=None, description="Feedback rating")

    @field_validator("message_id")
    @classmethod
    def validate_message_id(cls, value: str) -> str:
        return uuid_value(value)


class FeedbackExportQuery(BaseModel):
    from_source: Literal["user", "admin"] | None = Field(default=None, description="Filter by feedback source")
    rating: Literal["like", "dislike"] | None = Field(default=None, description="Filter by rating")
    has_comment: bool | None = Field(default=None, description="Only include feedback with comments")
    start_date: str | None = Field(default=None, description="Start date (YYYY-MM-DD)")
    end_date: str | None = Field(default=None, description="End date (YYYY-MM-DD)")
    format: Literal["csv", "json"] = Field(default="csv", description="Export format")

    @field_validator("has_comment", mode="before")
    @classmethod
    def parse_bool(cls, value: bool | str | None) -> bool | None:
        if isinstance(value, bool) or value is None:
            return value
        lowered = value.lower()
        if lowered in {"true", "1", "yes", "on"}:
            return True
        if lowered in {"false", "0", "no", "off"}:
            return False
        raise ValueError("has_comment must be a boolean value")


def reg(cls: type[BaseModel]):
    console_ns.schema_model(cls.__name__, cls.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0))


reg(ChatMessagesQuery)
reg(MessageFeedbackPayload)
reg(FeedbackExportQuery)

# Register models for flask_restx to avoid dict type issues in Swagger
# Register in dependency order: base models first, then dependent models

# Base models
simple_account_model = console_ns.model(
    "SimpleAccount",
    {
        "id": fields.String,
        "name": fields.String,
        "email": fields.String,
    },
)

message_file_model = console_ns.model(
    "MessageFile",
    {
        "id": fields.String,
        "filename": fields.String,
        "type": fields.String,
        "url": fields.String,
        "mime_type": fields.String,
        "size": fields.Integer,
        "transfer_method": fields.String,
        "belongs_to": fields.String(default="user"),
        "upload_file_id": fields.String(default=None),
    },
)

agent_thought_model = console_ns.model(
    "AgentThought",
    {
        "id": fields.String,
        "chain_id": fields.String,
        "message_id": fields.String,
        "position": fields.Integer,
        "thought": fields.String,
        "tool": fields.String,
        "tool_labels": fields.Raw,
        "tool_input": fields.String,
        "created_at": TimestampField,
        "observation": fields.String,
        "files": fields.List(fields.String),
    },
)

# Models that depend on simple_account_model
feedback_model = console_ns.model(
    "Feedback",
    {
        "rating": fields.String,
        "content": fields.String,
        "from_source": fields.String,
        "from_end_user_id": fields.String,
        "from_account": fields.Nested(simple_account_model, allow_null=True),
    },
)

annotation_model = console_ns.model(
    "Annotation",
    {
        "id": fields.String,
        "question": fields.String,
        "content": fields.String,
        "account": fields.Nested(simple_account_model, allow_null=True),
        "created_at": TimestampField,
    },
)

annotation_hit_history_model = console_ns.model(
    "AnnotationHitHistory",
    {
        "annotation_id": fields.String(attribute="id"),
        "annotation_create_account": fields.Nested(simple_account_model, allow_null=True),
        "created_at": TimestampField,
    },
)

# Message detail model that depends on multiple models
message_detail_model = console_ns.model(
    "MessageDetail",
    {
        "id": fields.String,
        "conversation_id": fields.String,
        "inputs": FilesContainedField,
        "query": fields.String,
        "message": fields.Raw,
        "message_tokens": fields.Integer,
        "answer": fields.String(attribute="re_sign_file_url_answer"),
        "answer_tokens": fields.Integer,
        "provider_response_latency": fields.Float,
        "from_source": fields.String,
        "from_end_user_id": fields.String,
        "from_account_id": fields.String,
        "feedbacks": fields.List(fields.Nested(feedback_model)),
        "workflow_run_id": fields.String,
        "annotation": fields.Nested(annotation_model, allow_null=True),
        "annotation_hit_history": fields.Nested(annotation_hit_history_model, allow_null=True),
        "created_at": TimestampField,
        "agent_thoughts": fields.List(fields.Nested(agent_thought_model)),
        "message_files": fields.List(fields.Nested(message_file_model)),
        "metadata": fields.Raw(attribute="message_metadata_dict"),
        "status": fields.String,
        "error": fields.String,
        "parent_message_id": fields.String,
    },
)

# Message infinite scroll pagination model
message_infinite_scroll_pagination_model = console_ns.model(
    "MessageInfiniteScrollPagination",
    {
        "limit": fields.Integer,
        "has_more": fields.Boolean,
        "data": fields.List(fields.Nested(message_detail_model)),
    },
)


@console_ns.route("/apps/<uuid:app_id>/chat-messages")
class ChatMessageListApi(Resource):
    @console_ns.doc("list_chat_messages")
    @console_ns.doc(description="Get chat messages for a conversation with pagination")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[ChatMessagesQuery.__name__])
    @console_ns.response(200, "Success", message_infinite_scroll_pagination_model)
    @console_ns.response(404, "Conversation not found")
    @login_required
    @account_initialization_required
    @setup_required
    @get_app_model(mode=[AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT])
    @marshal_with(message_infinite_scroll_pagination_model)
    @edit_permission_required
    def get(self, app_model):
        args = ChatMessagesQuery.model_validate(request.args.to_dict(flat=True))  # type: ignore

        conversation = (
            db.session.query(Conversation)
            .where(Conversation.id == args.conversation_id, Conversation.app_id == app_model.id)
            .first()
        )

        if not conversation:
            raise NotFound("Conversation Not Exists.")

        if args.first_id:
            first_message = (
                db.session.query(Message)
                .where(Message.conversation_id == conversation.id, Message.id == args.first_id)
                .first()
            )

            if not first_message:
                raise NotFound("First message not found")

            history_messages = (
                db.session.query(Message)
                .where(
                    Message.conversation_id == conversation.id,
                    Message.created_at < first_message.created_at,
                    Message.id != first_message.id,
                )
                .order_by(Message.created_at.desc())
                .limit(args.limit)
                .all()
            )
        else:
            history_messages = (
                db.session.query(Message)
                .where(Message.conversation_id == conversation.id)
                .order_by(Message.created_at.desc())
                .limit(args.limit)
                .all()
            )

        # Initialize has_more based on whether we have a full page
        if len(history_messages) == args.limit:
            current_page_first_message = history_messages[-1]
            # Check if there are more messages before the current page
            has_more = db.session.scalar(
                select(
                    exists().where(
                        Message.conversation_id == conversation.id,
                        Message.created_at < current_page_first_message.created_at,
                        Message.id != current_page_first_message.id,
                    )
                )
            )
        else:
            # If we don't have a full page, there are no more messages
            has_more = False

        history_messages = list(reversed(history_messages))

        return InfiniteScrollPagination(data=history_messages, limit=args.limit, has_more=has_more)


@console_ns.route("/apps/<uuid:app_id>/feedbacks")
class MessageFeedbackApi(Resource):
    @console_ns.doc("create_message_feedback")
    @console_ns.doc(description="Create or update message feedback (like/dislike)")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[MessageFeedbackPayload.__name__])
    @console_ns.response(200, "Feedback updated successfully")
    @console_ns.response(404, "Message not found")
    @console_ns.response(403, "Insufficient permissions")
    @get_app_model
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, app_model):
        current_user, _ = current_account_with_tenant()

        args = MessageFeedbackPayload.model_validate(console_ns.payload)

        message_id = str(args.message_id)

        message = db.session.query(Message).where(Message.id == message_id, Message.app_id == app_model.id).first()

        if not message:
            raise NotFound("Message Not Exists.")

        feedback = message.admin_feedback

        if not args.rating and feedback:
            db.session.delete(feedback)
        elif args.rating and feedback:
            feedback.rating = args.rating
        elif not args.rating and not feedback:
            raise ValueError("rating cannot be None when feedback not exists")
        else:
            rating_value = args.rating
            if rating_value is None:
                raise ValueError("rating is required to create feedback")
            feedback = MessageFeedback(
                app_id=app_model.id,
                conversation_id=message.conversation_id,
                message_id=message.id,
                rating=rating_value,
                from_source="admin",
                from_account_id=current_user.id,
            )
            db.session.add(feedback)

        db.session.commit()

        return {"result": "success"}


@console_ns.route("/apps/<uuid:app_id>/annotations/count")
class MessageAnnotationCountApi(Resource):
    @console_ns.doc("get_annotation_count")
    @console_ns.doc(description="Get count of message annotations for the app")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(
        200,
        "Annotation count retrieved successfully",
        console_ns.model("AnnotationCountResponse", {"count": fields.Integer(description="Number of annotations")}),
    )
    @get_app_model
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, app_model):
        count = db.session.query(MessageAnnotation).where(MessageAnnotation.app_id == app_model.id).count()

        return {"count": count}


@console_ns.route("/apps/<uuid:app_id>/chat-messages/<uuid:message_id>/suggested-questions")
class MessageSuggestedQuestionApi(Resource):
    @console_ns.doc("get_message_suggested_questions")
    @console_ns.doc(description="Get suggested questions for a message")
    @console_ns.doc(params={"app_id": "Application ID", "message_id": "Message ID"})
    @console_ns.response(
        200,
        "Suggested questions retrieved successfully",
        console_ns.model(
            "SuggestedQuestionsResponse", {"data": fields.List(fields.String(description="Suggested question"))}
        ),
    )
    @console_ns.response(404, "Message or conversation not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT])
    def get(self, app_model, message_id):
        current_user, _ = current_account_with_tenant()
        message_id = str(message_id)

        try:
            questions = MessageService.get_suggested_questions_after_answer(
                app_model=app_model, message_id=message_id, user=current_user, invoke_from=InvokeFrom.DEBUGGER
            )
        except MessageNotExistsError:
            raise NotFound("Message not found")
        except ConversationNotExistsError:
            raise NotFound("Conversation not found")
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        except QuotaExceededError:
            raise ProviderQuotaExceededError()
        except ModelCurrentlyNotSupportError:
            raise ProviderModelCurrentlyNotSupportError()
        except InvokeError as e:
            raise CompletionRequestError(e.description)
        except SuggestedQuestionsAfterAnswerDisabledError:
            raise AppSuggestedQuestionsAfterAnswerDisabledError()
        except Exception:
            logger.exception("internal server error.")
            raise InternalServerError()

        return {"data": questions}


@console_ns.route("/apps/<uuid:app_id>/feedbacks/export")
class MessageFeedbackExportApi(Resource):
    @console_ns.doc("export_feedbacks")
    @console_ns.doc(description="Export user feedback data for Google Sheets")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[FeedbackExportQuery.__name__])
    @console_ns.response(200, "Feedback data exported successfully")
    @console_ns.response(400, "Invalid parameters")
    @console_ns.response(500, "Internal server error")
    @get_app_model
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, app_model):
        args = FeedbackExportQuery.model_validate(request.args.to_dict(flat=True))  # type: ignore

        # Import the service function
        from services.feedback_service import FeedbackService

        try:
            export_data = FeedbackService.export_feedbacks(
                app_id=app_model.id,
                from_source=args.from_source,
                rating=args.rating,
                has_comment=args.has_comment,
                start_date=args.start_date,
                end_date=args.end_date,
                format_type=args.format,
            )

            return export_data

        except ValueError as e:
            logger.exception("Parameter validation error in feedback export")
            return {"error": f"Parameter validation error: {str(e)}"}, 400
        except Exception as e:
            logger.exception("Error exporting feedback data")
            raise InternalServerError(str(e))


@console_ns.route("/apps/<uuid:app_id>/messages/<uuid:message_id>")
class MessageApi(Resource):
    @console_ns.doc("get_message")
    @console_ns.doc(description="Get message details by ID")
    @console_ns.doc(params={"app_id": "Application ID", "message_id": "Message ID"})
    @console_ns.response(200, "Message retrieved successfully", message_detail_model)
    @console_ns.response(404, "Message not found")
    @get_app_model
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(message_detail_model)
    def get(self, app_model, message_id: str):
        message_id = str(message_id)

        message = db.session.query(Message).where(Message.id == message_id, Message.app_id == app_model.id).first()

        if not message:
            raise NotFound("Message Not Exists.")

        return message
