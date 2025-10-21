from __future__ import annotations

from enum import StrEnum
from typing import Optional
from uuid import uuid4

from pydantic import BaseModel, Field

from core.app.app_config.entities import ModelConfig


class MemoryScope(StrEnum):
    """Memory scope determined by node_id field"""
    APP = "app"  # node_id is None
    NODE = "node"  # node_id is not None


class MemoryTerm(StrEnum):
    """Memory term determined by conversation_id field"""
    SESSION = "session"  # conversation_id is not None
    PERSISTENT = "persistent"  # conversation_id is None


class MemoryStrategy(StrEnum):
    ON_TURNS = "on_turns"


class MemoryScheduleMode(StrEnum):
    SYNC = "sync"
    ASYNC = "async"


class MemoryBlockSpec(BaseModel):
    """Memory block specification for workflow configuration"""
    id: str = Field(
        default_factory=lambda: str(uuid4()),
        description="Unique identifier for the memory block",
    )
    name: str = Field(description="Display name of the memory block")
    description: str = Field(default="", description="Description of the memory block")
    template: str = Field(description="Initial template content for the memory")
    instruction: str = Field(description="Instructions for updating the memory")
    scope: MemoryScope = Field(description="Scope of the memory (app or node level)")
    term: MemoryTerm = Field(description="Term of the memory (session or persistent)")
    strategy: MemoryStrategy = Field(description="Update strategy for the memory")
    update_turns: int = Field(gt=0, description="Number of turns between updates")
    preserved_turns: int = Field(gt=0, description="Number of conversation turns to preserve")
    schedule_mode: MemoryScheduleMode = Field(description="Synchronous or asynchronous update mode")
    model: ModelConfig = Field(description="Model configuration for memory updates")
    end_user_visible: bool = Field(default=False, description="Whether memory is visible to end users")
    end_user_editable: bool = Field(default=False, description="Whether memory is editable by end users")


class MemoryCreatedBy(BaseModel):
    end_user_id: str | None = None
    account_id: str | None = None


class MemoryBlock(BaseModel):
    """Runtime memory block instance

    Design Rules:
    - app_id = None: Global memory (future feature, not implemented yet)
    - app_id = str: App-specific memory
    - conversation_id = None: Persistent memory (cross-conversation)
    - conversation_id = str: Session memory (conversation-specific)
    - node_id = None: App-level scope
    - node_id = str: Node-level scope

    These rules implicitly determine scope and term without redundant storage.
    """
    spec: MemoryBlockSpec
    tenant_id: str
    value: str
    app_id: str
    conversation_id: Optional[str] = None
    node_id: Optional[str] = None
    edited_by_user: bool = False
    created_by: MemoryCreatedBy
    version: int = Field(description="Memory block version number")


class MemoryValueData(BaseModel):
    value: str
    edited_by_user: bool = False


class ChatflowConversationMetadata(BaseModel):
    """Metadata for chatflow conversation with visible message count"""
    type: str = "mutable_visible_window"
    visible_count: int = Field(gt=0, description="Number of visible messages to keep")


class MemoryBlockWithConversation(MemoryBlock):
    """MemoryBlock with optional conversation metadata for session memories"""
    conversation_metadata: ChatflowConversationMetadata = Field(
        description="Conversation metadata, only present for session memories"
    )

    @classmethod
    def from_memory_block(
        cls,
        memory_block: MemoryBlock,
        conversation_metadata: ChatflowConversationMetadata
    ) -> MemoryBlockWithConversation:
        """Create MemoryBlockWithConversation from MemoryBlock"""
        return cls(
            spec=memory_block.spec,
            tenant_id=memory_block.tenant_id,
            value=memory_block.value,
            app_id=memory_block.app_id,
            conversation_id=memory_block.conversation_id,
            node_id=memory_block.node_id,
            edited_by_user=memory_block.edited_by_user,
            created_by=memory_block.created_by,
            version=memory_block.version,
            conversation_metadata=conversation_metadata
        )
