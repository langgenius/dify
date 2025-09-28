import json
from collections.abc import MutableMapping, Sequence
from typing import Literal, Optional, overload

from sqlalchemy import Row, Select, and_, func, select
from sqlalchemy.orm import Session

from core.memory.entities import ChatflowConversationMetadata
from core.model_runtime.entities.message_entities import (
    PromptMessage,
)
from extensions.ext_database import db
from models.chatflow_memory import ChatflowConversation, ChatflowMessage


class ChatflowHistoryService:

    @staticmethod
    def get_visible_chat_history(
        conversation_id: str,
        app_id: str,
        tenant_id: str,
        node_id: Optional[str] = None,
        max_visible_count: Optional[int] = None
    ) -> Sequence[PromptMessage]:
        with Session(db.engine) as session:
            chatflow_conv = ChatflowHistoryService._get_or_create_chatflow_conversation(
                session, conversation_id, app_id, tenant_id, node_id, create_if_missing=False
            )

            if not chatflow_conv:
                return []

            metadata = ChatflowConversationMetadata.model_validate_json(chatflow_conv.conversation_metadata)
            visible_count: int = max_visible_count or metadata.visible_count

            stmt = select(ChatflowMessage).where(
                ChatflowMessage.conversation_id == chatflow_conv.id
            ).order_by(ChatflowMessage.index.asc(), ChatflowMessage.version.desc())
            raw_messages: Sequence[Row[tuple[ChatflowMessage]]] = session.execute(stmt).all()
            sorted_messages = ChatflowHistoryService._filter_latest_messages(
                [it[0] for it in raw_messages]
            )
            visible_count = min(visible_count, len(sorted_messages))
            visible_messages = sorted_messages[-visible_count:]
            return [PromptMessage.model_validate_json(it.data) for it in visible_messages]

    @staticmethod
    def save_message(
        prompt_message: PromptMessage,
        conversation_id: str,
        app_id: str,
        tenant_id: str,
        node_id: Optional[str] = None
    ) -> None:
        with Session(db.engine) as session:
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
            new_message = ChatflowMessage(
                conversation_id=chatflow_conv.id,
                index=next_index,
                version=1,
                data=json.dumps(prompt_message)
            )
            session.add(new_message)
            session.commit()

            # 添加：每次保存消息后简单增长visible_count
            current_metadata = ChatflowConversationMetadata.model_validate_json(chatflow_conv.conversation_metadata)
            new_visible_count = current_metadata.visible_count + 1
            new_metadata = ChatflowConversationMetadata(visible_count=new_visible_count)
            chatflow_conv.conversation_metadata = new_metadata.model_dump_json()

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
        ChatflowHistoryService.save_message(
            prompt_message=prompt_message,
            conversation_id=conversation_id,
            app_id=app_id,
            tenant_id=tenant_id,
            node_id=node_id
        )

    @staticmethod
    def update_visible_count(
        conversation_id: str,
        node_id: Optional[str],
        new_visible_count: int,
        app_id: str,
        tenant_id: str
    ) -> None:
        with Session(db.engine) as session:
            chatflow_conv = ChatflowHistoryService._get_or_create_chatflow_conversation(
                session, conversation_id, app_id, tenant_id, node_id, create_if_missing=True
            )

            # Only update visible_count in metadata, do not delete any data
            new_metadata = ChatflowConversationMetadata(visible_count=new_visible_count)
            chatflow_conv.conversation_metadata = new_metadata.model_dump_json()

            session.commit()

    @staticmethod
    def get_conversation_metadata(
        tenant_id: str,
        app_id: str,
        conversation_id: str,
        node_id: Optional[str]
    ) -> ChatflowConversationMetadata:
        with Session(db.engine) as session:
            chatflow_conv = ChatflowHistoryService._get_or_create_chatflow_conversation(
                session, conversation_id, app_id, tenant_id, node_id, create_if_missing=False
            )
            if not chatflow_conv:
                raise ValueError(f"Conversation not found: {conversation_id}")
            return ChatflowConversationMetadata.model_validate_json(chatflow_conv.conversation_metadata)

    @staticmethod
    def _filter_latest_messages(raw_messages: Sequence[ChatflowMessage]) -> Sequence[ChatflowMessage]:
        index_to_message: MutableMapping[int, ChatflowMessage] = {}
        for msg in raw_messages:
            index = msg.index
            if index not in index_to_message or msg.version > index_to_message[index].version:
                index_to_message[index] = msg

        sorted_messages = sorted(index_to_message.values(), key=lambda m: m.index)
        return sorted_messages

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
                default_metadata = ChatflowConversationMetadata(visible_count=0)
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
