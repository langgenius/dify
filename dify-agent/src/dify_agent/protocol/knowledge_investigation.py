"""Private, bounded runtime observations for asynchronous knowledge quality review.

These DTOs are never accepted from shell output. The Stub records attempts and
the run server marks delivery and supplies the original question/final answer.
"""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.protocol.knowledge_fs import KnowledgeFsBinding, KnowledgeFsCommandName


class KnowledgeAttempt(BaseModel):
    model_config = ConfigDict(extra="forbid")
    command_id: UUID
    control_space_id: UUID
    command: KnowledgeFsCommandName
    query: str = Field(default="", max_length=4000)
    path: str = Field(default="", max_length=4096)
    outcome: Literal["evidence", "empty", "error"]
    code: str | None = Field(default=None, max_length=120)
    started_at_ms: int = Field(ge=0)
    elapsed_ms: int = Field(ge=0)
    result_count: int = Field(default=0, ge=0)
    truncated: bool = False
    delivered: bool = False
    # Snippets, not whole documents, images, capabilities, or private transport plans.
    evidence: str = Field(default="", max_length=2000)
    receipt_ids: list[str] = Field(default_factory=list, max_length=50)
    authorization_fingerprint: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    trace_id: str | None = Field(default=None, max_length=512)


class KnowledgeInvestigationPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    investigation_id: UUID
    execution_context: DifyExecutionContextLayerConfig
    bindings: list[KnowledgeFsBinding] = Field(min_length=1, max_length=10)
    query: str = Field(max_length=8000)
    answer: str = Field(default="", max_length=12000)
    status: Literal["completed", "interrupted"]
    attempts: list[KnowledgeAttempt] = Field(max_length=64)
