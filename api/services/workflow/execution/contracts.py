"""Contracts shared by workflow runners and the execution orchestrator."""

from __future__ import annotations

from collections.abc import Generator, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Protocol

from core.app.entities.app_invoke_entities import (
    AdvancedChatAppGenerateEntity,
    RagPipelineGenerateEntity,
    WorkflowAppGenerateEntity,
)
from core.app.entities.queue_entities import NodeExecutionSnapshot
from core.app.layers.pause_state_persist_layer import PauseStateLayerConfig
from core.repositories.factory import WorkflowExecutionRepository, WorkflowNodeExecutionRepository
from core.workflow.nodes.human_input.pause_reason import PauseReason
from graphon.engine import Engine
from graphon.engine.filter import ResponseStreamFilter
from graphon.engine.layer import Layer
from graphon.engine_events import EngineEvent
from graphon.entities.pause_reason import HitlRequired
from graphon.enums import WorkflowType
from models.human_input_contracts import HumanInputFormRecord
from services.human_input.ports import HumanInputFormReader


class WorkflowRunEntry(Protocol):
    """Engine entry surface needed by orchestration and event publication."""

    graph_engine: Engine
    graph_config: Mapping[str, Any]

    @property
    def response_stream_filter(self) -> ResponseStreamFilter: ...

    def run(self) -> Generator[EngineEvent]: ...


@dataclass(frozen=True, slots=True)
class PreparedWorkflowRun:
    """Prepared engine and workflow facts handed to the persistence-owning orchestrator."""

    entry: WorkflowRunEntry
    workflow_type: WorkflowType
    workflow_version: str
    generate_entity: AdvancedChatAppGenerateEntity | WorkflowAppGenerateEntity | RagPipelineGenerateEntity
    application_layers: Sequence[Layer]
    """Layers that also receive terminal failures raised after the engine closes."""


class WorkflowRunRunner(Protocol):
    """Runner capabilities used by the execution orchestrator."""

    @property
    def human_form_reader(self) -> HumanInputFormReader: ...

    def prepare(self) -> PreparedWorkflowRun | None: ...

    def publish_human_input_results(
        self,
        workflow_entry: WorkflowRunEntry,
        pending_forms: Mapping[str, HitlRequired],
        forms: Mapping[str, HumanInputFormRecord],
        published_form_ids: set[str],
    ) -> None: ...

    def handle_event(
        self,
        workflow_entry: WorkflowRunEntry,
        event: EngineEvent,
        *,
        node_run_index: int = 1,
        node_execution_snapshots: tuple[NodeExecutionSnapshot, ...] = (),
        pause_reasons: Sequence[PauseReason] = (),
    ) -> None: ...


class WorkflowRunDriver(Protocol):
    """Execute one prepared run while keeping persistence owned by orchestration."""

    def __call__(
        self,
        runner: WorkflowRunRunner,
        pause_state_config: PauseStateLayerConfig | None,
        workflow_execution_repository: WorkflowExecutionRepository,
        workflow_node_execution_repository: WorkflowNodeExecutionRepository,
    ) -> None: ...
