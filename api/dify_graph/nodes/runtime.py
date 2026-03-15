from __future__ import annotations

from collections.abc import Generator, Mapping, Sequence
from typing import TYPE_CHECKING, Any, Protocol

from dify_graph.model_runtime.entities.llm_entities import LLMUsage
from dify_graph.nodes.tool_runtime_entities import (
    ToolRuntimeHandle,
    ToolRuntimeMessage,
    ToolRuntimeParameter,
)

if TYPE_CHECKING:
    from dify_graph.nodes.human_input.entities import DeliveryChannelConfig
    from dify_graph.nodes.tool.entities import ToolNodeData
    from dify_graph.runtime import VariablePool


class ToolNodeRuntimeProtocol(Protocol):
    """Workflow-layer adapter owned by `core.workflow` and consumed by `dify_graph`.

    The graph package depends only on these DTOs and lets the workflow layer
    translate between graph-owned abstractions and `core.tools` internals.
    """

    def get_runtime(
        self,
        *,
        node_id: str,
        node_data: ToolNodeData,
        variable_pool: VariablePool | None,
    ) -> ToolRuntimeHandle: ...

    def get_runtime_parameters(
        self,
        *,
        tool_runtime: ToolRuntimeHandle,
    ) -> Sequence[ToolRuntimeParameter]: ...

    def invoke(
        self,
        *,
        tool_runtime: ToolRuntimeHandle,
        tool_parameters: Mapping[str, Any],
        workflow_call_depth: int,
        conversation_id: str | None,
        provider_name: str,
    ) -> Generator[ToolRuntimeMessage, None, None]: ...

    def get_usage(
        self,
        *,
        tool_runtime: ToolRuntimeHandle,
    ) -> LLMUsage: ...

    def build_file_reference(self, *, mapping: Mapping[str, Any]) -> Any: ...

    def resolve_provider_icons(
        self,
        *,
        provider_name: str,
        default_icon: str | None = None,
    ) -> tuple[str | None, str | None]: ...


class HumanInputNodeRuntimeProtocol(Protocol):
    def invoke_source(self) -> str: ...

    def apply_delivery_runtime(
        self,
        *,
        methods: Sequence[DeliveryChannelConfig],
    ) -> Sequence[DeliveryChannelConfig]: ...

    def console_actor_id(self) -> str | None: ...
