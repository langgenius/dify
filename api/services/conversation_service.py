import logging
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from configs import dify_config
from core.app.entities.app_invoke_entities import get_credit_usage_app_type
from core.llm_generator.llm_generator import LLMGenerator
from core.model_context import use_credit_usage_metadata
from factories import variable_factory
from graphon.variables.types import SegmentType
from libs.datetime_utils import naive_utc_now
from libs.infinite_scroll_pagination import InfiniteScrollPagination
from models import Account, ConversationVariable
from models.model import App, Conversation, EndUser
from repositories.conversation_lifecycle import retire_conversation
from services.errors.conversation import (
    ConversationNotExistsError,
    ConversationVariableNotExistsError,
    ConversationVariableTypeMismatchError,
)
from tasks.collect_agent_resources_task import enqueue_agent_resource_collection
from tasks.delete_conversation_task import delete_conversation_related_data

logger = logging.getLogger(__name__)


class ConversationService:
    @staticmethod
    def generate_name(*, tenant_id: str, app_id: str, conversation_id: str, query: str, app_mode: str) -> str:
        """Generate a conversation title with the appropriate credit usage metadata."""
        with use_credit_usage_metadata({"app_type": get_credit_usage_app_type(app_mode)}):
            return LLMGenerator.generate_conversation_name(tenant_id, query, conversation_id, app_id)

    @classmethod
    def get_conversation(
        cls, app_model: App, conversation_id: str, user: Account | EndUser | None, *, session: Session
    ):
        conversation = session.scalar(
            select(Conversation)
            .where(
                Conversation.id == conversation_id,
                Conversation.app_id == app_model.id,
                Conversation.from_source == ("api" if isinstance(user, EndUser) else "console"),
                Conversation.from_end_user_id == (user.id if isinstance(user, EndUser) else None),
                Conversation.from_account_id == (user.id if isinstance(user, Account) else None),
                Conversation.is_deleted == False,
            )
            .limit(1)
        )

        if not conversation:
            raise ConversationNotExistsError()

        return conversation

    @classmethod
    def delete(cls, app_model: App, conversation_id: str, user: Account | EndUser | None, *, session: Session) -> None:
        """
        Delete a conversation only if it belongs to the given user and app context.

        Conversation deletion is the product lifecycle boundary for its
        Workspace. Physical collection happens only after the retire commit.

        Raises:
            ConversationNotExistsError: When the conversation is not visible to the current user.
        """
        conversation = cls.get_conversation(app_model, conversation_id, user, session=session)
        tenant_id = app_model.tenant_id
        try:
            retired_workspace_ids = retire_conversation(app_model=app_model, conversation=conversation, session=session)
            session.commit()
        except Exception:
            session.rollback()
            raise
        cls.enqueue_delete_cleanup(
            tenant_id=tenant_id,
            conversation_id=conversation_id,
            retired_workspace_ids=retired_workspace_ids,
        )

    @staticmethod
    def enqueue_delete_cleanup(*, tenant_id: str, conversation_id: str, retired_workspace_ids: tuple[str, ...]) -> None:
        """Dispatch resource collection only after the lifecycle transaction commits."""
        if retired_workspace_ids:
            enqueue_agent_resource_collection(
                tenant_id=tenant_id,
                workspace_ids=retired_workspace_ids,
            )
        try:
            delete_conversation_related_data.delay(conversation_id)
        except Exception:
            # The soft-deleted row is a durable cleanup marker picked up by the
            # periodic sweeper, so a broker outage must not resurrect or expose it.
            logger.exception("Failed to enqueue cleanup for conversation %s", conversation_id)

    @classmethod
    def get_conversational_variable(
        cls,
        app_model: App,
        conversation_id: str,
        user: Account | EndUser | None,
        limit: int,
        last_id: str | None,
        variable_name: str | None = None,
        *,
        session: Session,
    ) -> InfiniteScrollPagination:
        conversation = cls.get_conversation(app_model, conversation_id, user, session=session)

        stmt = (
            select(ConversationVariable)
            .where(ConversationVariable.app_id == app_model.id, ConversationVariable.conversation_id == conversation.id)
            .order_by(ConversationVariable.created_at)
        )

        # Apply variable_name filter if provided
        if variable_name:
            # Filter using JSON extraction to match variable names case-insensitively
            from libs.helper import escape_like_pattern

            escaped_variable_name = escape_like_pattern(variable_name)
            # Filter using JSON extraction to match variable names case-insensitively
            if dify_config.DB_TYPE in ["mysql", "oceanbase", "seekdb"]:
                stmt = stmt.where(
                    func.json_extract(ConversationVariable.data, "$.name").ilike(
                        f"%{escaped_variable_name}%", escape="\\"
                    )
                )
            elif dify_config.DB_TYPE == "postgresql":
                stmt = stmt.where(
                    func.json_extract_path_text(ConversationVariable.data, "name").ilike(
                        f"%{escaped_variable_name}%", escape="\\"
                    )
                )

        if last_id:
            last_variable = session.scalar(stmt.where(ConversationVariable.id == last_id))
            if not last_variable:
                raise ConversationVariableNotExistsError()

            # Filter for variables created after the last_id
            stmt = stmt.where(ConversationVariable.created_at > last_variable.created_at)

        # Apply limit to query: fetch one extra row to determine has_more
        query_stmt = stmt.limit(limit + 1)
        rows = session.scalars(query_stmt).all()

        has_more = False
        if len(rows) > limit:
            has_more = True
            rows = rows[:limit]  # Remove the extra item

        variables = [
            {
                "created_at": row.created_at,
                "updated_at": row.updated_at,
                **row.to_variable().model_dump(),
                "id": row.id,
            }
            for row in rows
        ]

        return InfiniteScrollPagination(variables, limit, has_more)

    @classmethod
    def update_conversation_variable(
        cls,
        app_model: App,
        conversation_id: str,
        variable_id: str,
        user: Account | EndUser | None,
        new_value: Any,
        *,
        session: Session,
    ):
        """
        Update a conversation variable's value.

        Args:
            app_model: The app model
            conversation_id: The conversation ID
            variable_id: The variable ID to update
            user: The user (Account or EndUser)
            new_value: The new value for the variable

        Returns:
            Dictionary containing the updated variable information

        Raises:
            ConversationNotExistsError: If the conversation doesn't exist
            ConversationVariableNotExistsError: If the variable doesn't exist
            ConversationVariableTypeMismatchError: If the new value type doesn't match the variable's expected type
        """
        # Verify conversation exists and user has access
        conversation = cls.get_conversation(app_model, conversation_id, user, session=session)

        # Get the existing conversation variable
        stmt = select(ConversationVariable).where(
            ConversationVariable.app_id == app_model.id,
            ConversationVariable.conversation_id == conversation.id,
            ConversationVariable.id == variable_id,
        )

        existing_variable = session.scalar(stmt)
        if not existing_variable:
            raise ConversationVariableNotExistsError()

        # Convert existing variable to Variable object
        current_variable = existing_variable.to_variable()

        # Validate that the new value type matches the expected variable type
        expected_type = SegmentType(current_variable.value_type)

        # There is showing number in web ui but int in db
        if expected_type == SegmentType.INTEGER:
            expected_type = SegmentType.NUMBER

        if not expected_type.is_valid(new_value):
            inferred_type = SegmentType.infer_segment_type(new_value)
            raise ConversationVariableTypeMismatchError(
                f"Type mismatch: variable '{current_variable.name}' expects {expected_type.value}, "
                f"but got {inferred_type.value if inferred_type else 'unknown'} type"
            )

        # Create updated variable with new value only, preserving everything else
        updated_variable_dict = {
            "id": current_variable.id,
            "name": current_variable.name,
            "description": current_variable.description,
            "value_type": current_variable.value_type,
            "value": new_value,
            "selector": current_variable.selector,
        }

        updated_variable = variable_factory.build_conversation_variable_from_mapping(updated_variable_dict)
        existing_variable.data = updated_variable.model_dump_json()
        session.commit()

        return {
            "created_at": existing_variable.created_at,
            "updated_at": naive_utc_now(),  # Update timestamp
            **updated_variable.model_dump(),
            "id": existing_variable.id,
        }
