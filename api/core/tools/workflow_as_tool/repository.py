from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Protocol

from graphon.variables import VariableBase


@dataclass(frozen=True, slots=True)
class WorkflowToolSource:
    """Database-independent definition of a pinned Workflow Tool source."""

    app_id: str
    workflow_id: str
    graph_config: Mapping[str, Any]
    features_dict: Mapping[str, Any]
    environment_variables: Sequence[VariableBase]
    workflow_kind: str


class WorkflowToolSourceRepository(Protocol):
    def get_source(
        self,
        *,
        tenant_id: str,
        app_id: str,
        workflow_id: str,
        version: str,
    ) -> WorkflowToolSource | None: ...
