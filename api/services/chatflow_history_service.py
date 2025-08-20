import json
import time
from collections.abc import Sequence
from typing import Literal, Optional, overload

from sqlalchemy import Row, Select, and_, func, select
from sqlalchemy.orm import Session

from core.memory.entities import ChatflowConversationMetadata
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
    UserPromptMessage,
)
from extensions.ext_database import db
from models.chatflow_memory import ChatflowConversation, ChatflowMessage


class ChatflowHistoryService:
    """
    Service layer for managing chatflow conversation history.

    This unified service handles all chatflow memory operations:
    - Reading visible chat history with version control
    - Saving messages to append-only table
    - Managing visible_count metadata
    - Supporting both app-level and node-level scoping
    """

    @staticmethod
    def get_visible_chat_history(
        conversation_id: str,
        app_id: str,
        tenant_id: str,
        node_id: Optional[str] = None,
        max_visible_count: Optional[int] = None
    ) -> Sequence[PromptMessage]:
        """
        Get visible chat history based on metadata visible_count.

        Args:
            conversation_id: Original conversation ID
            node_id: None for app-level, specific node_id for node-level
            max_visible_count: Override visible_count for memory update operations

        Returns:
            Sequence of PromptMessage objects in chronological order (oldest first)
        """
        with db.session() as session:
            chatflow_conv = ChatflowHistoryService._get_or_create_chatflow_conversation(
                session, conversation_id, app_id, tenant_id, node_id, create_if_missing=False
            )

            if not chatflow_conv:
                return []

            # Parse metadata
            metadata_dict = json.loads(chatflow_conv.conversation_metadata)
            metadata = ChatflowConversationMetadata.model_validate(metadata_dict)

            # Determine the actual number of messages to return
            target_visible_count = max_visible_count if max_visible_count is not None else metadata.visible_count

            # Fetch all messages (handle versioning)
            msg_stmt = select(ChatflowMessage).where(
                ChatflowMessage.conversation_id == chatflow_conv.id
            ).order_by(ChatflowMessage.index.asc(), ChatflowMessage.version.desc())

            all_messages: Sequence[Row[tuple[ChatflowMessage]]] = session.execute(msg_stmt).all()

            # Filter in memory: keep only the latest version for each index
            latest_messages_by_index: dict[int, ChatflowMessage] = {}
            for msg_row in all_messages:
                msg = msg_row[0]
                index = msg.index

                if index not in latest_messages_by_index or msg.version > latest_messages_by_index[index].version:
                    latest_messages_by_index[index] = msg

            # Sort by index and take the latest target_visible_count messages
            sorted_messages = sorted(latest_messages_by_index.values(), key=lambda m: m.index, reverse=True)
            visible_messages = sorted_messages[:target_visible_count]

            # Convert to PromptMessage and restore correct order (oldest first)
            prompt_messages: list[PromptMessage] = []
            for msg in reversed(visible_messages):  # Restore chronological order (index ascending)
                data = json.loads(msg.data)
                role = data.get('role', 'user')
                content = data.get('content', '')

                if role == 'user':
                    prompt_messages.append(UserPromptMessage(content=content))
                elif role == 'assistant':
                    prompt_messages.append(AssistantPromptMessage(content=content))

            return prompt_messages

    @staticmethod
    def get_app_visible_chat_history(
        app_id: str,
        conversation_id: str,
        tenant_id: str,
        max_visible_count: Optional[int] = None
    ) -> Sequence[PromptMessage]:
        """Get visible chat history for app level."""
        return ChatflowHistoryService.get_visible_chat_history(
            conversation_id=conversation_id,
            app_id=app_id,
            tenant_id=tenant_id,
            node_id=None,  # App level
            max_visible_count=max_visible_count
        )

    @staticmethod
    def get_node_visible_chat_history(
        node_id: str,
        conversation_id: str,
        app_id: str,
        tenant_id: str,
        max_visible_count: Optional[int] = None
    ) -> Sequence[PromptMessage]:
        """Get visible chat history for a specific node."""
        return ChatflowHistoryService.get_visible_chat_history(
            conversation_id=conversation_id,
            app_id=app_id,
            tenant_id=tenant_id,
            node_id=node_id,
            max_visible_count=max_visible_count
        )

    @staticmethod
    def save_message(
        prompt_message: PromptMessage,
        conversation_id: str,
        app_id: str,
        tenant_id: str,
        node_id: Optional[str] = None
    ) -> None:
        """
        Save a message to the append-only chatflow_messages table.

        Args:
            node_id: None for app-level, specific node_id for node-level
        """
        with db.session() as session:
            chatflow_conv = ChatflowHistoryService._get_or_create_chatflow_conversation(
                session, conversation_id, app_id, tenant_id, node_id, create_if_missing=True
            )

            # Get next index
            max_index = session.execute(
                select(func.max(ChatflowMessage.index)).where(
                    ChatflowMessage.conversation_id == chatflow_conv.id
                )
            ).scalar() or -1
            next_index = max_index + 1

            # Save new message to append-only table
            message_data = {
                'role': prompt_message.role.value,
                'content': prompt_message.get_text_content(),
                'timestamp': time.time()
            }

            new_message = ChatflowMessage(
                conversation_id=chatflow_conv.id,
                index=next_index,
                version=1,
                data=json.dumps(message_data)
            )
            session.add(new_message)
            session.commit()

    @staticmethod
    def save_app_message(
        prompt_message: PromptMessage,
        conversation_id: str,
        app_id: str,
        tenant_id: str
    ) -> None:
        """Save PromptMessage to app-level chatflow conversation."""
        ChatflowHistoryService.save_message(
            prompt_message=prompt_message,
            conversation_id=conversation_id,
            app_id=app_id,
            tenant_id=tenant_id,
            node_id=None
        )

    @staticmethod
    def save_node_message(
        prompt_message: PromptMessage,
        node_id: str,
        conversation_id: str,
        app_id: str,
        tenant_id: str
    ) -> None:
        """Save PromptMessage to node-specific chatflow conversation."""
        ChatflowHistoryService.save_message(
            prompt_message=prompt_message,
            conversation_id=conversation_id,
            app_id=app_id,
            tenant_id=tenant_id,
            node_id=node_id
        )

    @staticmethod
    def save_message_version(
        prompt_message: PromptMessage,
        message_index: int,
        conversation_id: str,
        app_id: str,
        tenant_id: str,
        node_id: Optional[str] = None
    ) -> None:
        """
        Save a new version of an existing message (for message editing scenarios).
        """
        with db.session() as session:
            chatflow_conv = ChatflowHistoryService._get_or_create_chatflow_conversation(
                session, conversation_id, app_id, tenant_id, node_id, create_if_missing=True
            )

            # Get the maximum version number for this index
            max_version = session.execute(
                select(func.max(ChatflowMessage.version)).where(
                    and_(
                        ChatflowMessage.conversation_id == chatflow_conv.id,
                        ChatflowMessage.index == message_index
                    )
                )
            ).scalar() or 0
            next_version = max_version + 1

            # Save new version of the message
            message_data = {
                'role': prompt_message.role.value,
                'content': prompt_message.get_text_content(),
                'timestamp': time.time()
            }

            new_message_version = ChatflowMessage(
                conversation_id=chatflow_conv.id,
                index=message_index,
                version=next_version,
                data=json.dumps(message_data)
            )
            session.add(new_message_version)
            session.commit()

    @staticmethod
    def update_visible_count(
        conversation_id: str,
        node_id: Optional[str],
        new_visible_count: int,
        app_id: str,
        tenant_id: str
    ) -> None:
        """
        Update visible_count metadata for specific scope.

        Args:
            node_id: None for app-level updates, specific node_id for node-level updates
            new_visible_count: The new visible_count value (typically preserved_turns)

        Usage Examples:
            # Update app-level visible_count
            ChatflowHistoryService.update_visible_count(conv_id, None, 10, app_id, tenant_id)

            # Update node-specific visible_count
            ChatflowHistoryService.update_visible_count(conv_id, "node-123", 8, app_id, tenant_id)
        """
        with db.session() as session:
            chatflow_conv = ChatflowHistoryService._get_or_create_chatflow_conversation(
                session, conversation_id, app_id, tenant_id, node_id, create_if_missing=True
            )

            # Only update visible_count in metadata, do not delete any data
            new_metadata = ChatflowConversationMetadata(visible_count=new_visible_count)
            chatflow_conv.conversation_metadata = new_metadata.model_dump_json()

            session.commit()

    @overload
    @staticmethod
    def _get_or_create_chatflow_conversation(
        session: Session,
        conversation_id: str,
        app_id: str,
        tenant_id: str,
        node_id: Optional[str] = None,
        create_if_missing: Literal[True] = True
    ) -> ChatflowConversation: ...

    @overload
    @staticmethod
    def _get_or_create_chatflow_conversation(
        session: Session,
        conversation_id: str,
        app_id: str,
        tenant_id: str,
        node_id: Optional[str] = None,
        create_if_missing: Literal[False] = False
    ) -> Optional[ChatflowConversation]: ...

    @overload
    @staticmethod
    def _get_or_create_chatflow_conversation(
        session: Session,
        conversation_id: str,
        app_id: str,
        tenant_id: str,
        node_id: Optional[str] = None,
        create_if_missing: bool = False
    ) -> Optional[ChatflowConversation]: ...

    @staticmethod
    def _get_or_create_chatflow_conversation(
        session: Session,
        conversation_id: str,
        app_id: str,
        tenant_id: str,
        node_id: Optional[str] = None,
        create_if_missing: bool = False
    ) -> Optional[ChatflowConversation]:
        """Get existing chatflow conversation or optionally create new one"""
        stmt: Select[tuple[ChatflowConversation]] = select(ChatflowConversation).where(
            and_(
                ChatflowConversation.original_conversation_id == conversation_id,
                ChatflowConversation.tenant_id == tenant_id,
                ChatflowConversation.app_id == app_id
            )
        )

        if node_id:
            stmt = stmt.where(ChatflowConversation.node_id == node_id)
        else:
            stmt = stmt.where(ChatflowConversation.node_id.is_(None))

        chatflow_conv: Row[tuple[ChatflowConversation]] | None = session.execute(stmt).first()

        if chatflow_conv:
            result: ChatflowConversation = chatflow_conv[0]  # Extract the ChatflowConversation object
            return result
        else:
            if create_if_missing:
                # Create a new chatflow conversation
                default_metadata = ChatflowConversationMetadata(visible_count=20)
                new_chatflow_conv = ChatflowConversation(
                    tenant_id=tenant_id,
                    app_id=app_id,
                    node_id=node_id,
                    original_conversation_id=conversation_id,
                    conversation_metadata=default_metadata.model_dump_json(),
                )
                session.add(new_chatflow_conv)
                session.flush()  # Obtain ID
                return new_chatflow_conv
            return None
