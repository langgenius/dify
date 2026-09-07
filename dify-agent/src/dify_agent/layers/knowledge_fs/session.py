"""Runtime-owned knowledge session port; no Redis dependency in layer DTOs."""

from typing import Protocol

from pydantic import BaseModel, ConfigDict

from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.protocol.knowledge_fs import KnowledgeFsBinding, KnowledgeFsCitation, KnowledgeFsCommandResult


class KnowledgeFsSession(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    budget_id: str
    run_id: str
    execution_context: DifyExecutionContextLayerConfig
    bindings: list[KnowledgeFsBinding]
    agent_supports_vision: bool


class KnowledgeFsDelivery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    result: KnowledgeFsCommandResult
    image_base64: str | None = None
    image_media_type: str | None = None


class KnowledgeFsSessionStore(Protocol):
    async def create(
        self,
        *,
        run_id: str,
        execution_context: DifyExecutionContextLayerConfig,
        bindings: list[KnowledgeFsBinding],
        agent_supports_vision: bool,
        resume_budget_id: str | None = None,
    ) -> KnowledgeFsSession: ...
    async def refresh(self, session: KnowledgeFsSession) -> None: ...
    async def close(self, session: KnowledgeFsSession) -> None: ...
    async def load(self, session_id: str) -> KnowledgeFsSession: ...
    async def reserve(self, session: KnowledgeFsSession, command_id: str) -> None: ...
    async def release(self, session: KnowledgeFsSession, command_id: str) -> None: ...
    async def deliver(self, session: KnowledgeFsSession, delivery: KnowledgeFsDelivery) -> None: ...
    async def drain(self, session: KnowledgeFsSession) -> list[KnowledgeFsDelivery]: ...
    async def citation(self, session: KnowledgeFsSession, receipt_id: str) -> KnowledgeFsCitation: ...
