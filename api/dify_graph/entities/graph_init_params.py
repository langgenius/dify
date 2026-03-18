import sys
from collections.abc import Mapping
from typing import Any, Final, Literal

from pydantic import BaseModel, Field, field_validator, with_config

if sys.version_info >= (3, 12):
    from typing import Required, TypedDict
else:
    from typing import Required

    from typing_extensions import TypedDict

DIFY_RUN_CONTEXT_KEY: Final[Literal["_dify"]] = "_dify"


@with_config(extra="allow")
class GraphEdgeConfigDict(TypedDict, total=False):
    source: str
    target: str
    sourceHandle: str
    targetHandle: str
    id: str
    type: str
    data: Any


@with_config(extra="allow")
class GraphNodeConfigDict(TypedDict, total=False):
    id: str
    data: Any


@with_config(extra="allow")
class GraphConfigDict(TypedDict, total=False):
    nodes: list[GraphNodeConfigDict]
    edges: list[GraphEdgeConfigDict]


@with_config(extra="allow")
class RunContextDict(TypedDict, total=False):
    # Accept either dict or model instance
    _dify: Required[Any]


class GraphInitParams(BaseModel):
    """GraphInitParams encapsulates the configurations and contextual information
    that remain constant throughout a single execution of the graph engine.

    A single execution is defined as follows: as long as the execution has not reached
    its conclusion, it is considered one execution. For instance, if a workflow is suspended
    and later resumed, it is still regarded as a single execution, not two.

    For the state diagram of workflow execution, refer to `WorkflowExecutionStatus`.
    """

    # init params
    workflow_id: str = Field(..., description="workflow id")
    graph_config: GraphConfigDict = Field(..., description="graph config")
    run_context: RunContextDict = Field(..., description="runtime context")
    call_depth: int = Field(..., description="call depth")

    @field_validator("graph_config", mode="before")
    @classmethod
    def _validate_graph_config(cls, value: Any) -> Any:
        # Coerce generic mappings (e.g., MappingProxyType) to a plain dict and
        # let the field's TypedDict schema perform validation once.
        if isinstance(value, Mapping) and not isinstance(value, dict):
            return dict(value)
        return value

    @field_validator("run_context", mode="before")
    @classmethod
    def _validate_run_context(cls, value: Any) -> Any:
        # Coerce generic mappings (e.g., MappingProxyType) to a plain dict and
        # let the field's TypedDict schema perform validation once.
        if isinstance(value, Mapping) and not isinstance(value, dict):
            return dict(value)
        return value
