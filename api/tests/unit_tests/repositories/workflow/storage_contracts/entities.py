"""Representative domain snapshots shared by storage contract scenarios."""

from datetime import UTC, datetime, timedelta

from graphon.entities import WorkflowExecution, WorkflowNodeExecution
from graphon.enums import BuiltinNodeTypes, WorkflowExecutionStatus, WorkflowNodeExecutionStatus, WorkflowType

START = datetime.now(UTC).replace(tzinfo=None, microsecond=0) - timedelta(hours=2)


def run(id: str = "run-1", *, start: datetime = START) -> WorkflowExecution:
    return WorkflowExecution(
        id_=id,
        workflow_id="workflow-1",
        workflow_type=WorkflowType.WORKFLOW,
        workflow_version="1",
        graph={"nodes": []},
        inputs={"question": "契约"},
        outputs={"answer": [1, 2]},
        status=WorkflowExecutionStatus.SUCCEEDED,
        error_message="",
        total_tokens=17,
        total_steps=2,
        exceptions_count=3,
        started_at=start,
        finished_at=start + timedelta(seconds=5),
    )


def node(id: str = "execution-1", *, index: int = 1) -> WorkflowNodeExecution:
    return WorkflowNodeExecution(
        id=id,
        node_execution_id=f"trace-{id}",
        workflow_id="workflow-1",
        workflow_execution_id="run-1",
        index=index,
        node_id="node-1",
        node_type=BuiltinNodeTypes.LLM,
        title="Contract node",
        status=WorkflowNodeExecutionStatus.SUCCEEDED,
        inputs={"question": "契约"},
        outputs={"answer": [1, 2]},
        process_data={"steps": ["one", "two"]},
        error=None,
        elapsed_time=5,
        created_at=START + timedelta(seconds=index),
        finished_at=START + timedelta(seconds=index + 5),
    )
