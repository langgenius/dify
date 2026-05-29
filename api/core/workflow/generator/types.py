"""
Typed payloads for workflow generation.

These TypedDicts describe the shape that the planner and builder LLM calls are
required to return after ``json_repair`` parsing. They mirror the runtime
``graph`` shape consumed by ``WorkflowService.sync_draft_workflow`` so the output
can be written straight into a draft workflow without further translation.
"""

from typing import Literal, NotRequired, TypedDict

WorkflowGenerationMode = Literal["workflow", "advanced-chat"]


class PlannerNodeDict(TypedDict):
    """One node from the planner's high-level plan."""

    label: str
    node_type: str
    purpose: str


class PlannerResultDict(TypedDict):
    """Top-level planner response."""

    title: str
    description: str
    app_name: NotRequired[str]
    icon: NotRequired[str]
    nodes: list[PlannerNodeDict]


class GraphNodePositionDict(TypedDict):
    x: float
    y: float


class GraphNodeDict(TypedDict):
    """A workflow graph node as serialised in the draft graph JSON."""

    id: str
    type: str  # ReactFlow custom-node key, e.g. "custom"
    position: GraphNodePositionDict
    data: dict
    width: NotRequired[int]
    height: NotRequired[int]
    positionAbsolute: NotRequired[GraphNodePositionDict]
    sourcePosition: NotRequired[str]
    targetPosition: NotRequired[str]
    selected: NotRequired[bool]
    dragging: NotRequired[bool]


class GraphEdgeDict(TypedDict):
    """A workflow graph edge as serialised in the draft graph JSON."""

    id: str
    source: str
    target: str
    type: str  # always "custom" for Dify's custom-edge renderer
    sourceHandle: NotRequired[str]
    targetHandle: NotRequired[str]
    data: NotRequired[dict]


class GraphViewportDict(TypedDict):
    x: float
    y: float
    zoom: float


class GraphDict(TypedDict):
    """Full graph payload — matches ``WorkflowService.sync_draft_workflow``."""

    nodes: list[GraphNodeDict]
    edges: list[GraphEdgeDict]
    viewport: GraphViewportDict


class WorkflowGenerateResultDict(TypedDict):
    """What the runner returns. ``error`` is "" on success.

    ``app_name`` and ``icon`` are populated from the planner output when the
    LLM emits them (newer prompts) and default to empty strings when it
    doesn't. The frontend's ``applyToNewApp`` consumes them with its own
    fallback so old prompts and missing fields stay safe.
    """

    graph: GraphDict
    message: str
    app_name: str
    icon: str
    error: str
