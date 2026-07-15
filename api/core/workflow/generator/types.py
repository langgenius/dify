"""
Typed payloads for workflow generation.

These TypedDicts describe the planner payload and the runtime graph assembled
from builder LLM responses after ``json_repair`` parsing. The graph types mirror
the shape consumed by ``WorkflowService.sync_draft_workflow`` so the output can
be written straight into a draft workflow.
"""

from enum import StrEnum
from typing import Literal, NotRequired, TypedDict

WorkflowGenerationMode = Literal["workflow", "advanced-chat"]

# The mode accepted at the API boundary. ``auto`` is a sentinel that asks the
# service to classify the instruction into a concrete ``WorkflowGenerationMode``
# (one tiny LLM call) BEFORE planning — see
# ``WorkflowGeneratorService._resolve_mode`` and
# ``LLMGenerator.classify_workflow_mode``.
WorkflowGenerationModeRequest = Literal["workflow", "advanced-chat", "auto"]


# Machine-readable error codes returned in ``WorkflowGenerateResultDict.errors``.
# Frontend maps these to localised copy via ``workflow.generator.errors.<code>``
# i18n keys, so any change here MUST be mirrored in the FE i18n map.
class WorkflowGenerateErrorCode(StrEnum):
    INVALID_JSON = "INVALID_JSON"
    INVALID_SCHEMA = "INVALID_SCHEMA"
    EMPTY_INSTRUCTION = "EMPTY_INSTRUCTION"
    INSTRUCTION_TOO_LONG = "INSTRUCTION_TOO_LONG"
    DUPLICATE_NODE_ID = "DUPLICATE_NODE_ID"
    GRAPH_CYCLE = "GRAPH_CYCLE"
    EMPTY_PLAN = "EMPTY_PLAN"
    UNKNOWN_NODE_REFERENCE = "UNKNOWN_NODE_REFERENCE"
    INVALID_CONTAINER = "INVALID_CONTAINER"
    UNRESOLVED_REFERENCE = "UNRESOLVED_REFERENCE"
    UNKNOWN_TOOL = "UNKNOWN_TOOL"
    MISSING_TERMINAL = "MISSING_TERMINAL"
    MISSING_START = "MISSING_START"
    DANGLING_EDGE = "DANGLING_EDGE"
    MODEL_ERROR = "MODEL_ERROR"


class WorkflowGenerateErrorDict(TypedDict):
    """One structured error from the workflow generator.

    ``code`` is the stable machine-readable identifier listed in
    ``WorkflowGenerateErrorCode``. ``detail`` is the raw human-readable
    diagnostic (English). ``node_id`` is set when the error is tied to a
    specific node so the frontend can highlight it on the preview canvas.
    """

    code: str
    detail: str
    node_id: NotRequired[str]


class PlannerNodeDict(TypedDict):
    """One node from the planner's high-level plan."""

    id: NotRequired[str]
    label: str
    node_type: str
    purpose: str
    parent: NotRequired[str]
    action: NotRequired[Literal["keep", "update", "add"]]


class PlannerEdgeDict(TypedDict):
    """Compact topology emitted by the planner for parallel node building."""

    source: str
    target: str
    source_handle: NotRequired[str]
    target_handle: NotRequired[str]


class PlannerStartInputDict(TypedDict):
    """One user-supplied input the start node will declare.

    The planner emits this list so the builder can populate
    ``start.data.variables`` and downstream ``{#start.<var>#}`` references
    resolve at run time. Optional — older prompts may omit it; the runner's
    postprocess walker still auto-fixes missing references.
    """

    variable: str
    label: str
    type: str  # "text-input" | "paragraph" | "number" | "select" | "file" | "file-list"


class PlannerResultDict(TypedDict):
    """Top-level planner response."""

    title: str
    description: str
    app_name: NotRequired[str]
    icon: NotRequired[str]
    start_inputs: NotRequired[list[PlannerStartInputDict]]
    nodes: list[PlannerNodeDict]
    edges: NotRequired[list[PlannerEdgeDict]]


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

    ``errors`` is the structured-error sibling of ``error``. ``error`` is a
    human-readable concatenation kept for backwards compat with the original
    envelope; ``errors`` carries the machine-readable codes so the frontend
    can localise the message and tie failures to specific nodes. On success
    both ``error == ""`` and ``errors == []``.
    """

    graph: GraphDict
    message: str
    app_name: str
    icon: str
    error: str
    errors: list[WorkflowGenerateErrorDict]
    # Resolved concrete generation mode ("workflow" / "advanced-chat"). Stamped
    # onto every envelope so a ``mode="auto"`` request can tell the frontend
    # which app type to create; present for explicit modes too for uniformity.
    mode: NotRequired[str]
