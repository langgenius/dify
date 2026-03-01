import uuid
from dataclasses import dataclass, field

from core.workflow.enums import NodeState


@dataclass
class Edge:
    """Edge connecting two nodes in a workflow graph."""

    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    tail: str = ""  # tail node id (source)
    head: str = ""  # head node id (target)
    source_handle: str = "source"  # source handle for conditional branching
    state: NodeState = field(default=NodeState.UNKNOWN)  # edge execution state
