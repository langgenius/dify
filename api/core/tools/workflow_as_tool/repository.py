from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from core.tools.__base.tool import Tool
from enums import WorkflowKind
from graphon.variables import VariableBase


@dataclass(frozen=True, slots=True)
class WorkflowToolSource:
    """Database-independent definition of a pinned Workflow Tool source."""

    app_id: str
    workflow_id: str
    graph_config: Mapping[str, Any]
    features_dict: Mapping[str, Any]
    environment_variables: Sequence[VariableBase]
    workflow_kind: WorkflowKind
    tool: Tool | None = None
