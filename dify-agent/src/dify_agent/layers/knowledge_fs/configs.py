"""Client-safe configuration and state for the autonomous knowledge CLI."""

from typing import ClassVar

from pydantic import BaseModel, ConfigDict, Field

from dify_agent.protocol.knowledge_fs import KnowledgeFsBinding


class DifyKnowledgeFsLayerConfig(BaseModel):
    execution_context: str = "execution_context"
    shell: str = "shell"
    spaces: list[KnowledgeFsBinding] = Field(min_length=1, max_length=10)
    agent_supports_vision: bool = False

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class DifyKnowledgeFsRuntimeState(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # Opaque budget identity of the last run. It is not a credential; the
    # shared store also binds it to the execution/config identity.
    budget_id: str | None = None
