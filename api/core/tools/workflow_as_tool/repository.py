from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from enums import WorkflowKind
from graphon.variables import VariableBase

if TYPE_CHECKING:
    from core.tools.workflow_as_tool.tool import WorkflowTool


@dataclass(frozen=True, slots=True)
class WorkflowToolSource:
    """Database-independent definition of a pinned Workflow Tool source."""

    app_id: str
    workflow_id: str
    graph_config: Mapping[str, Any]
    features_dict: Mapping[str, Any]
    environment_variables: Sequence[VariableBase]
    workflow_kind: WorkflowKind
    tool: "WorkflowTool | None" = None
