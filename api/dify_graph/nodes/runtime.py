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
    from dify_graph.nodes.human_input.entities import HumanInputNodeData
    from dify_graph.nodes.human_input.enums import HumanInputFormStatus
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
    ) -> tuple[str | Mapping[str, str] | None, str | Mapping[str, str] | None]: ...


class HumanInputNodeRuntimeProtocol(Protocol):
    """Workflow-layer adapter for human-input runtime persistence and delivery."""

    def get_form(
        self,
        *,
        node_id: str,
    ) -> HumanInputFormStateProtocol | None: ...

    def create_form(
        self,
        *,
        node_id: str,
        node_data: HumanInputNodeData,
        rendered_content: str,
        resolved_default_values: Mapping[str, Any],
    ) -> HumanInputFormStateProtocol: ...


class HumanInputFormStateProtocol(Protocol):
    @property
    def id(self) -> str: ...

    @property
    def rendered_content(self) -> str: ...

    @property
    def selected_action_id(self) -> str | None: ...

    @property
    def submitted_data(self) -> Mapping[str, Any] | None: ...

    @property
    def submitted(self) -> bool: ...

    @property
    def status(self) -> HumanInputFormStatus: ...

    @property
    def expiration_time(self): ...
