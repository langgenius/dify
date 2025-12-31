import logging
from typing import Literal

from flask import request
from pydantic import BaseModel, Field
from werkzeug.exceptions import InternalServerError, NotFound

from controllers.common.schema import register_schema_models
from controllers.console.app.error import (
    AppMoreLikeThisDisabledError,
    CompletionRequestError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.console.explore.error import (
    AppSuggestedQuestionsAfterAnswerDisabledError,
    NotChatAppError,
    NotCompletionAppError,
)
from controllers.console.explore.wraps import InstalledAppResource
from core.app.entities.app_invoke_entities import InvokeFrom
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.model_runtime.errors.invoke import InvokeError
from fields.conversation_fields import AgentThought, MessageFile, ResultResponse
from fields.message_fields import (
    MessageInfiniteScrollPagination,
    MessageListItem,
    RetrieverResource,
    SimpleFeedback,
    SuggestedQuestionsResponse,
    format_files_contained,
    to_timestamp,
)
from libs import helper
from libs.helper import UUIDStrOrEmpty
from libs.login import current_account_with_tenant
from models.model import AppMode
from services.app_generate_service import AppGenerateService
from services.errors.app import MoreLikeThisDisabledError
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import (
    FirstMessageNotExistsError,
    MessageNotExistsError,
    SuggestedQuestionsAfterAnswerDisabledError,
)
from services.message_service import MessageService

from .. import console_ns

logger = logging.getLogger(__name__)


class MessageListQuery(BaseModel):
    conversation_id: UUIDStrOrEmpty
    first_id: UUIDStrOrEmpty | None = None
    limit: int = Field(default=20, ge=1, le=100)


class MessageFeedbackPayload(BaseModel):
    rating: Literal["like", "dislike"] | None = None
    content: str | None = None


class MoreLikeThisQuery(BaseModel):
    response_mode: Literal["blocking", "streaming"]


register_schema_models(console_ns, MessageListQuery, MessageFeedbackPayload, MoreLikeThisQuery)


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/messages",
    endpoint="installed_app_messages",
)
class MessageListApi(InstalledAppResource):
    @console_ns.expect(console_ns.models[MessageListQuery.__name__])
    def get(self, installed_app):
        current_user, _ = current_account_with_tenant()
        app_model = installed_app.app

        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()
        args = MessageListQuery.model_validate(request.args.to_dict())

        try:
            pagination = MessageService.pagination_by_first_id(
                app_model,
                current_user,
                str(args.conversation_id),
                str(args.first_id) if args.first_id else None,
                args.limit,
            )
            items: list[MessageListItem] = []
            for message in pagination.data:
                feedback = None
                user_feedback = getattr(message, "user_feedback", None)
                if user_feedback is not None:
                    feedback = SimpleFeedback(rating=getattr(user_feedback, "rating", None))

                retriever_resources = []
                for resource in getattr(message, "retriever_resources", []):
                    if isinstance(resource, dict):
                        retriever_resources.append(RetrieverResource.model_validate(resource))
                    else:
                        retriever_resources.append(
                            RetrieverResource(
                                id=str(resource.id),
                                message_id=str(resource.message_id),
                                position=resource.position,
                                dataset_id=getattr(resource, "dataset_id", None),
                                dataset_name=getattr(resource, "dataset_name", None),
                                document_id=getattr(resource, "document_id", None),
                                document_name=getattr(resource, "document_name", None),
                                data_source_type=getattr(resource, "data_source_type", None),
                                segment_id=getattr(resource, "segment_id", None),
                                score=getattr(resource, "score", None),
                                hit_count=getattr(resource, "hit_count", None),
                                word_count=getattr(resource, "word_count", None),
                                segment_position=getattr(resource, "segment_position", None),
                                index_node_hash=getattr(resource, "index_node_hash", None),
                                content=getattr(resource, "content", None),
                                created_at=to_timestamp(getattr(resource, "created_at", None)),
                            )
                        )

                agent_thoughts = []
                for thought in getattr(message, "agent_thoughts", []):
                    chain_id = getattr(thought, "chain_id", None)
                    if chain_id is None:
                        chain_id = getattr(thought, "message_chain_id", None)
                    agent_thoughts.append(
                        AgentThought(
                            id=str(thought.id),
                            chain_id=chain_id,
                            message_id=str(thought.message_id),
                            position=thought.position,
                            thought=getattr(thought, "thought", None),
                            tool=getattr(thought, "tool", None),
                            tool_labels=getattr(thought, "tool_labels", {}),
                            tool_input=getattr(thought, "tool_input", None),
                            created_at=to_timestamp(getattr(thought, "created_at", None)),
                            observation=getattr(thought, "observation", None),
                            files=getattr(thought, "files", []),
                        )
                    )

                message_files = []
                for item in getattr(message, "message_files", []):
                    if isinstance(item, dict):
                        message_files.append(MessageFile.model_validate(item))
                    else:
                        message_files.append(
                            MessageFile(
                                id=str(item.id),
                                filename=getattr(item, "filename", ""),
                                type=item.type,
                                url=getattr(item, "url", None),
                                mime_type=getattr(item, "mime_type", None),
                                size=getattr(item, "size", None),
                                transfer_method=str(item.transfer_method),
                                belongs_to=getattr(item, "belongs_to", None),
                                upload_file_id=getattr(item, "upload_file_id", None),
                            )
                        )

                items.append(
                    MessageListItem(
                        id=str(message.id),
                        conversation_id=str(message.conversation_id),
                        parent_message_id=getattr(message, "parent_message_id", None),
                        inputs=format_files_contained(message.inputs),
                        query=message.query,
                        answer=message.re_sign_file_url_answer,
                        feedback=feedback,
                        retriever_resources=retriever_resources,
                        created_at=to_timestamp(message.created_at),
                        agent_thoughts=agent_thoughts,
                        message_files=message_files,
                        status=message.status,
                        error=getattr(message, "error", None),
                    )
                )

            return MessageInfiniteScrollPagination(
                limit=pagination.limit,
                has_more=pagination.has_more,
                data=items,
            ).model_dump(mode="json")
        except ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")
        except FirstMessageNotExistsError:
            raise NotFound("First Message Not Exists.")


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/messages/<uuid:message_id>/feedbacks",
    endpoint="installed_app_message_feedback",
)
class MessageFeedbackApi(InstalledAppResource):
    @console_ns.expect(console_ns.models[MessageFeedbackPayload.__name__])
    def post(self, installed_app, message_id):
        current_user, _ = current_account_with_tenant()
        app_model = installed_app.app

        message_id = str(message_id)

        payload = MessageFeedbackPayload.model_validate(console_ns.payload or {})

        try:
            MessageService.create_feedback(
                app_model=app_model,
                message_id=message_id,
                user=current_user,
                rating=payload.rating,
                content=payload.content,
            )
        except MessageNotExistsError:
            raise NotFound("Message Not Exists.")

        return ResultResponse(result="success").model_dump(mode="json")


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/messages/<uuid:message_id>/more-like-this",
    endpoint="installed_app_more_like_this",
)
class MessageMoreLikeThisApi(InstalledAppResource):
    @console_ns.expect(console_ns.models[MoreLikeThisQuery.__name__])
    def get(self, installed_app, message_id):
        current_user, _ = current_account_with_tenant()
        app_model = installed_app.app
        if app_model.mode != "completion":
            raise NotCompletionAppError()

        message_id = str(message_id)

        args = MoreLikeThisQuery.model_validate(request.args.to_dict())

        streaming = args.response_mode == "streaming"

        try:
            response = AppGenerateService.generate_more_like_this(
                app_model=app_model,
                user=current_user,
                message_id=message_id,
                invoke_from=InvokeFrom.EXPLORE,
                streaming=streaming,
            )
            return helper.compact_generate_response(response)
        except MessageNotExistsError:
            raise NotFound("Message Not Exists.")
        except MoreLikeThisDisabledError:
            raise AppMoreLikeThisDisabledError()
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        except QuotaExceededError:
            raise ProviderQuotaExceededError()
        except ModelCurrentlyNotSupportError:
            raise ProviderModelCurrentlyNotSupportError()
        except InvokeError as e:
            raise CompletionRequestError(e.description)
        except ValueError as e:
            raise e
        except Exception:
            logger.exception("internal server error.")
            raise InternalServerError()


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/messages/<uuid:message_id>/suggested-questions",
    endpoint="installed_app_suggested_question",
)
class MessageSuggestedQuestionApi(InstalledAppResource):
    def get(self, installed_app, message_id):
        current_user, _ = current_account_with_tenant()
        app_model = installed_app.app
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        message_id = str(message_id)

        try:
            questions = MessageService.get_suggested_questions_after_answer(
                app_model=app_model, user=current_user, message_id=message_id, invoke_from=InvokeFrom.EXPLORE
            )
        except MessageNotExistsError:
            raise NotFound("Message not found")
        except ConversationNotExistsError:
            raise NotFound("Conversation not found")
        except SuggestedQuestionsAfterAnswerDisabledError:
            raise AppSuggestedQuestionsAfterAnswerDisabledError()
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        except QuotaExceededError:
            raise ProviderQuotaExceededError()
        except ModelCurrentlyNotSupportError:
            raise ProviderModelCurrentlyNotSupportError()
        except InvokeError as e:
            raise CompletionRequestError(e.description)
        except Exception:
            logger.exception("internal server error.")
            raise InternalServerError()

        return SuggestedQuestionsResponse(data=questions).model_dump(mode="json")
