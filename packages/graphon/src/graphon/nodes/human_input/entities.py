"""Human Input node entities."""

from collections.abc import Callable, Mapping
from dataclasses import dataclass

from graphon.entities.base_node_data import BaseNodeData
from graphon.enums import BuiltinNodeTypes, NodeType
from graphon.runtime.runtime_state_protocol import ReadOnlyVariablePool
from graphon.variables.segments import Segment


class HumanInputNodeData(BaseNodeData):
    """Human Input node data."""

    type: NodeType = BuiltinNodeTypes.HUMAN_INPUT


@dataclass(frozen=True)
class HITLContext:
    workflow_execution_id: str
    node_id: str
    node_title: str
    variable_pool: ReadOnlyVariablePool


@dataclass(frozen=True)
class PauseRequested:
    session_id: str


@dataclass(frozen=True)
class Completed:
    selected_handle: str
    inputs: Mapping[str, Segment]
    outputs: Mapping[str, Segment]


@dataclass(frozen=True)
class Expired:
    selected_handle: str
    outputs: Mapping[str, Segment]


type HITLDecision = PauseRequested | Completed | Expired
type HITLCallback = Callable[[HITLContext], HITLDecision]
