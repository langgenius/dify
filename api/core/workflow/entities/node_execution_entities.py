from datetime import datetime
from enum import StrEnum
from typing import Any, Optional

from pydantic import BaseModel, Field


class WorkflowNodeExecutionStatus(StrEnum):
    """
    Workflow Node Execution Status Enum
    """

    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    EXCEPTION = "exception"
    RETRY = "retry"


class WorkflowNodeExecution(BaseModel):
    """
    Core Workflow Node Execution Model

    A minimal Pydantic model for workflow node execution that doesn't contain
    fields like tenant_id, app_id, etc. that aren't needed by the pure workflow core.

    This model contains only the essential fields needed for the workflow core functionality.
    """

    id: str = Field(..., description="Execution ID")
    node_execution_id: Optional[str] = Field(None, description="Node execution ID, used for tracking execution")
    index: int = Field(..., description="Execution sequence number, used for displaying Tracing Node order")
    predecessor_node_id: Optional[str] = Field(
        None, description="Predecessor node ID, used for displaying execution path"
    )
    node_id: str = Field(..., description="Node ID")
    node_type: str = Field(..., description="Node type, such as 'start'")
    title: str = Field(..., description="Node title")

    # Data fields
    inputs: Optional[dict[str, Any]] = Field(None, description="All predecessor node variable content used in the node")
    process_data: Optional[dict[str, Any]] = Field(None, description="Node process data")
    outputs: Optional[dict[str, Any]] = Field(None, description="Node output variables")

    # Status and error information
    status: WorkflowNodeExecutionStatus = Field(WorkflowNodeExecutionStatus.RUNNING, description="Execution status")
    error: Optional[str] = Field(None, description="Error reason if status is failed")
    error_type: Optional[str] = Field(None, description="Error type if status is failed")

    # Timing and performance
    elapsed_time: float = Field(0.0, description="Time consumption (s)")
    created_at: datetime = Field(default_factory=datetime.now, description="Run time")
    finished_at: Optional[datetime] = Field(None, description="End time")

    # Metadata
    execution_metadata: Optional[dict[str, Any]] = Field(None, description="Execution metadata")

    # For iteration/loop tracking
    workflow_run_id: Optional[str] = Field(None, description="Workflow run ID")

    class Config:
        """Pydantic model configuration"""

        arbitrary_types_allowed = True
