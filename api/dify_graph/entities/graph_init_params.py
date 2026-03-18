from collections.abc import Mapping
from typing import Any

from pydantic import BaseModel, Field

DIFY_RUN_CONTEXT_KEY = "_dify"


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
    graph_config: Mapping[str, Any] = Field(..., description="graph config")
    run_context: Mapping[str, Any] = Field(..., description="runtime context")
    call_depth: int = Field(..., description="call depth")
