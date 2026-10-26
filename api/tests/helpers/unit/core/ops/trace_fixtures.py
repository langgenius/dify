"""Validated trace records with baseline values for provider unit tests."""

from datetime import datetime

from core.ops.entities.trace_entity import MessageTraceInfo, ToolTraceInfo, WorkflowTraceInfo
from graphon.entities import WorkflowNodeExecution
from graphon.enums import BuiltinNodeTypes


def workflow_trace_info() -> WorkflowTraceInfo:
    return WorkflowTraceInfo(
        workflow_id="workflow-1",
        tenant_id="tenant-1",
        workflow_run_id="run-1",
        workflow_run_elapsed_time=1.0,
        workflow_run_status="succeeded",
        workflow_run_inputs={},
        workflow_run_outputs={},
        workflow_run_version="1",
        total_tokens=0,
        file_list=[],
        query="",
        metadata={},
    )


def message_trace_info() -> MessageTraceInfo:
    return MessageTraceInfo(
        message_id="message-1",
        conversation_model="gpt-4",
        conversation_mode="chat",
        message_tokens=0,
        answer_tokens=0,
        total_tokens=0,
        metadata={},
    )


def tool_trace_info() -> ToolTraceInfo:
    return ToolTraceInfo(
        tool_name="search",
        tool_inputs={},
        tool_outputs="",
        tool_config={},
        tool_parameters={},
        time_cost=0,
        metadata={},
    )


def workflow_node_execution() -> WorkflowNodeExecution:
    return WorkflowNodeExecution(
        id="execution-1",
        workflow_id="workflow-1",
        index=1,
        node_id="node-1",
        node_type=BuiltinNodeTypes.LLM,
        title="LLM",
        created_at=datetime(2026, 1, 1),
    )
