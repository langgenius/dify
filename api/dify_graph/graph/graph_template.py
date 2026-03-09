from typing import Any

from pydantic import BaseModel, Field


class GraphTemplate(BaseModel):
    """
    Graph Template for container nodes and subgraph expansion

    According to GraphEngine V2 spec, GraphTemplate contains:
    - nodes: mapping of node definitions
    - edges: mapping of edge definitions
    - root_ids: list of root node IDs
    - output_selectors: list of output selectors for the template
    """

    nodes: dict[str, dict[str, Any]] = Field(default_factory=dict, description="node definitions mapping")
    edges: dict[str, dict[str, Any]] = Field(default_factory=dict, description="edge definitions mapping")
    root_ids: list[str] = Field(default_factory=list, description="root node IDs")
    output_selectors: list[str] = Field(default_factory=list, description="output selectors")
