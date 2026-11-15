from abc import abstractmethod
from collections.abc import Mapping, Sequence
from typing import ClassVar, Protocol

from graphon.enums import NodeExecutionType, NodeState, NodeType


class NodeProtocol(Protocol):
    """Node behavior consumed by runtime state and response filtering."""

    id: str
    state: NodeState
    execution_type: NodeExecutionType
    node_type: ClassVar[NodeType]

    @abstractmethod
    def blocks_variable_output(
        self,
        variable_selectors: set[tuple[str, ...]],
    ) -> bool: ...


class EdgeProtocol(Protocol):
    """Edge data consumed by runtime state and response filtering."""

    id: str
    state: NodeState
    tail: str
    head: str
    source_handle: str


class GraphProtocol(Protocol):
    """Graph behavior consumed by runtime state and response filtering."""

    @property
    @abstractmethod
    def nodes(self) -> Mapping[str, NodeProtocol]: ...

    @property
    @abstractmethod
    def edges(self) -> Mapping[str, EdgeProtocol]: ...

    @property
    @abstractmethod
    def root_node(self) -> NodeProtocol: ...

    @abstractmethod
    def get_outgoing_edges(self, node_id: str) -> Sequence[EdgeProtocol]: ...
