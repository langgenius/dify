import contextlib
import logging
from collections.abc import Callable, Sequence
from typing import Any, Union

from sqlalchemy import asc, desc, func, or_, select
from sqlalchemy.orm import Session

from core.app.entities.app_invoke_entities import InvokeFrom
from core.llm_generator.llm_generator import LLMGenerator
from core.variables.types import SegmentType
from core.workflow.nodes.variable_assigner.common.impl import conversation_variable_updater_factory
from extensions.ext_database import db
from factories import variable_factory
from libs.datetime_utils import naive_utc_now
from libs.infinite_scroll_pagination import InfiniteScrollPagination
from models import Account, ConversationVariable
from models.model import App, Conversation, EndUser, Message
from services.errors.conversation import (
    ConversationNotExistsError,
    ConversationVariableNotExistsError,
    ConversationVariableTypeMismatchError,
    LastConversationNotExistsError,
)
from services.errors.message import MessageNotExistsError
from tasks.delete_conversation_task import delete_conversation_related_data

logger = logging.getLogger(__name__)


class ConversationService:
    @classmethod
    def pagination_by_last_id(
        cls,
        *,
        session: Session,
        app_model: App,
        user: Union[Account, EndUser] | None,
        last_id: str | None,
        limit: int,
        invoke_from: InvokeFrom,
        include_ids: Sequence[str] | None = None,
        exclude_ids: Sequence[str] | None = None,
        sort_by: str = "-updated_at",
    ) -> InfiniteScrollPagination:
        if not user:
            return InfiniteScrollPagination(data=[], limit=limit, has_more=False)

        stmt = select(Conversation).where(
            Conversation.is_deleted == False,
            Conversation.app_id == app_model.id,
            Conversation.from_source == ("api" if isinstance(user, EndUser) else "console"),
            Conversation.from_end_user_id == (user.id if isinstance(user, EndUser) else None),
            Conversation.from_account_id == (user.id if isinstance(user, Account) else None),
            or_(Conversation.invoke_from.is_(None), Conversation.invoke_from == invoke_from.value),
        )
        # Check if include_ids is not None to apply filter
        if include_ids is not None:
            if len(include_ids) == 0:
                # If include_ids is empty, return empty result
                return InfiniteScrollPagination(data=[], limit=limit, has_more=False)
            stmt = stmt.where(Conversation.id.in_(include_ids))
        # Check if exclude_ids is not None to apply filter
        if exclude_ids is not None:
            if len(exclude_ids) > 0:
                stmt = stmt.where(~Conversation.id.in_(exclude_ids))

        # define sort fields and directions
        sort_field, sort_direction = cls._get_sort_params(sort_by)

        if last_id:
            last_conversation = session.scalar(stmt.where(Conversation.id == last_id))
            if not last_conversation:
                raise LastConversationNotExistsError()

            # build filters based on sorting
            filter_condition = cls._build_filter_condition(
                sort_field=sort_field,
                sort_direction=sort_direction,
                reference_conversation=last_conversation,
            )
            stmt = stmt.where(filter_condition)
        query_stmt = stmt.order_by(sort_direction(getattr(Conversation, sort_field))).limit(limit)
        conversations = session.scalars(query_stmt).all()

        has_more = False
        if len(conversations) == limit:
            current_page_last_conversation = conversations[-1]
            rest_filter_condition = cls._build_filter_condition(
                sort_field=sort_field,
                sort_direction=sort_direction,
                reference_conversation=current_page_last_conversation,
            )
            count_stmt = select(func.count()).select_from(stmt.where(rest_filter_condition).subquery())
            rest_count = session.scalar(count_stmt) or 0
            if rest_count > 0:
                has_more = True

        return InfiniteScrollPagination(data=conversations, limit=limit, has_more=has_more)

    @classmethod
    def _get_sort_params(cls, sort_by: str):
        if sort_by.startswith("-"):
            return sort_by[1:], desc
        return sort_by, asc

    @classmethod
    def _build_filter_condition(cls, sort_field: str, sort_direction: Callable, reference_conversation: Conversation):
        field_value = getattr(reference_conversation, sort_field)
        if sort_direction is desc:
            return getattr(Conversation, sort_field) < field_value

        return getattr(Conversation, sort_field) > field_value

    @classmethod
    def rename(
        cls,
        app_model: App,
        conversation_id: str,
        user: Union[Account, EndUser] | None,
        name: str,
        auto_generate: bool,
    ):
        conversation = cls.get_conversation(app_model, conversation_id, user)

        if auto_generate:
            return cls.auto_generate_name(app_model, conversation)
        else:
            conversation.name = name
            conversation.updated_at = naive_utc_now()
            db.session.commit()

        return conversation

    @classmethod
    def auto_generate_name(cls, app_model: App, conversation: Conversation):
        # get conversation first message
        message = (
            db.session.query(Message)
            .where(Message.app_id == app_model.id, Message.conversation_id == conversation.id)
            .order_by(Message.created_at.asc())
            .first()
        )

        if not message:
            raise MessageNotExistsError()

        # generate conversation name
        with contextlib.suppress(Exception):
            name = LLMGenerator.generate_conversation_name(
                app_model.tenant_id, message.query, conversation.id, app_model.id
            )
            conversation.name = name

        db.session.commit()

        return conversation

    @classmethod
    def get_conversation(cls, app_model: App, conversation_id: str, user: Union[Account, EndUser] | None):
        conversation = (
            db.session.query(Conversation)
            .where(
                Conversation.id == conversation_id,
                Conversation.app_id == app_model.id,
                Conversation.from_source == ("api" if isinstance(user, EndUser) else "console"),
                Conversation.from_end_user_id == (user.id if isinstance(user, EndUser) else None),
                Conversation.from_account_id == (user.id if isinstance(user, Account) else None),
                Conversation.is_deleted == False,
            )
            .first()
        )

        if not conversation:
            raise ConversationNotExistsError()

        return conversation

    @classmethod
    def delete(cls, app_model: App, conversation_id: str, user: Union[Account, EndUser] | None):
        try:
            logger.info(
                "Initiating conversation deletion for app_name %s, conversation_id: %s",
                app_model.name,
                conversation_id,
            )

            db.session.query(Conversation).where(Conversation.id == conversation_id).delete(synchronize_session=False)
            db.session.commit()

            delete_conversation_related_data.delay(conversation_id)

        except Exception as e:
            db.session.rollback()
            raise e

    @classmethod
    def get_conversational_variable(
        cls,
        app_model: App,
        conversation_id: str,
        user: Union[Account, EndUser] | None,
        limit: int,
        last_id: str | None,
    ) -> InfiniteScrollPagination:
        conversation = cls.get_conversation(app_model, conversation_id, user)

        stmt = (
            select(ConversationVariable)
            .where(ConversationVariable.app_id == app_model.id)
            .where(ConversationVariable.conversation_id == conversation.id)
            .order_by(ConversationVariable.created_at)
        )

        with Session(db.engine) as session:
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
        user: Union[Account, EndUser] | None,
        new_value: Any,
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
        conversation = cls.get_conversation(app_model, conversation_id, user)

        # Get the existing conversation variable
        stmt = (
            select(ConversationVariable)
            .where(ConversationVariable.app_id == app_model.id)
            .where(ConversationVariable.conversation_id == conversation.id)
            .where(ConversationVariable.id == variable_id)
        )

        with Session(db.engine) as session:
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

            # Use the conversation variable updater to persist the changes
            updater = conversation_variable_updater_factory()
            updater.update(conversation_id, updated_variable)
            updater.flush()

            # Return the updated variable data
            return {
                "created_at": existing_variable.created_at,
                "updated_at": naive_utc_now(),  # Update timestamp
                **updated_variable.model_dump(),
            }
