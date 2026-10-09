"""Message ownership, feedback and generation reads shared by message capabilities.

History and more-like-this reads own short sessions and return detached data.
Only suggested-question configuration preparation borrows the caller's session.

TODO: Remove the session parameters from get_suggested_questions_context and
get_model_config once AgentRuntimeConfigService, WorkflowService and conversation
config helpers accept detached inputs and return detached results without a
shared caller session. These repository methods can then own their sessions and
return detached data too; configuration selection stays in the query/service layer.
"""

import json
from copy import deepcopy
from dataclasses import replace
from typing import NamedTuple, cast

from pydantic import JsonValue
from sqlalchemy import Select, select
from sqlalchemy.orm import Session, sessionmaker

from core.memory.token_buffer_memory import PreparedHistory, TokenBufferMemory
from models import Account, App, AppModelConfig, Conversation, EndUser, Message, MessageFile
from models.enums import FeedbackFromSource, FeedbackRating
from models.model import AppMode, InstalledApp, MessageAgentThought, MessageFeedback, load_annotation_reply_config
from repositories.execution_extra_content_repository import ExecutionExtraContentRepository
from services.app_definition_query_service import AppDefinitionUnavailableError
from services.entities.message_entities import (
    ConsoleMessageFeedbackRecord,
    ConsoleMessageRecord,
    MessageAccount,
    MessageAccountRecord,
    MessageActor,
    MessageAgentThoughtRecord,
    MessageAnnotationHitRecord,
    MessageAnnotationRecord,
    MessageFileRecord,
    MessageInputValue,
    MessagePage,
    MessageRating,
    MessageRecord,
)
from services.errors.app_model_config import AppModelConfigBrokenError
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import (
    FeedbackRatingRequiredError,
    FirstMessageNotExistsError,
    MessageActorNotFoundError,
    MessageNotExistsError,
)
from services.installed_app_access_service import InstalledAppNotFoundError, InstalledAppRef
from services.message_feedback_service import MessageFeedbackRecord
from services.message_more_like_this_service import (
    MoreLikeThisFile,
    MoreLikeThisNotCompletionError,
    MoreLikeThisSource,
)
from services.message_suggested_questions_service import SuggestedQuestionsContext


class SuggestedQuestionsRecords(NamedTuple):
    app: App
    conversation: Conversation


class MessageRepository:
    def __init__(
        self, *, session_factory: sessionmaker[Session], extra_contents: ExecutionExtraContentRepository
    ) -> None:
        self._session_factory: sessionmaker[Session] = session_factory
        self._extra_contents: ExecutionExtraContentRepository = extra_contents

    def get_message_page(
        self,
        *,
        app_id: str,
        app_owner_tenant_id: str,
        actor: MessageActor,
        conversation_id: str,
        first_id: str | None,
        limit: int,
        installed_app: InstalledAppRef | None,
    ) -> MessagePage[MessageRecord]:
        """Read an actor's live conversation and detach all response data."""
        with self._session_factory() as session:
            self._require_page_app(
                session, app_id=app_id, app_owner_tenant_id=app_owner_tenant_id, installed_app=installed_app
            )
            self._require_page_actor(session, app_id=app_id, tenant_id=app_owner_tenant_id, actor=actor)
            if not conversation_id:
                return MessagePage(limit=limit, has_more=False, data=())
            self._require_page_conversation(session, app_id=app_id, conversation_id=conversation_id, actor=actor)
            statement = self._page_statement(session, app_id=app_id, conversation_id=conversation_id, first_id=first_id)
            messages = list(session.scalars(statement.order_by(Message.created_at.desc()).limit(limit + 1)))
            has_more = len(messages) > limit
            page = MessagePage(
                limit=limit,
                has_more=has_more,
                data=tuple(
                    self._to_message_record(message=message, session=session) for message in reversed(messages[:limit])
                ),
            )
        return replace(page, data=self._with_extra_contents(page.data))

    def get_console_message_page(
        self,
        *,
        app_id: str,
        app_owner_tenant_id: str,
        account_id: str,
        conversation_id: str,
        first_id: str | None,
        limit: int,
    ) -> MessagePage[ConsoleMessageRecord]:
        """Read Console history; Agent conversations remain account-owned."""
        with self._session_factory() as session:
            app = self._require_page_app(
                session, app_id=app_id, app_owner_tenant_id=app_owner_tenant_id, installed_app=None
            )
            actor = MessageAccount(account_id=account_id)
            self._require_page_actor(session, app_id=app_id, tenant_id=app_owner_tenant_id, actor=actor)
            self._require_page_conversation(
                session,
                app_id=app_id,
                conversation_id=conversation_id,
                actor=actor if app.mode == AppMode.AGENT else None,
            )
            statement = self._page_statement(session, app_id=app_id, conversation_id=conversation_id, first_id=first_id)
            messages = list(session.scalars(statement.order_by(Message.created_at.desc()).limit(limit)))
            # Console's legacy has_more checks for a strictly older timestamp;
            # actor pages instead count the extra row, including timestamp ties.
            has_more = bool(
                len(messages) == limit
                and messages
                and session.scalar(select(statement.where(Message.created_at < messages[-1].created_at).exists()))
            )
            page = MessagePage(
                limit=limit,
                has_more=has_more,
                data=tuple(
                    self._to_console_message_record(message=message, session=session) for message in reversed(messages)
                ),
            )

        return replace(page, data=self._with_extra_contents(page.data))

    def get_console_message(
        self,
        *,
        app_id: str,
        app_owner_tenant_id: str,
        account_id: str,
        message_id: str,
    ) -> ConsoleMessageRecord:
        """Read an admitted Console app's message, including other users' history.

        Detail access is app-wide even for Agent apps and deleted conversations;
        only the Agent list endpoint limits reads to the caller's conversation.
        """
        with self._session_factory() as session:
            self._require_page_app(session, app_id=app_id, app_owner_tenant_id=app_owner_tenant_id, installed_app=None)
            self._require_page_actor(
                session, app_id=app_id, tenant_id=app_owner_tenant_id, actor=MessageAccount(account_id=account_id)
            )
            message = session.scalar(select(Message).where(Message.id == message_id, Message.app_id == app_id))
            if message is None:
                raise MessageNotExistsError(f"Message {message_id} is unavailable for app {app_id}")
            record = self._to_console_message_record(message=message, session=session)
        return self._with_extra_contents((record,))[0]

    def _with_extra_contents[RecordT: MessageRecord](self, records: tuple[RecordT, ...]) -> tuple[RecordT, ...]:
        if not records:
            return records
        # All message projections are detached and their session is closed before
        # the independent execution-content repository opens its read session.
        contents = self._extra_contents.get_by_message_ids([record.id for record in records])
        return tuple(
            replace(record, extra_contents=[item.model_dump(mode="json", exclude_none=True) for item in items])
            for record, items in zip(records, contents, strict=True)
        )

    def _require_page_app(
        self,
        session: Session,
        *,
        app_id: str,
        app_owner_tenant_id: str,
        installed_app: InstalledAppRef | None,
    ) -> App:
        if installed_app is None:
            app = self._get_app(session, app_id=app_id, tenant_id=app_owner_tenant_id)
            if app is None:
                raise AppDefinitionUnavailableError(f"App {app_id} is unavailable in tenant {app_owner_tenant_id}")
            return app
        app = session.scalar(
            select(App)
            .join(InstalledApp, InstalledApp.app_id == App.id)
            .where(
                App.id == app_id,
                App.tenant_id == app_owner_tenant_id,
                App.tenant_id == installed_app.app_owner_tenant_id,
                InstalledApp.id == installed_app.id,
                InstalledApp.tenant_id == installed_app.tenant_id,
                InstalledApp.app_id == installed_app.app_id,
                InstalledApp.app_owner_tenant_id == installed_app.app_owner_tenant_id,
            )
        )
        if app is None:
            raise InstalledAppNotFoundError(f"Installed app {installed_app.id} no longer exists")
        return app

    def _require_page_actor(self, session: Session, *, app_id: str, tenant_id: str, actor: MessageActor) -> None:
        if not self._actor_exists(
            session,
            app_id=app_id,
            tenant_id=tenant_id,
            account_id=actor.account_id if isinstance(actor, MessageAccount) else None,
            end_user_id=None if isinstance(actor, MessageAccount) else actor.end_user_id,
        ):
            raise MessageActorNotFoundError(f"Message actor is unavailable for app {app_id}")

    @staticmethod
    def _require_page_conversation(
        session: Session, *, app_id: str, conversation_id: str, actor: MessageActor | None
    ) -> None:
        statement = select(Conversation.id).where(Conversation.id == conversation_id, Conversation.app_id == app_id)
        if actor is not None:
            statement = statement.where(
                Conversation.from_source == ("console" if isinstance(actor, MessageAccount) else "api"),
                Conversation.from_account_id == (actor.account_id if isinstance(actor, MessageAccount) else None),
                Conversation.from_end_user_id == (None if isinstance(actor, MessageAccount) else actor.end_user_id),
                Conversation.is_deleted.is_(False),
            )
        if session.scalar(statement) is None:
            raise ConversationNotExistsError(f"Conversation {conversation_id} is unavailable for this app and actor")

    @staticmethod
    def _page_statement(
        session: Session, *, app_id: str, conversation_id: str, first_id: str | None
    ) -> Select[tuple[Message]]:
        statement = select(Message).where(Message.app_id == app_id, Message.conversation_id == conversation_id)
        if first_id:
            first_message = session.scalar(statement.where(Message.id == first_id))
            if first_message is None:
                raise FirstMessageNotExistsError(
                    f"The first_id cursor {first_id} does not belong to conversation {conversation_id}"
                )
            # Preserve strict timestamp cursors: a tied row is not a later page.
            statement = statement.where(Message.created_at < first_message.created_at, Message.id != first_message.id)
        return statement

    def set_feedback(
        self,
        *,
        app_id: str,
        app_owner_tenant_id: str,
        actor: MessageActor,
        message_id: str,
        rating: FeedbackRating | None,
        content: str | None,
        app_wide: bool,
        installed_app: InstalledAppRef | None,
    ) -> MessageFeedbackRecord | None:
        """Validate ownership and write atomically; None rating revokes feedback.

        app_wide is reserved for an admitted Console admin. Installed requests
        also recheck their installation in this transaction; others pass None.
        The returned record is detached; revocation returns None.
        """
        with self._session_factory.begin() as session:
            if installed_app is None:
                app = self._get_app(session, app_id=app_id, tenant_id=app_owner_tenant_id)
            else:
                app = session.scalar(
                    select(App)
                    .join(InstalledApp, InstalledApp.app_id == App.id)
                    .where(
                        App.id == app_id,
                        App.tenant_id == app_owner_tenant_id,
                        App.tenant_id == installed_app.app_owner_tenant_id,
                        InstalledApp.id == installed_app.id,
                        InstalledApp.tenant_id == installed_app.tenant_id,
                        InstalledApp.app_id == installed_app.app_id,
                    )
                )
                if app is None:
                    raise InstalledAppNotFoundError(f"Installed app {installed_app.id} no longer exists")
            if app is None:
                raise AppDefinitionUnavailableError(f"App {app_id} is unavailable in tenant {app_owner_tenant_id}")

            account_id = actor.account_id if isinstance(actor, MessageAccount) else None
            end_user_id = None if isinstance(actor, MessageAccount) else actor.end_user_id
            if not self._actor_exists(
                session,
                app_id=app_id,
                tenant_id=app_owner_tenant_id,
                account_id=account_id,
                end_user_id=end_user_id,
            ):
                raise MessageActorNotFoundError(
                    f"Message actor {account_id or end_user_id} is unavailable for app {app_id}"
                )

            if app_wide:
                if not isinstance(actor, MessageAccount):
                    raise ValueError("App-wide feedback requires an admitted Console account")
                message = session.scalar(select(Message).where(Message.id == message_id, Message.app_id == app_id))
            else:
                message = self._get_message(
                    session,
                    message_id=message_id,
                    app_id=app_id,
                    source="console" if isinstance(actor, MessageAccount) else "api",
                    account_id=account_id,
                    end_user_id=end_user_id,
                )
            if message is None:
                raise MessageNotExistsError(f"Message {message_id} is unavailable for this app and actor")

            source = FeedbackFromSource.ADMIN if isinstance(actor, MessageAccount) else FeedbackFromSource.USER
            feedback = session.scalar(
                select(MessageFeedback).where(
                    MessageFeedback.app_id == app_id,
                    MessageFeedback.message_id == message_id,
                    MessageFeedback.from_source == source,
                )
            )
            if rating is None:
                if feedback is None:
                    raise FeedbackRatingRequiredError(
                        f"Message {message_id} has no {source.value} feedback to remove; a rating is required."
                    )
                session.delete(feedback)
                return None
            if feedback is None:
                feedback = MessageFeedback(
                    app_id=app_id,
                    conversation_id=message.conversation_id,
                    message_id=message_id,
                    rating=rating,
                    content=content,
                    from_source=source,
                    from_end_user_id=end_user_id,
                    from_account_id=account_id,
                )
                session.add(feedback)
            else:
                # Admin feedback is shared per message; updating it preserves the
                # original reviewer identity, as in the existing Console endpoints.
                feedback.rating = rating
                feedback.content = content
            session.flush()
            return self._feedback_record(feedback)

    def get_feedbacks(
        self, *, app_id: str, app_owner_tenant_id: str, page: int, limit: int
    ) -> list[MessageFeedbackRecord]:
        with self._session_factory() as session:
            if self._get_app(session, app_id=app_id, tenant_id=app_owner_tenant_id) is None:
                raise AppDefinitionUnavailableError(f"App {app_id} is unavailable in tenant {app_owner_tenant_id}")
            feedbacks = session.scalars(
                select(MessageFeedback)
                .where(MessageFeedback.app_id == app_id)
                .order_by(MessageFeedback.created_at.desc(), MessageFeedback.id.desc())
                .limit(limit)
                .offset((page - 1) * limit)
            )
            return [self._feedback_record(feedback) for feedback in feedbacks]

    @staticmethod
    def _feedback_record(feedback: MessageFeedback) -> MessageFeedbackRecord:
        return MessageFeedbackRecord(
            id=feedback.id,
            app_id=feedback.app_id,
            conversation_id=feedback.conversation_id,
            message_id=feedback.message_id,
            rating=feedback.rating,
            content=feedback.content,
            from_source=feedback.from_source,
            from_end_user_id=feedback.from_end_user_id,
            from_account_id=feedback.from_account_id,
            created_at=feedback.created_at.isoformat(),
            updated_at=feedback.updated_at.isoformat(),
        )

    def get_suggested_questions_context(
        self,
        *,
        session: Session,
        app_id: str,
        app_owner_tenant_id: str,
        expected_app_mode: str,
        actor: MessageActor,
        message_id: str,
    ) -> SuggestedQuestionsRecords:
        app = self._get_app(session, app_id=app_id, tenant_id=app_owner_tenant_id)
        if app is None or app.mode != expected_app_mode:
            raise AppDefinitionUnavailableError(
                f"App {app_id} is unavailable in tenant {app_owner_tenant_id} with mode {expected_app_mode}"
            )

        account_id = actor.account_id if isinstance(actor, MessageAccount) else None
        end_user_id = None if isinstance(actor, MessageAccount) else actor.end_user_id
        source = "console" if isinstance(actor, MessageAccount) else "api"
        if not self._actor_exists(
            session,
            app_id=app_id,
            tenant_id=app_owner_tenant_id,
            account_id=account_id,
            end_user_id=end_user_id,
        ):
            if isinstance(actor, MessageAccount):
                raise MessageActorNotFoundError(f"Account {actor.account_id} no longer exists")
            raise MessageActorNotFoundError(
                f"End user {actor.end_user_id} does not exist for app {app_id} in tenant {app_owner_tenant_id}"
            )

        message = self._get_message(
            session,
            message_id=message_id,
            app_id=app_id,
            source=source,
            account_id=account_id,
            end_user_id=end_user_id,
        )
        if message is None:
            raise MessageNotExistsError()

        conversation = session.scalar(
            select(Conversation).where(
                Conversation.id == message.conversation_id,
                Conversation.app_id == app_id,
                Conversation.from_source == source,
                Conversation.from_account_id == account_id,
                Conversation.from_end_user_id == end_user_id,
                Conversation.is_deleted.is_(False),
            )
        )
        if conversation is None:
            raise ConversationNotExistsError()
        return SuggestedQuestionsRecords(app, conversation)

    def get_model_config(self, *, session: Session, app_id: str, config_id: str | None) -> AppModelConfig | None:
        """Return the app-owned configuration; a missing pointer or row returns None."""
        if config_id is None:
            return None
        return session.scalar(
            select(AppModelConfig).where(AppModelConfig.id == config_id, AppModelConfig.app_id == app_id)
        )

    def load_suggested_questions_history(self, *, context: SuggestedQuestionsContext) -> PreparedHistory:
        # Model resolution separates the two read phases. Reload only the app
        # and conversation needed by the history reader, retaining their owner
        # scope without repeating actor and target-message admission queries.
        with self._session_factory(expire_on_commit=False) as session:
            app = self._get_app(session, app_id=context.app_id, tenant_id=context.tenant_id)
            if app is None or app.mode != context.app_mode:
                raise AppDefinitionUnavailableError(
                    f"App {context.app_id} is unavailable in tenant {context.tenant_id} with mode {context.app_mode}"
                )
            actor = context.actor
            account_id = actor.account_id if isinstance(actor, MessageAccount) else None
            end_user_id = None if isinstance(actor, MessageAccount) else actor.end_user_id
            conversation = session.scalar(
                select(Conversation).where(
                    Conversation.id == context.conversation_id,
                    Conversation.app_id == context.app_id,
                    Conversation.from_source == ("console" if isinstance(actor, MessageAccount) else "api"),
                    Conversation.from_account_id == account_id,
                    Conversation.from_end_user_id == end_user_id,
                    Conversation.is_deleted.is_(False),
                )
            )
            if conversation is None:
                raise ConversationNotExistsError()
            return TokenBufferMemory.load_history(
                conversation=conversation,
                app_record=app,
                session=session,
                message_limit=3,
            )

    def get_more_like_this_source(
        self,
        *,
        app_id: str,
        app_owner_tenant_id: str,
        actor: MessageActor,
        message_id: str,
    ) -> MoreLikeThisSource:
        with self._session_factory() as session:
            app = self._get_app(session, app_id=app_id, tenant_id=app_owner_tenant_id)
            if app is None:
                raise AppDefinitionUnavailableError(f"App {app_id} no longer exists in workspace {app_owner_tenant_id}")
            if app.mode != AppMode.COMPLETION:
                raise MoreLikeThisNotCompletionError(f"App {app_id} is not a completion app")

            account_id = actor.account_id if isinstance(actor, MessageAccount) else None
            end_user_id = None if isinstance(actor, MessageAccount) else actor.end_user_id
            source = "console" if isinstance(actor, MessageAccount) else "api"
            if not self._actor_exists(
                session,
                app_id=app_id,
                tenant_id=app_owner_tenant_id,
                account_id=account_id,
                end_user_id=end_user_id,
            ):
                if isinstance(actor, MessageAccount):
                    raise MessageActorNotFoundError(f"Account {actor.account_id} no longer exists")
                raise MessageActorNotFoundError(f"End user {actor.end_user_id} is unavailable for app {app_id}")

            message = self._get_message(
                session,
                message_id=message_id,
                app_id=app_id,
                source=source,
                account_id=account_id,
                end_user_id=end_user_id,
            )
            if message is None:
                raise MessageNotExistsError(f"Message {message_id} is unavailable for this app and actor")

            current_feature_config = (
                session.scalar(
                    select(AppModelConfig.more_like_this).where(
                        AppModelConfig.id == app.app_model_config_id, AppModelConfig.app_id == app_id
                    )
                )
                if app.app_model_config_id
                else None
            )
            historical_model_config_id = (
                session.scalar(
                    select(Conversation.app_model_config_id).where(
                        Conversation.id == message.conversation_id,
                        Conversation.app_id == app_id,
                        Conversation.from_source == source,
                        Conversation.from_account_id == account_id,
                        Conversation.from_end_user_id == end_user_id,
                    )
                )
                if message.conversation_id
                else None
            )
            files = session.scalars(select(MessageFile).where(MessageFile.message_id == message.id)).all()
            return MoreLikeThisSource(
                app_id=app.id,
                tenant_id=app.tenant_id,
                query=message.query,
                inputs=deepcopy(cast(dict[str, JsonValue], message._inputs)),
                files=tuple(
                    MoreLikeThisFile(
                        id=file.id,
                        type=file.type,
                        transfer_method=file.transfer_method,
                        url=file.url,
                        upload_file_id=file.upload_file_id,
                    )
                    for file in files
                ),
                current_feature_config=current_feature_config,
                historical_model_config_id=historical_model_config_id,
            )

    def get_more_like_this_model_config(
        self, *, app_id: str, app_owner_tenant_id: str, model_config_id: str
    ) -> dict[str, JsonValue] | None:
        """Return the owned historical configuration, or None when unavailable."""
        with self._session_factory() as session:
            config = session.scalar(
                select(AppModelConfig)
                .join(App, App.id == AppModelConfig.app_id)
                .where(
                    App.id == app_id,
                    App.tenant_id == app_owner_tenant_id,
                    App.mode == AppMode.COMPLETION,
                    AppModelConfig.id == model_config_id,
                )
            )
            if config is None:
                return None
            annotation_reply = load_annotation_reply_config(session, app_id)
            try:
                model_config = config.to_dict(annotation_reply=annotation_reply)
            except json.JSONDecodeError as error:
                raise AppModelConfigBrokenError(
                    f"App {app_id}, configuration {model_config_id}: historical configuration contains invalid JSON"
                ) from error
            return deepcopy(cast(dict[str, JsonValue], model_config))

    @staticmethod
    def _get_app(session: Session, *, app_id: str, tenant_id: str) -> App | None:
        """Return the app within its owner tenant, or None when unavailable."""
        return session.scalar(select(App).where(App.id == app_id, App.tenant_id == tenant_id))

    @staticmethod
    def _actor_exists(
        session: Session, *, app_id: str, tenant_id: str, account_id: str | None, end_user_id: str | None
    ) -> bool:
        """Check the normalized actor scope; the other actor kind's ID is None."""
        if account_id is not None:
            return session.get(Account, account_id) is not None
        return (
            session.scalar(
                select(EndUser.id).where(
                    EndUser.id == end_user_id, EndUser.app_id == app_id, EndUser.tenant_id == tenant_id
                )
            )
            is not None
        )

    @staticmethod
    def _get_message(
        session: Session,
        *,
        message_id: str,
        app_id: str,
        source: str,
        account_id: str | None,
        end_user_id: str | None,
    ) -> Message | None:
        """Return the owned message, or None; the other actor kind's ID is None."""
        return session.scalar(
            select(Message).where(
                Message.id == message_id,
                Message.app_id == app_id,
                Message.from_source == source,
                Message.from_account_id == account_id,
                Message.from_end_user_id == end_user_id,
            )
        )

    @staticmethod
    def _to_message_record(*, message: Message, session: Session) -> MessageRecord:
        # Retain model input/file restoration (including its file I/O and legacy
        # commit) until that boundary is migrated; do not recreate the file factory.
        inputs = cast(dict[str, MessageInputValue], message.inputs_with_session(session=session))
        feedback = message.user_feedback_with_session(session=session)
        thoughts = [
            MessageRepository._thought_record(thought)
            for thought in message.agent_thoughts_with_session(session=session)
        ]
        files = [
            MessageFileRecord(
                id=file["id"],
                filename=file["filename"],
                type=file["type"],
                url=file.get("url"),
                mime_type=file.get("mime_type"),
                size=file.get("size"),
                transfer_method=file["transfer_method"],
                belongs_to=file.get("belongs_to"),
                upload_file_id=file.get("upload_file_id"),
            )
            for file in message.message_files_with_session(session=session)
        ]
        return MessageRecord(
            id=message.id,
            conversation_id=message.conversation_id,
            parent_message_id=message.parent_message_id,
            inputs=inputs,
            query=message.query,
            answer=message.re_sign_file_url_answer,
            feedback=MessageRating(rating=feedback.rating.value) if feedback is not None else None,
            retriever_resources=cast(list[dict[str, JsonValue]] | None, message.retriever_resources),
            created_at=message.created_at,
            agent_thoughts=thoughts,
            message_files=files,
            message_tokens=message.message_tokens,
            answer_tokens=message.answer_tokens,
            provider_response_latency=message.provider_response_latency,
            total_price=message.total_price,
            currency=message.currency,
            status=message.status.value,
            error=message.error,
            metadata=cast(JsonValue, message.message_metadata_dict),
        )

    @staticmethod
    def _thought_record(thought: MessageAgentThought) -> MessageAgentThoughtRecord:
        return MessageAgentThoughtRecord(
            id=thought.id,
            message_id=thought.message_id,
            message_chain_id=thought.message_chain_id,
            position=thought.position,
            thought=thought.thought,
            answer=thought.answer,
            tool=thought.tool,
            tool_labels=cast(JsonValue, thought.tool_labels),
            tool_input=thought.tool_input,
            created_at=thought.created_at,
            observation=thought.observation,
            files=cast(list[str], thought.files),
        )

    @staticmethod
    def _account_record(account: Account | None) -> MessageAccountRecord | None:
        return MessageAccountRecord(id=account.id, name=account.name, email=account.email) if account else None

    def _to_console_message_record(self, *, message: Message, session: Session) -> ConsoleMessageRecord:
        record = self._to_message_record(message=message, session=session)
        annotation = message.annotation_with_session(session=session)
        annotation_hit = message.annotation_hit_history_with_session(session=session)
        return ConsoleMessageRecord(
            id=record.id,
            conversation_id=record.conversation_id,
            parent_message_id=record.parent_message_id,
            inputs=record.inputs,
            query=record.query,
            answer=record.answer,
            feedback=record.feedback,
            retriever_resources=record.retriever_resources,
            created_at=record.created_at,
            agent_thoughts=record.agent_thoughts,
            message_files=record.message_files,
            message_tokens=record.message_tokens,
            answer_tokens=record.answer_tokens,
            provider_response_latency=record.provider_response_latency,
            total_price=record.total_price,
            currency=record.currency,
            status=record.status,
            error=record.error,
            metadata=record.metadata,
            message=deepcopy(cast(JsonValue, message.message)),
            from_source=message.from_source,
            from_end_user_id=message.from_end_user_id,
            from_account_id=message.from_account_id,
            workflow_run_id=message.workflow_run_id,
            feedbacks=[
                ConsoleMessageFeedbackRecord(
                    rating=feedback.rating.value,
                    content=feedback.content,
                    from_source=feedback.from_source.value,
                    from_end_user_id=feedback.from_end_user_id,
                    from_account=self._account_record(feedback.from_account_with_session(session=session)),
                )
                for feedback in message.feedbacks_with_session(session=session)
            ],
            annotation=MessageAnnotationRecord(
                id=annotation.id,
                question=annotation.question,
                content=annotation.content,
                account=self._account_record(annotation.account_with_session(session=session)),
                created_at=annotation.created_at,
            )
            if annotation
            else None,
            annotation_hit_history=MessageAnnotationHitRecord(
                id=annotation_hit.id,
                annotation_create_account=self._account_record(
                    annotation_hit.annotation_create_account_with_session(session=session)
                ),
                created_at=annotation_hit.created_at,
            )
            if annotation_hit
            else None,
        )
