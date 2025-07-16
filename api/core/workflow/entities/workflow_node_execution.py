"""
Domain entities for workflow node execution.

This module contains the domain model for workflow node execution, which is used
by the core workflow module. These models are independent of the storage mechanism
and don't contain implementation details like tenant_id, app_id, etc.
"""

from collections.abc import Mapping
from datetime import datetime
from enum import StrEnum
from typing import Any, Optional

from pydantic import BaseModel, Field

from core.workflow.nodes.enums import NodeType


class WorkflowNodeExecutionMetadataKey(StrEnum):
    """
    Node Run Metadata Key.
    """

    TOTAL_TOKENS = "total_tokens"
    TOTAL_PRICE = "total_price"
    CURRENCY = "currency"
    TOOL_INFO = "tool_info"
    AGENT_LOG = "agent_log"
    ITERATION_ID = "iteration_id"
    ITERATION_INDEX = "iteration_index"
    LOOP_ID = "loop_id"
    LOOP_INDEX = "loop_index"
    PARALLEL_ID = "parallel_id"
    PARALLEL_START_NODE_ID = "parallel_start_node_id"
    PARENT_PARALLEL_ID = "parent_parallel_id"
    PARENT_PARALLEL_START_NODE_ID = "parent_parallel_start_node_id"
    PARALLEL_MODE_RUN_ID = "parallel_mode_run_id"
    ITERATION_DURATION_MAP = "iteration_duration_map"  # single iteration duration if iteration node runs
    LOOP_DURATION_MAP = "loop_duration_map"  # single loop duration if loop node runs
    ERROR_STRATEGY = "error_strategy"  # node in continue on error mode return the field
    LOOP_VARIABLE_MAP = "loop_variable_map"  # single loop variable output


class WorkflowNodeExecutionStatus(StrEnum):
    """
    Node Execution Status Enum.
    """

    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    EXCEPTION = "exception"
    RETRY = "retry"


class WorkflowNodeExecution(BaseModel):
    """
    Domain model for workflow node execution.

    This model represents the core business entity of a node execution,
    without implementation details like tenant_id, app_id, etc.

    Note: User/context-specific fields (triggered_from, created_by, created_by_role)
    have been moved to the repository implementation to keep the domain model clean.
    These fields are still accepted in the constructor for backward compatibility,
    but they are not stored in the model.
    """

    # --------- Core identification fields ---------

    # Unique identifier for this execution record, used when persisting to storage.
    # Value is a UUID string (e.g., '09b3e04c-f9ae-404c-ad82-290b8d7bd382').
    id: str

    # Optional secondary ID for cross-referencing purposes.
    #
    # NOTE: For referencing the persisted record, use `id` rather than `node_execution_id`.
    # While `node_execution_id` may sometimes be a UUID string, this is not guaranteed.
    # In most scenarios, `id` should be used as the primary identifier.
    node_execution_id: Optional[str] = None
    workflow_id: str  # ID of the workflow this node belongs to
    workflow_execution_id: Optional[str] = None  # ID of the specific workflow run (null for single-step debugging)
    # --------- Core identification fields ends ---------

    # Execution positioning and flow
    index: int  # Sequence number for ordering in trace visualization
    predecessor_node_id: Optional[str] = None  # ID of the node that executed before this one
    node_id: str  # ID of the node being executed
    node_type: NodeType  # Type of node (e.g., start, llm, knowledge)
    title: str  # Display title of the node

    # Execution data
    inputs: Optional[Mapping[str, Any]] = None  # Input variables used by this node
    process_data: Optional[Mapping[str, Any]] = None  # Intermediate processing data
    outputs: Optional[Mapping[str, Any]] = None  # Output variables produced by this node

    # Execution state
    status: WorkflowNodeExecutionStatus = WorkflowNodeExecutionStatus.RUNNING  # Current execution status
    error: Optional[str] = None  # Error message if execution failed
    elapsed_time: float = Field(default=0.0)  # Time taken for execution in seconds

    # Additional metadata
    metadata: Optional[Mapping[WorkflowNodeExecutionMetadataKey, Any]] = None  # Execution metadata (tokens, cost, etc.)

    # Timing information
    created_at: datetime  # When execution started
    finished_at: Optional[datetime] = None  # When execution completed

    def update_from_mapping(
        self,
        inputs: Optional[Mapping[str, Any]] = None,
        process_data: Optional[Mapping[str, Any]] = None,
        outputs: Optional[Mapping[str, Any]] = None,
        metadata: Optional[Mapping[WorkflowNodeExecutionMetadataKey, Any]] = None,
    ) -> None:
        """
        Update the model from mappings.

        Args:
            inputs: The inputs to update
            process_data: The process data to update
            outputs: The outputs to update
            metadata: The metadata to update
        """
        if inputs is not None:
            self.inputs = dict(inputs)
        if process_data is not None:
            self.process_data = dict(process_data)
        if outputs is not None:
            self.outputs = dict(outputs)
        if metadata is not None:
            self.metadata = dict(metadata)
