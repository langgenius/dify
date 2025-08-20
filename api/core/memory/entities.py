from enum import Enum
from typing import Any, Optional
from uuid import uuid4

from pydantic import BaseModel, Field


class MemoryScope(str, Enum):
    """Memory scope determined by node_id field"""
    APP = "app"  # node_id is None
    NODE = "node"  # node_id is not None


class MemoryTerm(str, Enum):
    """Memory term determined by conversation_id field"""
    SESSION = "session"  # conversation_id is not None
    PERSISTENT = "persistent"  # conversation_id is None


class MemoryStrategy(str, Enum):
    ON_TURNS = "on_turns"


class MemoryScheduleMode(str, Enum):
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
    model: Optional[dict[str, Any]] = Field(default=None, description="Model configuration for memory updates")
    end_user_visible: bool = Field(default=False, description="Whether memory is visible to end users")
    end_user_editable: bool = Field(default=False, description="Whether memory is editable by end users")


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
    id: str
    memory_id: str
    name: str
    value: str
    scope: MemoryScope  # Derived from node_id: None=APP, str=NODE
    term: MemoryTerm  # Derived from conversation_id: None=PERSISTENT, str=SESSION
    app_id: str  # None=global(future), str=app-specific
    conversation_id: Optional[str] = None  # None=persistent, str=session
    node_id: Optional[str] = None  # None=app-scope, str=node-scope
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    @property
    def is_global(self) -> bool:
        """Check if this is global memory (future feature)"""
        return self.app_id is None

    @property
    def is_persistent(self) -> bool:
        """Check if this is persistent memory (cross-conversation)"""
        return self.conversation_id is None

    @property
    def is_app_scope(self) -> bool:
        """Check if this is app-level scope"""
        return self.node_id is None

    @property
    def is_node_scope(self) -> bool:
        """Check if this is node-level scope"""
        return self.node_id is not None


class ChatflowConversationMetadata(BaseModel):
    """Metadata for chatflow conversation with visible message count"""
    type: str = "mutable_visible_window"
    visible_count: int = Field(gt=0, description="Number of visible messages to keep")
