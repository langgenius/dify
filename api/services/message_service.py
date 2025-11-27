import json
from datetime import datetime
from typing import Union

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from core.app.apps.advanced_chat.app_config_manager import AdvancedChatAppConfigManager
from core.app.entities.app_invoke_entities import InvokeFrom
from core.llm_generator.llm_generator import LLMGenerator
from core.memory.token_buffer_memory import TokenBufferMemory
from core.model_manager import ModelManager
from core.model_runtime.entities.model_entities import ModelType
from core.ops.entities.trace_entity import TraceTaskName
from core.ops.ops_trace_manager import TraceQueueManager, TraceTask
from core.ops.utils import measure_time
from extensions.ext_database import db
from libs.infinite_scroll_pagination import InfiniteScrollPagination
from models import Account
from models.model import App, AppMode, AppModelConfig, EndUser, Message, MessageFeedback
from services.conversation_service import ConversationService
from services.errors.message import (
    FirstMessageNotExistsError,
    LastMessageNotExistsError,
    MessageNotExistsError,
    SuggestedQuestionsAfterAnswerDisabledError,
)
from services.workflow_service import WorkflowService


class MessageService:
    @classmethod
    def pagination_by_first_id(
        cls,
        app_model: App,
        user: Union[Account, EndUser] | None,
        conversation_id: str,
        first_id: str | None,
        limit: int,
        order: str = "asc",
    ) -> InfiniteScrollPagination:
        if not user:
            return InfiniteScrollPagination(data=[], limit=limit, has_more=False)

        if not conversation_id:
            return InfiniteScrollPagination(data=[], limit=limit, has_more=False)

        conversation = ConversationService.get_conversation(
            app_model=app_model, user=user, conversation_id=conversation_id
        )

        fetch_limit = limit + 1

        if first_id:
            first_message = (
                db.session.query(Message)
                .where(Message.conversation_id == conversation.id, Message.id == first_id)
                .first()
            )

            if not first_message:
                raise FirstMessageNotExistsError()

            history_messages = (
                db.session.query(Message)
                .where(
                    Message.conversation_id == conversation.id,
                    Message.created_at < first_message.created_at,
                    Message.id != first_message.id,
                )
                .order_by(Message.created_at.desc())
                .limit(fetch_limit)
                .all()
            )
        else:
            history_messages = (
                db.session.query(Message)
                .where(Message.conversation_id == conversation.id)
                .order_by(Message.created_at.desc())
                .limit(fetch_limit)
                .all()
            )

        has_more = False
        if len(history_messages) > limit:
            has_more = True
            history_messages = history_messages[:-1]

        if order == "asc":
            history_messages = list(reversed(history_messages))

        return InfiniteScrollPagination(data=history_messages, limit=limit, has_more=has_more)

    @classmethod
    def pagination_by_last_id(
        cls,
        app_model: App,
        user: Union[Account, EndUser] | None,
        last_id: str | None,
        limit: int,
        conversation_id: str | None = None,
        include_ids: list | None = None,
    ) -> InfiniteScrollPagination:
        if not user:
            return InfiniteScrollPagination(data=[], limit=limit, has_more=False)

        base_query = db.session.query(Message)

        fetch_limit = limit + 1

        if conversation_id is not None:
            conversation = ConversationService.get_conversation(
                app_model=app_model, user=user, conversation_id=conversation_id
            )

            base_query = base_query.where(Message.conversation_id == conversation.id)

        # Check if include_ids is not None and not empty to avoid WHERE false condition
        if include_ids is not None:
            if len(include_ids) == 0:
                return InfiniteScrollPagination(data=[], limit=limit, has_more=False)
            base_query = base_query.where(Message.id.in_(include_ids))

        if last_id:
            last_message = base_query.where(Message.id == last_id).first()

            if not last_message:
                raise LastMessageNotExistsError()

            history_messages = (
                base_query.where(Message.created_at < last_message.created_at, Message.id != last_message.id)
                .order_by(Message.created_at.desc())
                .limit(fetch_limit)
                .all()
            )
        else:
            history_messages = base_query.order_by(Message.created_at.desc()).limit(fetch_limit).all()

        has_more = False
        if len(history_messages) > limit:
            has_more = True
            history_messages = history_messages[:-1]

        return InfiniteScrollPagination(data=history_messages, limit=limit, has_more=has_more)

    @classmethod
    def create_feedback(
        cls,
        *,
        app_model: App,
        message_id: str,
        user: Union[Account, EndUser] | None,
        rating: str | None,
        content: str | None,
    ):
        if not user:
            raise ValueError("user cannot be None")

        message = cls.get_message(app_model=app_model, user=user, message_id=message_id)

        feedback = message.user_feedback if isinstance(user, EndUser) else message.admin_feedback

        if not rating and feedback:
            db.session.delete(feedback)
        elif rating and feedback:
            feedback.rating = rating
            feedback.content = content
        elif not rating and not feedback:
            raise ValueError("rating cannot be None when feedback not exists")
        else:
            assert rating is not None
            feedback = MessageFeedback(
                app_id=app_model.id,
                conversation_id=message.conversation_id,
                message_id=message.id,
                rating=rating,
                content=content,
                from_source=("user" if isinstance(user, EndUser) else "admin"),
                from_end_user_id=(user.id if isinstance(user, EndUser) else None),
                from_account_id=(user.id if isinstance(user, Account) else None),
            )
            db.session.add(feedback)

        db.session.commit()

        return feedback

    @classmethod
    def get_all_messages_feedbacks(cls, app_model: App, page: int, limit: int):
        """Get all feedbacks of an app"""
        offset = (page - 1) * limit
        feedbacks = (
            db.session.query(MessageFeedback)
            .where(MessageFeedback.app_id == app_model.id)
            .order_by(MessageFeedback.created_at.desc(), MessageFeedback.id.desc())
            .limit(limit)
            .offset(offset)
            .all()
        )

        return [record.to_dict() for record in feedbacks]

    @classmethod
    def get_message(cls, app_model: App, user: Union[Account, EndUser] | None, message_id: str):
        message = (
            db.session.query(Message)
            .where(
                Message.id == message_id,
                Message.app_id == app_model.id,
                Message.from_source == ("api" if isinstance(user, EndUser) else "console"),
                Message.from_end_user_id == (user.id if isinstance(user, EndUser) else None),
                Message.from_account_id == (user.id if isinstance(user, Account) else None),
            )
            .first()
        )

        if not message:
            raise MessageNotExistsError()

        return message

    @classmethod
    def get_suggested_questions_after_answer(
        cls, app_model: App, user: Union[Account, EndUser] | None, message_id: str, invoke_from: InvokeFrom
    ) -> list[str]:
        if not user:
            raise ValueError("user cannot be None")

        message = cls.get_message(app_model=app_model, user=user, message_id=message_id)

        conversation = ConversationService.get_conversation(
            app_model=app_model, conversation_id=message.conversation_id, user=user
        )

        model_manager = ModelManager()

        if app_model.mode == AppMode.ADVANCED_CHAT:
            workflow_service = WorkflowService()
            if invoke_from == InvokeFrom.DEBUGGER:
                workflow = workflow_service.get_draft_workflow(app_model=app_model)
            else:
                workflow = workflow_service.get_published_workflow(app_model=app_model)

            if workflow is None:
                return []

            app_config = AdvancedChatAppConfigManager.get_app_config(app_model=app_model, workflow=workflow)

            if not app_config.additional_features:
                raise ValueError("Additional features not found")

            if not app_config.additional_features.suggested_questions_after_answer:
                raise SuggestedQuestionsAfterAnswerDisabledError()

            model_instance = model_manager.get_default_model_instance(
                tenant_id=app_model.tenant_id, model_type=ModelType.LLM
            )
        else:
            if not conversation.override_model_configs:
                app_model_config = (
                    db.session.query(AppModelConfig)
                    .where(AppModelConfig.id == conversation.app_model_config_id, AppModelConfig.app_id == app_model.id)
                    .first()
                )
            else:
                conversation_override_model_configs = json.loads(conversation.override_model_configs)
                app_model_config = AppModelConfig(
                    id=conversation.app_model_config_id,
                    app_id=app_model.id,
                )

                app_model_config = app_model_config.from_model_config_dict(conversation_override_model_configs)
            if not app_model_config:
                raise ValueError("did not find app model config")

            suggested_questions_after_answer = app_model_config.suggested_questions_after_answer_dict
            if suggested_questions_after_answer.get("enabled", False) is False:
                raise SuggestedQuestionsAfterAnswerDisabledError()

            model_instance = model_manager.get_model_instance(
                tenant_id=app_model.tenant_id,
                provider=app_model_config.model_dict["provider"],
                model_type=ModelType.LLM,
                model=app_model_config.model_dict["name"],
            )

        # get memory of conversation (read-only)
        memory = TokenBufferMemory(conversation=conversation, model_instance=model_instance)

        histories = memory.get_history_prompt_text(
            max_token_limit=3000,
            message_limit=3,
        )

        with measure_time() as timer:
            questions_sequence = LLMGenerator.generate_suggested_questions_after_answer(
                tenant_id=app_model.tenant_id, histories=histories
            )
            questions: list[str] = list(questions_sequence)

        # get tracing instance
        trace_manager = TraceQueueManager(app_id=app_model.id)
        trace_manager.add_trace_task(
            TraceTask(
                TraceTaskName.SUGGESTED_QUESTION_TRACE, message_id=message_id, suggested_question=questions, timer=timer
            )
        )

        return questions

    @classmethod
    def get_paginate_message_logs(
        cls,
        *,
        session: Session,
        app_model: App,
        keyword: str | None = None,
        created_at_before: datetime | None = None,
        created_at_after: datetime | None = None,
        page: int = 1,
        limit: int = 20,
        created_by_end_user_session_id: str | None = None,
        created_by_account: str | None = None,
    ):
        """
        Get paginated message logs for completion and chat applications with token consumption.

        Fix for issue #20759: Add interfaces for retrieving logs from text generation
        applications and chat applications, and enable the retrieval of the total token
        consumption for each log entry, similar to how workflow logs are retrieved.

        This method provides a comprehensive way to retrieve and filter message logs from
        both completion (text generation) and chat applications. It includes support for:

        - Keyword searching across query and answer fields
        - Date range filtering (before/after timestamps)
        - User filtering (by account email or end user session ID)
        - Pagination with configurable page size
        - Token consumption data (message_tokens, answer_tokens, total_tokens)

        The method uses efficient SQL queries with proper joins to avoid N+1 query problems
        when loading related account and end_user information.

        Args:
            session: SQLAlchemy session for database operations
            app_model: The application model to retrieve logs for
            keyword: Optional search keyword that searches in both query and answer fields.
                The search is case-insensitive and uses LIKE pattern matching.
            created_at_before: Optional datetime to filter messages created before this time.
                Useful for retrieving historical logs up to a specific point in time.
            created_at_after: Optional datetime to filter messages created after this time.
                Useful for retrieving recent logs from a specific point in time onwards.
            page: Page number for pagination (1-indexed). Default is 1.
            limit: Number of items per page. Default is 20, maximum should be enforced by caller.
            created_by_end_user_session_id: Optional end user session ID to filter messages
                created by a specific end user session. Only applies to API-sourced messages.
            created_by_account: Optional account email to filter messages created by a specific
                account. Only applies to console-sourced messages.

        Returns:
            dict: A dictionary containing pagination metadata and log entries:
                - page: Current page number
                - limit: Items per page
                - total: Total number of messages matching the filters
                - has_more: Boolean indicating if there are more pages
                - data: List of MessageLogView objects with token consumption data

        Raises:
            ValueError: If account email is provided but account is not found

        Example:
            >>> service = MessageService()
            >>> with Session(db.engine) as session:
            ...     result = service.get_paginate_message_logs(
            ...         session=session,
            ...         app_model=app,
            ...         keyword="Python",
            ...         page=1,
            ...         limit=20
            ...     )
            ...     for log_entry in result["data"]:
            ...         total = log_entry.message_tokens + log_entry.answer_tokens
            ...         print(f"Tokens: {log_entry.message_tokens} + {log_entry.answer_tokens} = {total}")
        """
        # ========================================================================
        # STEP 1: Build the base SQL query
        # ========================================================================
        # Start with a basic SELECT statement filtering by app_id
        # This ensures we only retrieve messages for the specified application
        stmt = select(Message).where(
            Message.app_id == app_model.id
        )

        # ========================================================================
        # STEP 2: Apply keyword search filtering (if provided)
        # ========================================================================
        # Keyword search allows users to find messages containing specific text
        # in either the query (user input) or answer (assistant response) fields
        if keyword:
            # Prepare the keyword for SQL LIKE pattern matching
            # - Limit to first 30 characters to prevent extremely long patterns
            # - Escape unicode characters to prevent SQL injection
            # - Wrap with % wildcards for partial matching
            keyword_like_val = f"%{keyword[:30].encode('unicode_escape').decode('utf-8')}%".replace(r"\u", r"\\u")

            # Build conditions to search in both query and answer fields
            # Using ilike for case-insensitive matching
            keyword_conditions = [
                Message.query.ilike(keyword_like_val),
                Message.answer.ilike(keyword_like_val),
            ]

            # If filtering by end user session, also search in session_id
            # This allows finding messages by searching for the session ID
            if created_by_end_user_session_id:
                # Join with EndUser table to access session_id
                stmt = stmt.outerjoin(
                    EndUser,
                    and_(
                        Message.from_end_user_id == EndUser.id,
                        Message.from_source == "api",  # Only API messages have end users
                    ),
                ).where(
                    or_(
                        *keyword_conditions,  # Search in query/answer
                        and_(
                            Message.from_source == "api",
                            EndUser.session_id.ilike(keyword_like_val),  # Also search in session_id
                        ),
                    ),
                )
            else:
                # Simple keyword search without end user join
                stmt = stmt.where(or_(*keyword_conditions))

        # ========================================================================
        # STEP 3: Apply date range filtering (if provided)
        # ========================================================================
        # Date range filtering allows retrieving logs from specific time periods
        # This is useful for:
        # - Generating reports for specific date ranges
        # - Analyzing usage patterns over time
        # - Compliance and audit requirements

        # Filter messages created before a specific timestamp
        # Useful for retrieving historical logs up to a certain point
        if created_at_before:
            stmt = stmt.where(Message.created_at <= created_at_before)

        # Filter messages created after a specific timestamp
        # Useful for retrieving recent logs from a certain point onwards
        if created_at_after:
            stmt = stmt.where(Message.created_at >= created_at_after)

        # ========================================================================
        # STEP 4: Apply user-based filtering (if provided)
        # ========================================================================
        # User filtering allows retrieving logs for specific users or accounts
        # This is useful for:
        # - User-specific analytics and reporting
        # - Debugging issues for specific users
        # - Compliance and audit trails

        # Filter by end user session ID
        # This filters messages created by a specific end user session
        # Only applies to messages with from_source="api" (API-sourced messages)
        if created_by_end_user_session_id:
            # Join with EndUser table to access session_id field
            # Using outerjoin to handle cases where end_user might not exist
            stmt = stmt.outerjoin(
                EndUser,
                and_(
                    Message.from_end_user_id == EndUser.id,
                    Message.from_source == "api",  # Only API messages have end users
                ),
            ).where(EndUser.session_id == created_by_end_user_session_id)

        # Filter by account email
        # This filters messages created by a specific account (console user)
        # Only applies to messages with from_source="console" (console-sourced messages)
        if created_by_account:
            # First, find the account by email address
            # This validates that the account exists before filtering
            account = session.scalar(select(Account).where(Account.email == created_by_account))

            # Validate that the account was found
            if not account:
                # Use BadRequest for API consistency (matches remote version)
                from controllers.service_api.app.error import BadRequest
                raise BadRequest(f"Account not found: {created_by_account}")

            # Join with Account table to filter by account ID
            # Using outerjoin to handle edge cases
            stmt = stmt.outerjoin(
                Account,
                and_(
                    Message.from_account_id == Account.id,
                    Message.from_source == "console",  # Only console messages have accounts
                ),
            ).where(Account.id == account.id)

        # ========================================================================
        # STEP 5: Apply ordering and pagination
        # ========================================================================
        # Order results by creation time, newest first
        # This ensures the most recent logs appear first in the results
        stmt = stmt.order_by(Message.created_at.desc())

        # ========================================================================
        # STEP 6: Calculate total count for pagination metadata
        # ========================================================================
        # Get the total number of messages matching all the filters
        # This is needed to calculate pagination metadata (has_more, total pages, etc.)
        # We use a subquery to apply the same filters but only count the results
        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = session.scalar(count_stmt) or 0

        # ========================================================================
        # STEP 7: Apply pagination limits
        # ========================================================================
        # Calculate the offset based on page number and limit
        # Page 1: offset = 0, Page 2: offset = limit, Page 3: offset = 2*limit, etc.
        offset_stmt = stmt.offset((page - 1) * limit).limit(limit)

        # ========================================================================
        # STEP 8: Execute the query and retrieve message items
        # ========================================================================
        # Execute the paginated query to get the actual message records
        # This returns only the messages for the current page
        items = session.scalars(offset_stmt).all()

        # ========================================================================
        # STEP 9: Enhance items with account and end_user information
        # ========================================================================
        # To avoid N+1 query problems, we batch-load all related accounts and end_users
        # This is similar to how workflow logs handle relationships efficiently
        # Instead of querying the database for each message's account/end_user,
        # we collect all IDs first, then load them all at once

        enhanced_items = []
        account_ids = set()
        end_user_ids = set()

        # First pass: Collect all unique account and end_user IDs from the messages
        # This allows us to load all related records in a single query per type
        for item in items:
            if item.from_account_id:
                account_ids.add(item.from_account_id)
            if item.from_end_user_id:
                end_user_ids.add(item.from_end_user_id)

        # ========================================================================
        # STEP 10: Batch load accounts and end_users
        # ========================================================================
        # Load all accounts in a single query using IN clause
        # This is much more efficient than loading them one by one
        accounts_dict = {}
        if account_ids:
            accounts = session.scalars(select(Account).where(Account.id.in_(account_ids))).all()
            # Create a dictionary for O(1) lookup by ID
            accounts_dict = {acc.id: acc for acc in accounts}

        # Load all end_users in a single query using IN clause
        # Same efficiency optimization as accounts
        end_users_dict = {}
        if end_user_ids:
            end_users = session.scalars(select(EndUser).where(EndUser.id.in_(end_user_ids))).all()
            # Create a dictionary for O(1) lookup by ID
            end_users_dict = {eu.id: eu for eu in end_users}

        # ========================================================================
        # STEP 11: Create enhanced message log view objects
        # ========================================================================
        # We use a wrapper class to add account and end_user references to messages
        # This allows the API response to include full account/end_user information
        # without modifying the Message model itself

        class MessageLogView:
            """
            Wrapper for Message with account and end_user references.

            This class provides a view of a Message object that includes related
            account and end_user information. It delegates all other attributes
            to the underlying Message object, making it transparent to use.
            """

            def __init__(self, message: Message, account, end_user):
                """
                Initialize the MessageLogView.

                Args:
                    message: The Message object to wrap
                    account: The Account object associated with this message (if any)
                    end_user: The EndUser object associated with this message (if any)
                """
                self._message = message
                self.created_by_account = account
                self.created_by_end_user = end_user

            def __getattr__(self, name):
                """
                Delegate attribute access to the underlying Message object.

                This allows transparent access to all Message attributes while
                adding the account and end_user references.

                Args:
                    name: Attribute name to retrieve

                Returns:
                    The attribute value from the underlying Message object
                """
                # Delegate all other attributes to the message object
                return getattr(self._message, name)

        # ========================================================================
        # STEP 12: Build the final enhanced items list
        # ========================================================================
        # Create MessageLogView objects for each message, attaching the appropriate
        # account and end_user references based on the message's from_account_id
        # and from_end_user_id fields
        for item in items:
            # Look up the account if the message has an account ID
            account = accounts_dict.get(item.from_account_id) if item.from_account_id else None

            # Look up the end_user if the message has an end_user ID
            end_user = end_users_dict.get(item.from_end_user_id) if item.from_end_user_id else None

            # Create the enhanced view object with all references
            enhanced_items.append(MessageLogView(item, account, end_user))

        # ========================================================================
        # STEP 13: Return pagination result with enhanced data
        # ========================================================================
        # Return a dictionary with pagination metadata and the enhanced message log entries
        # Each entry includes token consumption data (message_tokens, answer_tokens)
        # and related account/end_user information
        return {
            "page": page,
            "limit": limit,
            "total": total,
            "has_more": total > page * limit,  # True if there are more pages available
            "data": enhanced_items,  # List of MessageLogView objects with token data
        }
