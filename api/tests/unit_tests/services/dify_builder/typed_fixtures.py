"""Validated mutable payloads and normally constructed native fixtures."""

from typing import NotRequired

from core.workflow.generator.types import GraphDict, GraphEdgeDict, GraphNodeDict
from core.workflow.node_runtime import DifyToolFileManager, DifyToolNodeRuntime
from graphon.nodes.tool.entities import ToolNodeData
from graphon.nodes.tool.tool_node import ToolNode
from graphon.runtime import RuntimeState, VariablePool
from tests.workflow_test_utils import build_test_graph_init_params


def dictionary(value: object) -> dict[str, object]:
    """Require a string-keyed dict and retain its mutable identity."""
    assert isinstance(value, dict)
    assert all(isinstance(key, str) for key in value)
    return value


def list_value(value: object) -> list[object]:
    """Require a list and retain its mutable identity."""
    assert isinstance(value, list)
    return value


def dictionaries(value: object) -> list[dict[str, object]]:
    """Require a list of string-keyed dicts without copying the fixture."""
    assert isinstance(value, list)
    for item in value:
        dictionary(item)
    return value


def strings(value: object) -> list[str]:
    """Require string items and retain the original list."""
    assert isinstance(value, list)
    assert all(isinstance(item, str) for item in value)
    return value


class _GraphNodeWithParent(GraphNodeDict):
    parentId: NotRequired[str]


def graph_node(node_id: str, data: dict[str, object], *, parent_id: str | None = None) -> GraphNodeDict:
    """Build a complete graph node while retaining the supplied mutable data."""
    node: _GraphNodeWithParent = {
        "id": node_id,
        "type": "custom",
        "position": {"x": 0, "y": 0},
        "data": data,
    }
    if parent_id is not None:
        node["parentId"] = parent_id
    return node


def graph_payload(nodes: list[GraphNodeDict], edges: list[tuple[str, str]]) -> GraphDict:
    """Build a complete native graph payload from typed nodes and endpoint pairs."""
    graph_edges: list[GraphEdgeDict] = [
        {"id": f"{source}-{target}", "type": "custom", "source": source, "target": target} for source, target in edges
    ]
    return {"nodes": nodes, "edges": graph_edges, "viewport": {"x": 0, "y": 0, "zoom": 1}}


def native_parameter_node(data: ToolNodeData) -> ToolNode:
    """Construct a real Tool node with the runtime used by parameter-rendering tests."""
    init_params = build_test_graph_init_params(graph_config={"nodes": [], "edges": []})
    return ToolNode(
        node_id="parameter-renderer",
        data=data,
        init_params=init_params,
        runtime_state=RuntimeState(workflow_id=init_params.workflow_id, variable_pool=VariablePool(), start_at=0.0),
        tool_file_manager=DifyToolFileManager(init_params.run_context),
        runtime=DifyToolNodeRuntime(init_params.run_context),
    )
