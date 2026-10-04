import logging
from http import HTTPStatus
from typing import Literal
from uuid import UUID

from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session
from werkzeug.exceptions import InternalServerError, NotFound

from controllers.common.controller_schemas import MessageFeedbackPayload as _MessageFeedbackPayloadBase
from controllers.common.errors import InternalServerError as InternalServerHTTPError
from controllers.common.errors import NotFoundError, UnauthorizedError
from controllers.common.fields import SimpleResultResponse, TextFileResponse
from controllers.common.rbac import AgentId, PlainApp, RBACCheck
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.common.session import with_session
from controllers.console import console_ns
from controllers.console.agent.app_helpers import resolve_agent_runtime_app_model
from controllers.console.app.error import (
    AppNotFoundError,
    AppUnavailableError,
    CompletionRequestError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.console.app.wraps import get_app_model
from controllers.console.explore.error import AppSuggestedQuestionsAfterAnswerDisabledError
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import (
    RBACPermission,
    account_initialization_required,
    edit_permission_required,
    model_validate,
    rbac_permission_required,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)
from core.entities.execution_extra_content import ExecutionExtraContentDomainModel
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from extensions.ext_application_services import application_services
from extensions.ext_database import db
from fields.base import ResponseModel
from fields.conversation_fields import (
    MessageDetail as BaseMessageDetailResponse,
)
from fields.conversation_fields import MessageResponseSource
from graphon.model_runtime.errors.invoke import InvokeError
from libs.helper import dump_response, uuid_value
from libs.infinite_scroll_pagination import InfiniteScrollPagination
from libs.login import login_required
from machinery.context import RequestContext
from models.account import Account
from models.enums import FeedbackFromSource, FeedbackRating
from models.model import App, AppMode, Conversation, Message, MessageAnnotation, MessageFeedback
from services.agent.errors import AgentNotFoundError, AgentVersionNotFoundError
from services.app.agent_app_contracts import AgentAppNotFoundError
from services.app.console_service import ConsoleAppNotFoundError
from services.app_definition_query_service import AppDefinitionUnavailableError
from services.conversation_service import ConversationService
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import MessageNotExistsError, SuggestedQuestionsAfterAnswerDisabledError
from services.message_service import attach_message_extra_contents
from services.message_suggested_questions_service import SuggestedQuestionsAccount, SuggestedQuestionsActorNotFoundError

logger = logging.getLogger(__name__)


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


class MessageFeedbackPayload(_MessageFeedbackPayloadBase):
    message_id: str = Field(..., description="Message ID")

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


class AnnotationCountResponse(ResponseModel):
    count: int = Field(description="Number of annotations")


class SuggestedQuestionsResponse(ResponseModel):
    data: list[str] = Field(description="Suggested question")


class MessageDetailResponse(BaseMessageDetailResponse):
    extra_contents: list[ExecutionExtraContentDomainModel] = Field(default_factory=list)


class MessageInfiniteScrollPaginationResponse(ResponseModel):
    limit: int
    has_more: bool
    data: list[MessageDetailResponse]


register_schema_models(
    console_ns,
    ChatMessagesQuery,
    MessageFeedbackPayload,
    FeedbackExportQuery,
)
register_response_schema_models(
    console_ns,
    AnnotationCountResponse,
    SuggestedQuestionsResponse,
    MessageDetailResponse,
    MessageInfiniteScrollPaginationResponse,
    SimpleResultResponse,
    TextFileResponse,
)


@console_ns.route("/apps/<uuid:app_id>/chat-messages")
class ChatMessageListApi(Resource):
    @console_ns.doc("list_chat_messages")
    @console_ns.doc(description="Get chat messages for a conversation with pagination")
    @console_ns.doc(params={"app_id": "Application ID", **query_params_from_model(ChatMessagesQuery)})
    @console_ns.response(200, "Success", console_ns.models[MessageInfiniteScrollPaginationResponse.__name__])
    @console_ns.response(404, "Conversation not found")
    @login_required
    @account_initialization_required
    @setup_required
    @edit_permission_required
    @with_current_user
    @rbac_permission_required(RBACCheck(RBACPermission.APP_VIEW_LAYOUT, PlainApp()))
    @with_session(write=False)
    @get_app_model(mode=[AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT])
    @model_validate(ChatMessagesQuery)
    def get(self, req_data: ChatMessagesQuery, session: Session, current_user: Account, app_model: App):
        return _list_chat_messages(
            args=req_data,
            session=session,
            app_model=app_model,
            current_user=current_user,
        )


@console_ns.route("/agent/<uuid:agent_id>/chat-messages")
class AgentChatMessageListApi(Resource):
    @console_ns.doc("list_agent_chat_messages")
    @console_ns.doc(description="Get Agent App chat messages for a conversation with pagination")
    @console_ns.doc(params={"agent_id": "Agent ID"})
    @console_ns.doc(params=query_params_from_model(ChatMessagesQuery))
    @console_ns.response(200, "Success", console_ns.models[MessageInfiniteScrollPaginationResponse.__name__])
    @console_ns.response(404, "Agent or conversation not found")
    @login_required
    @account_initialization_required
    @setup_required
    @edit_permission_required
    @rbac_permission_required(RBACCheck(RBACPermission.AGENT_TEST_AND_RUN, AgentId()))
    @with_current_user
    @with_current_tenant_id
    @with_session(write=False)
    @model_validate(ChatMessagesQuery)
    def get(
        self,
        req_data: ChatMessagesQuery,
        session: Session,
        current_tenant_id: str,
        current_user: Account,
        agent_id: UUID,
    ):
        app_model = resolve_agent_runtime_app_model(
            session=session,
            tenant_id=current_tenant_id,
            agent_id=agent_id,
        )
        return _list_chat_messages(
            args=req_data,
            session=session,
            app_model=app_model,
            current_user=current_user,
        )


@console_ns.route("/apps/<uuid:app_id>/feedbacks")
class MessageFeedbackApi(Resource):
    @console_ns.doc("create_message_feedback")
    @console_ns.doc(description="Create or update message feedback (like/dislike)")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[MessageFeedbackPayload.__name__])
    @console_ns.response(200, "Feedback updated successfully", console_ns.models[SimpleResultResponse.__name__])
    @console_ns.response(404, "Message not found")
    @console_ns.response(403, "Insufficient permissions")
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user
    @with_session
    @get_app_model
    @model_validate(MessageFeedbackPayload)
    def post(self, req_data: MessageFeedbackPayload, session: Session, current_user: Account, app_model: App):
        return _update_message_feedback(
            args=req_data,
            session=session,
            current_user=current_user,
            app_model=app_model,
        )


@console_ns.route("/agent/<uuid:agent_id>/feedbacks")
class AgentMessageFeedbackApi(Resource):
    @console_ns.doc("create_agent_message_feedback")
    @console_ns.doc(description="Create or update Agent App message feedback")
    @console_ns.doc(params={"agent_id": "Agent ID"})
    @console_ns.expect(console_ns.models[MessageFeedbackPayload.__name__])
    @console_ns.response(200, "Feedback updated successfully", console_ns.models[SimpleResultResponse.__name__])
    @console_ns.response(404, "Agent or message not found")
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACCheck(RBACPermission.AGENT_TEST_AND_RUN, AgentId()))
    @with_current_user
    @with_current_tenant_id
    @with_session
    @model_validate(MessageFeedbackPayload)
    def post(
        self,
        req_data: MessageFeedbackPayload,
        session: Session,
        current_tenant_id: str,
        current_user: Account,
        agent_id: UUID,
    ):
        app_model = resolve_agent_runtime_app_model(
            session=session,
            tenant_id=current_tenant_id,
            agent_id=agent_id,
        )
        return _update_message_feedback(
            args=req_data,
            session=session,
            current_user=current_user,
            app_model=app_model,
        )


@console_ns.route("/apps/<uuid:app_id>/annotations/count")
class MessageAnnotationCountApi(Resource):
    @console_ns.doc("get_annotation_count")
    @console_ns.doc(description="Get count of message annotations for the app")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.response(
        200,
        "Annotation count retrieved successfully",
        console_ns.models[AnnotationCountResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACCheck(RBACPermission.APP_VIEW_LAYOUT, PlainApp()))
    @get_app_model
    def get(self, app_model: App):
        count = db.session.scalar(
            select(func.count(MessageAnnotation.id)).where(MessageAnnotation.app_id == app_model.id)
        )

        return AnnotationCountResponse(count=count or 0).model_dump(mode="json")


@console_ns.route("/apps/<uuid:app_id>/chat-messages/<uuid:message_id>/suggested-questions")
class MessageSuggestedQuestionApi(Resource):
    @console_ns.doc("get_message_suggested_questions")
    @console_ns.doc(description="Get suggested questions for a message")
    @console_ns.doc(params={"app_id": "Application ID", "message_id": "Message ID"})
    @console_ns.response(
        HTTPStatus.OK,
        "Suggested questions retrieved successfully",
        console_ns.models[SuggestedQuestionsResponse.__name__],
    )
    @console_ns.response(HTTPStatus.BAD_REQUEST, "App or model provider unavailable, or generation failed")
    @console_ns.response(HTTPStatus.UNAUTHORIZED, "Account authentication required")
    @console_ns.response(HTTPStatus.FORBIDDEN, "Insufficient permissions or suggested questions disabled")
    @console_ns.response(HTTPStatus.NOT_FOUND, "App, message, or conversation not found")
    @console_ns.response(HTTPStatus.INTERNAL_SERVER_ERROR, "Unexpected server error")
    @console_account_admission(rbac_checks=(RBACCheck(RBACPermission.APP_VIEW_LAYOUT, PlainApp()),))
    def get(self, context: RequestContext, app_id: UUID, message_id: UUID) -> dict[str, object]:
        try:
            app = application_services().apps.console.get_reference(context, str(app_id))
        except ConsoleAppNotFoundError as exc:
            raise AppNotFoundError() from exc
        if app.mode not in (AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT):
            raise AppNotFoundError("App mode does not support suggested questions")
        return _get_message_suggested_questions(
            context=context, app_id=app.id, app_mode=app.mode, message_id=message_id
        )


@console_ns.route("/agent/<uuid:agent_id>/chat-messages/<uuid:message_id>/suggested-questions")
class AgentMessageSuggestedQuestionApi(Resource):
    @console_ns.doc("get_agent_message_suggested_questions")
    @console_ns.doc(description="Get suggested questions for an Agent App message")
    @console_ns.doc(params={"agent_id": "Agent ID", "message_id": "Message ID"})
    @console_ns.response(
        HTTPStatus.OK,
        "Suggested questions retrieved successfully",
        console_ns.models[SuggestedQuestionsResponse.__name__],
    )
    @console_ns.response(HTTPStatus.BAD_REQUEST, "App or model provider unavailable, or generation failed")
    @console_ns.response(HTTPStatus.UNAUTHORIZED, "Account authentication required")
    @console_ns.response(HTTPStatus.FORBIDDEN, "Insufficient permissions or suggested questions disabled")
    @console_ns.response(HTTPStatus.NOT_FOUND, "Agent, message, or conversation not found")
    @console_ns.response(HTTPStatus.INTERNAL_SERVER_ERROR, "Unexpected server error")
    @console_account_admission(rbac_checks=(RBACCheck(RBACPermission.AGENT_TEST_AND_RUN, AgentId()),))
    def get(self, context: RequestContext, agent_id: UUID, message_id: UUID) -> dict[str, object]:
        try:
            app_id = application_services().agent_apps.access.resolve_existing_runtime_app_id(context, str(agent_id))
        except AgentAppNotFoundError as exc:
            raise AgentNotFoundError() from exc
        return _get_message_suggested_questions(
            context=context, app_id=app_id, app_mode=AppMode.AGENT, message_id=message_id
        )


@console_ns.route("/apps/<uuid:app_id>/feedbacks/export")
class MessageFeedbackExportApi(Resource):
    @console_ns.doc("export_feedbacks")
    @console_ns.doc(description="Export user feedback data for Google Sheets")
    @console_ns.response(
        200,
        "Feedback data exported successfully",
        console_ns.models[TextFileResponse.__name__],
    )
    @console_ns.doc(params={"app_id": "Application ID", **query_params_from_model(FeedbackExportQuery)})
    @console_ns.response(400, "Invalid parameters")
    @console_ns.response(500, "Internal server error")
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACCheck(RBACPermission.APP_VIEW_LAYOUT, PlainApp()))
    @get_app_model
    @model_validate(FeedbackExportQuery)
    def get(self, req_data: FeedbackExportQuery, app_model: App):

        # Import the service function
        from services.feedback_service import FeedbackService

        try:
            export_data = FeedbackService.export_feedbacks(
                app_model.id,
                session=db.session(),
                from_source=req_data.from_source,
                rating=req_data.rating,
                has_comment=req_data.has_comment,
                start_date=req_data.start_date,
                end_date=req_data.end_date,
                format_type=req_data.format,
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
    @console_ns.response(200, "Message retrieved successfully", console_ns.models[MessageDetailResponse.__name__])
    @console_ns.response(404, "Message not found")
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACCheck(RBACPermission.APP_VIEW_LAYOUT, PlainApp()))
    @with_session(write=False)
    @get_app_model
    def get(self, session: Session, app_model: App, message_id: UUID):
        return _get_message_detail(session=session, app_model=app_model, message_id=message_id)


@console_ns.route("/agent/<uuid:agent_id>/messages/<uuid:message_id>")
class AgentMessageApi(Resource):
    @console_ns.doc("get_agent_message")
    @console_ns.doc(description="Get Agent App message details by ID")
    @console_ns.doc(params={"agent_id": "Agent ID", "message_id": "Message ID"})
    @console_ns.response(200, "Message retrieved successfully", console_ns.models[MessageDetailResponse.__name__])
    @console_ns.response(404, "Agent or message not found")
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACCheck(RBACPermission.AGENT_TEST_AND_RUN, AgentId()))
    @with_current_tenant_id
    @with_session(write=False)
    def get(self, session: Session, current_tenant_id: str, agent_id: UUID, message_id: UUID):
        app_model = resolve_agent_runtime_app_model(
            session=session,
            tenant_id=current_tenant_id,
            agent_id=agent_id,
        )
        return _get_message_detail(session=session, app_model=app_model, message_id=message_id)


def _list_chat_messages(
    *,
    args: ChatMessagesQuery,
    session: Session,
    app_model: App,
    current_user: Account | None = None,
):
    if AppMode.value_of(app_model.mode) == AppMode.AGENT and current_user is not None:
        try:
            conversation = ConversationService.get_conversation(
                app_model=app_model,
                conversation_id=args.conversation_id,
                user=current_user,
                session=session,
            )
        except ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")
    else:
        conversation = session.scalar(
            select(Conversation)
            .where(Conversation.id == args.conversation_id, Conversation.app_id == app_model.id)
            .limit(1)
        )

    if not conversation:
        raise NotFound("Conversation Not Exists.")

    if args.first_id:
        first_message = session.scalar(
            select(Message).where(Message.conversation_id == conversation.id, Message.id == args.first_id).limit(1)
        )

        if not first_message:
            raise NotFound("First message not found")

        history_messages = session.scalars(
            select(Message)
            .where(
                Message.conversation_id == conversation.id,
                Message.created_at < first_message.created_at,
                Message.id != first_message.id,
            )
            .order_by(Message.created_at.desc())
            .limit(args.limit)
        ).all()
    else:
        history_messages = session.scalars(
            select(Message)
            .where(Message.conversation_id == conversation.id)
            .order_by(Message.created_at.desc())
            .limit(args.limit)
        ).all()

    # Initialize has_more based on whether we have a full page
    if len(history_messages) == args.limit:
        current_page_first_message = history_messages[-1]
        # Check if there are more messages before the current page
        has_more = session.scalar(
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
    attach_message_extra_contents(history_messages)

    return dump_response(
        MessageInfiniteScrollPaginationResponse,
        InfiniteScrollPagination(
            data=[MessageResponseSource(message, session=session) for message in history_messages],
            limit=args.limit,
            has_more=has_more,
        ),
    )


def _update_message_feedback(
    *,
    args: MessageFeedbackPayload,
    session: Session,
    current_user: Account,
    app_model: App,
):
    message_id = args.message_id

    message = session.scalar(select(Message).where(Message.id == message_id, Message.app_id == app_model.id).limit(1))

    if not message:
        raise NotFound("Message Not Exists.")

    feedback = message.admin_feedback_with_session(session=session)

    if not args.rating and feedback:
        session.delete(feedback)
    elif args.rating and feedback:
        feedback.rating = FeedbackRating(args.rating)
        feedback.content = args.content
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
            rating=FeedbackRating(rating_value),
            content=args.content,
            from_source=FeedbackFromSource.ADMIN,
            from_account_id=current_user.id,
        )
        session.add(feedback)

    session.commit()

    return SimpleResultResponse(result="success").model_dump(mode="json")


def _get_message_suggested_questions(
    *, context: RequestContext, app_id: str, app_mode: str, message_id: UUID
) -> dict[str, object]:

    try:
        questions = application_services().message_suggested_questions.get_suggested_questions(
            app_id=app_id,
            app_owner_tenant_id=context.active_workspace_id,
            expected_app_mode=app_mode,
            actor=SuggestedQuestionsAccount(account_id=context.account_id, invoke_from="debugger"),
            message_id=str(message_id),
        )
    except AppDefinitionUnavailableError as exc:
        raise AppUnavailableError() from exc
    except SuggestedQuestionsActorNotFoundError as exc:
        raise UnauthorizedError("Account no longer exists") from exc
    except MessageNotExistsError:
        raise NotFoundError("Message not found")
    except ConversationNotExistsError:
        raise NotFoundError("Conversation not found")
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
    except AgentVersionNotFoundError:
        # The legacy Agent config reader still owns this HTTP error.
        # Remove this compatibility case when it exposes a domain error.
        raise
    except Exception:
        logger.exception("internal server error.")
        raise InternalServerHTTPError()

    return dump_response(SuggestedQuestionsResponse, {"data": questions})


def _get_message_detail(*, session: Session, app_model: App, message_id: UUID):
    message_id_str = str(message_id)

    message = session.scalar(
        select(Message).where(Message.id == message_id_str, Message.app_id == app_model.id).limit(1)
    )

    if not message:
        raise NotFound("Message Not Exists.")

    attach_message_extra_contents([message])
    return dump_response(MessageDetailResponse, MessageResponseSource(message, session=session))
