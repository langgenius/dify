"""Dependencies shared by execution adapters, supplied by the composition root."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import TYPE_CHECKING, Protocol

from graphon.entities.pause_reason import HitlRequired
from graphon.runtime.graph_runtime_state_protocol import ReadOnlyVariablePool
from models import Account, EndUser, Workflow
from models.agent_runtime_contracts import WorkflowAgentRuntimeBindings
from models.dataset import Dataset
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.human_input_contracts import HumanInputFormFactory, PauseFormSnapshot
from models.tool_runtime_contracts import WorkflowToolQueries
from models.workflow import WorkflowAppLogCreatedFrom, WorkflowNodeExecutionTriggeredFrom
from services.tools.provider_queries import ToolProviders
from services.workflow.execution.node_queries import ConversationHistory, DatasourceCredentials, RetrieverAttachments

if TYPE_CHECKING:
    from core.repositories.factory import WorkflowExecutionRepository, WorkflowNodeExecutionRepository
    from core.workflow.nodes.human_input.pause_reason import PauseReason


class PauseReasonResolver(Protocol):
    def __call__(
        self, *, reasons: Sequence[HitlRequired | PauseReason], variable_pool: ReadOnlyVariablePool | None
    ) -> list[PauseReason]: ...


class ExecutionContexts(Protocol):
    def pause_forms(
        self, *, tenant_id: str, app_id: str, workflow_run_id: str, form_ids: Sequence[str]
    ) -> list[PauseFormSnapshot]: ...
    def pipeline_workflow(self, *, tenant_id: str, pipeline_id: str, draft: bool) -> Workflow: ...
    def pipeline_dataset(self, *, tenant_id: str, pipeline_id: str) -> Dataset: ...
    def restore_graph(self, workflow: Workflow, workflow_run_id: str | None) -> None: ...
    def workflow(self, *, tenant_id: str, app_id: str, workflow_id: str) -> Workflow: ...


class ExecutionWriterFactory(Protocol):
    def __call__(
        self, *, tenant_id: str, user: Account | EndUser, app_id: str, triggered_from: WorkflowRunTriggeredFrom
    ) -> WorkflowExecutionRepository: ...


class NodeExecutionWriterFactory(Protocol):
    def __call__(
        self,
        *,
        tenant_id: str,
        user: Account | EndUser,
        app_id: str,
        triggered_from: WorkflowNodeExecutionTriggeredFrom,
    ) -> WorkflowNodeExecutionRepository: ...


class WorkflowExecutionLogs(Protocol):
    def record(
        self,
        *,
        tenant_id: str,
        app_id: str,
        workflow_id: str,
        workflow_run_id: str,
        created_from: WorkflowAppLogCreatedFrom,
        created_by_role: CreatorUserRole,
        created_by: str,
    ) -> None: ...


from services.human_input.ports import HumanInputFormReader
from services.knowledge.retrieval.ports import DatasetRetrievalFactory


class WorkflowRuntime(Protocol):
    """Capabilities needed to execute a graph, including nested Workflow Tools."""

    @property
    def history(self) -> ConversationHistory: ...
    @property
    def retrieval(self) -> DatasetRetrievalFactory: ...
    @property
    def attachments(self) -> RetrieverAttachments: ...
    @property
    def datasource_credentials(self) -> DatasourceCredentials: ...
    @property
    def contexts(self) -> ExecutionContexts: ...
    @property
    def logs(self) -> WorkflowExecutionLogs: ...
    @property
    def tools(self) -> WorkflowToolQueries: ...
    @property
    def tool_providers(self) -> ToolProviders: ...
    @property
    def agent_bindings(self) -> WorkflowAgentRuntimeBindings: ...
    @property
    def human_forms(self) -> HumanInputFormFactory: ...
    @property
    def human_form_reader(self) -> HumanInputFormReader: ...
    @property
    def execution_writer(self) -> ExecutionWriterFactory: ...
    @property
    def node_writer(self) -> NodeExecutionWriterFactory: ...
    @property
    def resolve_pause(self) -> PauseReasonResolver: ...
    @property
    def notify_pause(self) -> Callable[[Sequence[object]], None]: ...
