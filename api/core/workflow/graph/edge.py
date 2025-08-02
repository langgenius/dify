import uuid
from dataclasses import dataclass, field


@dataclass
class Edge:
    """Edge connecting two nodes in a workflow graph."""

    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    tail: str = ""  # tail node id (source)
    head: str = ""  # head node id (target)
