"""Compatibility wrapper for the service-owned nested workflow tool.

New callers must import :class:`services.tools.workflow.tool.WorkflowTool` and
provide its execution dependencies directly. The legacy core tool stack still
constructs workflow tools while materializing provider metadata, so this
wrapper temporarily preserves that constructor and its ``execution_driver``
attribute until the core stack is retired.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING, override

from core.app.apps.draft_variable_saver import DraftVariableSaverFactory
from core.helper.trace_id_helper import ParentTraceContext
from core.tools.__base.tool import Tool
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.tool_entities import ToolEntity
from graphon.model_runtime.entities.llm_entities import LLMUsage
from models import Account
from models.tool_runtime_contracts import WorkflowToolQueries
from services.tools.workflow.tool import WorkflowTool as ServiceWorkflowTool
from services.workflow.execution.ports import WorkflowRuntime

if TYPE_CHECKING:
    from services.workflow.execution.contracts import WorkflowRunDriver


class WorkflowTool(ServiceWorkflowTool):
    """Keep the legacy construction surface without restoring hidden dependencies.

    Metadata-only legacy callers may omit the new execution ports. Invocation
    remains guarded by the canonical implementation, which raises when no
    ``WorkflowRuntime`` was injected.
    """

    def __init__(
        self,
        workflow_app_id: str,
        workflow_id: str,
        workflow_as_tool_id: str,
        version: str,
        workflow_call_depth: int,
        entity: ToolEntity,
        runtime: ToolRuntime,
        label: str = "Workflow",
        execution_driver: WorkflowRunDriver | None = None,
        *,
        queries: WorkflowToolQueries | None = None,
        draft_variable_saver: Callable[[str, Account], DraftVariableSaverFactory] | None = None,
        workflow_runtime: WorkflowRuntime | None = None,
    ) -> None:
        if queries is None and workflow_runtime is not None:
            queries = workflow_runtime.tools

        if queries is not None:
            super().__init__(
                workflow_app_id=workflow_app_id,
                workflow_id=workflow_id,
                workflow_as_tool_id=workflow_as_tool_id,
                version=version,
                workflow_call_depth=workflow_call_depth,
                entity=entity,
                runtime=runtime,
                label=label,
                queries=queries,
                draft_variable_saver=draft_variable_saver,
                workflow_runtime=workflow_runtime,
            )
        else:
            # The legacy provider also materializes tool metadata for list and
            # configuration APIs. It has no execution composition root, so do
            # not invent one; initialize only the state those APIs require.
            self.workflow_app_id = workflow_app_id
            self.workflow_id = workflow_id
            self.workflow_as_tool_id = workflow_as_tool_id
            self.version = version
            self.workflow_call_depth = workflow_call_depth
            self.label = label
            self._draft_variable_saver = draft_variable_saver
            self._workflow_runtime = None
            self._latest_usage = LLMUsage.empty_usage()
            self._parent_trace_context: ParentTraceContext | None = None
            self._trace_session_id: str | None = None
            Tool.__init__(self, entity=entity, runtime=runtime)

        self._legacy_queries = queries
        self._legacy_execution_driver = execution_driver

    @property
    def execution_driver(self) -> WorkflowRunDriver | None:
        """Preserve the mutable attribute used by the retiring core manager."""
        if self._workflow_runtime is not None:
            return self._workflow_runtime.execution_driver
        return self._legacy_execution_driver

    @execution_driver.setter
    def execution_driver(self, execution_driver: WorkflowRunDriver | None) -> None:
        self._legacy_execution_driver = execution_driver

    @override
    def fork_tool_runtime(self, runtime: ToolRuntime) -> WorkflowTool:
        forked = self.__class__(
            queries=self._legacy_queries,
            entity=self.entity.model_copy(),
            runtime=runtime,
            workflow_app_id=self.workflow_app_id,
            workflow_id=self.workflow_id,
            workflow_as_tool_id=self.workflow_as_tool_id,
            workflow_call_depth=self.workflow_call_depth,
            version=self.version,
            label=self.label,
            execution_driver=self._legacy_execution_driver,
            draft_variable_saver=self._draft_variable_saver,
            workflow_runtime=self._workflow_runtime,
        )
        forked._parent_trace_context = self._parent_trace_context.model_copy() if self._parent_trace_context else None
        forked._trace_session_id = self._trace_session_id
        return forked


__all__ = ["WorkflowTool"]
