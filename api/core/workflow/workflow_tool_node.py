from __future__ import annotations

from collections.abc import Generator, Mapping
from typing import Any, Protocol, cast, override

from graphon.enums import (
    NodeExecutionType,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)
from graphon.node_events.base import NodeEventPayload, NodeRunResult
from graphon.node_events.node import StreamChunkEvent, StreamCompletedEvent
from graphon.nodes.container_effects import (
    ContainerAwaitRequest,
    ContainerExecutionResult,
    ContainerRunResult,
    CustomContainerRequest,
)
from graphon.nodes.tool.exc import ToolNodeError
from graphon.nodes.tool.tool_node import ToolNode
from graphon.nodes.tool_runtime_entities import ToolRuntimeHandle

from .workflow_tool_container_types import WorkflowToolContainerPayload


class _WorkflowToolContainerRuntime(Protocol):
    def build_workflow_tool_container_payload(
        self,
        *,
        tool_runtime: ToolRuntimeHandle,
        tool_parameters: Mapping[str, Any],
        inputs_for_log: Mapping[str, Any],
        workflow_call_depth: int,
    ) -> WorkflowToolContainerPayload: ...


class DifyWorkflowToolNode(ToolNode):
    """Run a Workflow Tool as an Engine-managed child graph."""

    execution_type = NodeExecutionType.CONTAINER

    @classmethod
    @override
    def version(cls) -> str:
        return "1"

    @override
    # Graphon's ToolNode currently narrows this return type even though container
    # subclasses use the broader Node contract.
    def _run(  # type: ignore[override]  # pyrefly: ignore[bad-override]
        self,
    ) -> Generator[NodeEventPayload | ContainerAwaitRequest, None, None]:
        tool_info = self._tool_info()
        try:
            variable_pool = None
            if self.node_data.version != "1" or self.node_data.tool_node_version is not None:
                variable_pool = self.graph_runtime_state.variable_pool
            tool_runtime = self._get_tool_runtime(
                variable_pool=variable_pool,
                node_execution_id=self.execution_id,
            )
        except ToolNodeError as error:
            yield self._failed_result(
                error=error,
                message="Failed to get tool runtime",
                inputs={},
                tool_info=tool_info,
            )
            return

        runtime_parameters = self._runtime.get_runtime_parameters(tool_runtime=tool_runtime)
        parameters = self._generate_parameters(
            tool_parameters=runtime_parameters,
            variable_pool=self.graph_runtime_state.variable_pool,
            node_data=self.node_data,
        )
        parameters_for_log = self._generate_parameters(
            tool_parameters=runtime_parameters,
            variable_pool=self.graph_runtime_state.variable_pool,
            node_data=self.node_data,
            for_log=True,
        )
        try:
            container_runtime = cast(_WorkflowToolContainerRuntime, self._runtime)
            payload = container_runtime.build_workflow_tool_container_payload(
                tool_runtime=tool_runtime,
                tool_parameters=parameters,
                inputs_for_log=parameters_for_log,
                workflow_call_depth=self.workflow_call_depth,
            )
        except ToolNodeError as error:
            yield self._failed_result(
                error=error,
                message="Failed to prepare Workflow Tool",
                inputs=parameters_for_log,
                tool_info=tool_info,
            )
            return

        yield CustomContainerRequest(payload=payload.model_dump_json())

    @override
    def _resume_container_events(
        self,
        *,
        result: ContainerRunResult,
    ) -> Generator[NodeEventPayload | ContainerAwaitRequest, None, None]:
        if not isinstance(result, ContainerExecutionResult):
            raise TypeError(f"Unsupported Workflow Tool container result {type(result).__name__}")

        for _ in range(result.steps):
            self.graph_runtime_state.increment_node_run_steps()
        node_run_result = result.node_run_result.to_node_run_result()
        node_run_result.metadata = self._build_completion_metadata(
            tool_info=self._tool_info(),
            usage=node_run_result.llm_usage,
        )
        if node_run_result.status == WorkflowNodeExecutionStatus.SUCCEEDED:
            text_output = node_run_result.outputs.get("text")
            if isinstance(text_output, str) and text_output:
                yield StreamChunkEvent(
                    selector=[self._node_id, "text"],
                    chunk=text_output,
                    is_final=False,
                )
            yield StreamChunkEvent(
                selector=[self._node_id, "text"],
                chunk="",
                is_final=True,
            )
        yield StreamCompletedEvent(node_run_result=node_run_result)

    def _tool_info(self) -> dict[str, Any]:
        return {
            "provider_type": self.node_data.provider_type.value,
            "provider_id": self.node_data.provider_id,
            "plugin_unique_identifier": self.node_data.plugin_unique_identifier,
        }

    @staticmethod
    def _failed_result(
        *,
        error: Exception,
        message: str,
        inputs: Mapping[str, Any],
        tool_info: Mapping[str, Any],
    ) -> StreamCompletedEvent:
        return StreamCompletedEvent(
            node_run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                inputs=inputs,
                metadata={WorkflowNodeExecutionMetadataKey.TOOL_INFO: tool_info},
                error=f"{message}: {error!s}",
                error_type=type(error).__name__,
            )
        )
