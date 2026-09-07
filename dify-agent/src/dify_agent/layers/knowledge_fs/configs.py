"""Client-safe configuration and state for the autonomous knowledge CLI."""

from typing import ClassVar

from agenton.layers import LayerConfig
from pydantic import BaseModel, ConfigDict, Field

from dify_agent.protocol.knowledge_fs import KnowledgeFsBinding

DIFY_KNOWLEDGE_FS_LAYER_TYPE_ID = "dify.knowledge_fs"


class DifyKnowledgeFsLayerConfig(LayerConfig):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")
    spaces: list[KnowledgeFsBinding] = Field(min_length=1, max_length=10)
    agent_supports_vision: bool = False


class DifyKnowledgeFsRuntimeState(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # Only the opaque budget identity survives HITL. It is not a credential;
    # the shared store also binds it to the execution/config identity.
    budget_id: str | None = None
