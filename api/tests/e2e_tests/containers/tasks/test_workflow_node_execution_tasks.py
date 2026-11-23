"""Overlapping deliveries for one existing node execution, against PostgreSQL row locks.

The unit tests cover late deliveries one after the other and concurrent inserts on SQLite,
which has no row locks. Here two deliveries update the same row in overlapping transactions.
"""

import json
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from uuid import uuid4

import pytest

import tasks.workflow_node_execution_tasks as node_execution_tasks
from core.db.session_factory import session_factory
from graphon.entities import WorkflowNodeExecution
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionStatus
from models.enums import CreatorUserRole
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom

_WAIT = 10.0
# How long the second delivery is given to get past the first one's lock if it does not wait.
_BLOCKED_FOR = 0.5


class Writer(StrEnum):
    SINGLE = "single"
    BATCH = "batch"


def _seed_running_row(ids: dict[str, str]) -> None:
    with session_factory.get_session_maker().begin() as session:
        row = WorkflowNodeExecutionModel(
            id=ids["execution"],
            tenant_id=ids["tenant"],
            app_id=ids["app"],
            workflow_id=ids["workflow"],
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
            workflow_run_id=ids["run"],
            index=1,
            predecessor_node_id=None,
            node_execution_id="runtime-node-execution-1",
            node_id="llm-node",
            node_type=BuiltinNodeTypes.LLM,
            title="Generate answer",
            inputs=json.dumps({"question": "hello"}),
            process_data="{}",
            outputs="{}",
            status=WorkflowNodeExecutionStatus.RUNNING,
            error=None,
            elapsed_time=0,
            execution_metadata="{}",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=ids["account"],
            finished_at=None,
        )
        row.created_at = datetime(2026, 8, 12, 1)
        session.add(row)


def _delivery(ids: dict[str, str], status: WorkflowNodeExecutionStatus) -> WorkflowNodeExecution:
    created_at = datetime(2026, 8, 12, 1, tzinfo=UTC)
    finished = status == WorkflowNodeExecutionStatus.SUCCEEDED
    return WorkflowNodeExecution(
        id=ids["execution"],
        node_execution_id="runtime-node-execution-1",
        workflow_id=ids["workflow"],
        workflow_execution_id=ids["run"],
        index=1,
        predecessor_node_id=None,
        node_id="llm-node",
        node_type=BuiltinNodeTypes.LLM,
        title="Generate answer",
        inputs={"question": "hello"},
        outputs={"answer": "final"} if finished else None,
        status=status,
        elapsed_time=5 if finished else 0,
        created_at=created_at,
        finished_at=created_at + timedelta(seconds=5) if finished else None,
    )


def _send(ids: dict[str, str], status: WorkflowNodeExecutionStatus, writer: Writer) -> bool:
    data = _delivery(ids, status).model_dump()
    common = {
        "tenant_id": ids["tenant"],
        "app_id": ids["app"],
        "triggered_from": WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN.value,
        "creator_user_id": ids["account"],
        "creator_user_role": CreatorUserRole.ACCOUNT.value,
    }
    if writer == Writer.BATCH:
        return node_execution_tasks.save_workflow_node_executions_task.run(executions_data=[data], **common)
    return node_execution_tasks.save_workflow_node_execution_task.run(execution_data=data, **common)


@pytest.mark.usefixtures("flask_app_with_containers")
@pytest.mark.parametrize("live_writer", list(Writer))
@pytest.mark.parametrize(
    ("first", "second"),
    [
        (WorkflowNodeExecutionStatus.RETRY, WorkflowNodeExecutionStatus.SUCCEEDED),
        (WorkflowNodeExecutionStatus.SUCCEEDED, WorkflowNodeExecutionStatus.RETRY),
    ],
    ids=["retry-holds-row", "finish-holds-row"],
)
def test_overlapping_updates_never_move_a_finished_row_back(
    monkeypatch: pytest.MonkeyPatch,
    first: WorkflowNodeExecutionStatus,
    second: WorkflowNodeExecutionStatus,
    live_writer: Writer,
) -> None:
    """The first delivery reads the row and stops before writing; the second must wait for it.

    Without the row lock the second delivery commits while the first is stopped, and with
    ``retry-holds-row`` the first then writes RETRY over the SUCCEEDED row.
    """
    ids = {key: str(uuid4()) for key in ("execution", "tenant", "app", "workflow", "run", "account")}
    _seed_running_row(ids)

    first_has_read = threading.Event()
    release_first = threading.Event()
    update = node_execution_tasks._update_node_execution_from_domain

    def update_after_read(row: WorkflowNodeExecutionModel, execution: WorkflowNodeExecution) -> None:
        # Called after the delivery read the existing row and before it writes.
        if execution.status == first and not first_has_read.is_set():
            first_has_read.set()
            assert release_first.wait(_WAIT)
        update(row, execution)

    monkeypatch.setattr(node_execution_tasks, "_update_node_execution_from_domain", update_after_read)

    def writer_for(status: WorkflowNodeExecutionStatus) -> Writer:
        return live_writer if status == WorkflowNodeExecutionStatus.RETRY else Writer.SINGLE

    def send(status: WorkflowNodeExecutionStatus) -> bool:
        return _send(ids, status, writer_for(status))

    with ThreadPoolExecutor(max_workers=2) as pool:
        first_delivery = pool.submit(send, first)
        assert first_has_read.wait(_WAIT)
        second_delivery = pool.submit(send, second)
        try:
            with pytest.raises(TimeoutError):
                second_delivery.result(timeout=_BLOCKED_FOR)
        finally:
            release_first.set()
        assert first_delivery.result(timeout=_WAIT) is True
        assert second_delivery.result(timeout=_WAIT) is True

    with session_factory.create_session() as observer:
        stored = observer.get(WorkflowNodeExecutionModel, ids["execution"])
        assert stored is not None
        assert stored.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert stored.finished_at is not None
        assert json.loads(stored.outputs or "{}") == {"answer": "final"}
