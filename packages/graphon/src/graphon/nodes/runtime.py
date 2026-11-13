from __future__ import annotations

from abc import abstractmethod
from collections.abc import Generator, Mapping, Sequence
from typing import TYPE_CHECKING, Any, Protocol

from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.nodes.tool_runtime_entities import (
    ToolRuntimeHandle,
    ToolRuntimeMessage,
    ToolRuntimeParameter,
)

if TYPE_CHECKING:
    from graphon.nodes.tool.entities import ToolNodeData
    from graphon.runtime.variable_pool import VariablePool


class ToolNodeRuntimeProtocol(Protocol):
    """Workflow-layer adapter owned by `core.workflow` and consumed by `graphon`.

    The graph package depends only on these DTOs and lets the workflow layer
    translate between graph-owned abstractions and `core.tools` internals.
    """

    @abstractmethod
    def get_runtime(
        self,
        *,
        node_id: str,
        node_data: ToolNodeData,
        variable_pool: VariablePool | None,
        node_execution_id: str | None = None,
    ) -> ToolRuntimeHandle: ...

    @abstractmethod
    def get_runtime_parameters(
        self,
        *,
        tool_runtime: ToolRuntimeHandle,
    ) -> Sequence[ToolRuntimeParameter]: ...

    @abstractmethod
    def invoke(
        self,
        *,
        tool_runtime: ToolRuntimeHandle,
        tool_parameters: Mapping[str, Any],
        workflow_call_depth: int,
        provider_name: str,
    ) -> Generator[ToolRuntimeMessage, None, None]: ...

    @abstractmethod
    def get_usage(
        self,
        *,
        tool_runtime: ToolRuntimeHandle,
    ) -> LLMUsage: ...

    @abstractmethod
    def build_file_reference(self, *, mapping: Mapping[str, Any]) -> Any: ...
