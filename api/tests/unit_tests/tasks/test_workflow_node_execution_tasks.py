"""SQLite-backed tests for asynchronous workflow node-execution persistence."""

import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any, cast
from unittest.mock import MagicMock

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from graphon.entities import WorkflowNodeExecution
from graphon.entities.workflow_node_execution import WorkflowNodeExecutionMetadataKey
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionStatus
from models.enums import CreatorUserRole
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom
from tasks.workflow_node_execution_tasks import (
    _create_node_execution_from_domain,
    _update_node_execution_from_domain,
    save_workflow_node_execution_task,
)

TENANT_ID = "00000000-0000-0000-0000-000000000010"
APP_ID = "00000000-0000-0000-0000-000000000020"
WORKFLOW_ID = "00000000-0000-0000-0000-000000000030"
WORKFLOW_RUN_ID = "00000000-0000-0000-0000-000000000040"
ACCOUNT_ID = "00000000-0000-0000-0000-000000000050"
EXECUTION_ID = "00000000-0000-0000-0000-000000000060"


def _execution(
    *,
    execution_id: str = EXECUTION_ID,
    status: WorkflowNodeExecutionStatus = WorkflowNodeExecutionStatus.RUNNING,
    inputs: dict[str, object] | None = None,
    process_data: dict[str, object] | None = None,
    outputs: dict[str, object] | None = None,
    error: str | None = None,
    elapsed_time: float = 0,
    created_at: datetime | None = None,
    finished_at: datetime | None = None,
) -> WorkflowNodeExecution:
    return WorkflowNodeExecution(
        id=execution_id,
        node_execution_id="runtime-node-execution-1",
        workflow_id=WORKFLOW_ID,
        workflow_execution_id=WORKFLOW_RUN_ID,
        index=3,
        predecessor_node_id="previous-node",
        node_id="llm-node",
        node_type=BuiltinNodeTypes.LLM,
        title="Generate answer",
        inputs=inputs if inputs is not None else {"question": "hello"},
        process_data=process_data if process_data is not None else {"attempt": 1},
        outputs=outputs,
        status=status,
        error=error,
        elapsed_time=elapsed_time,
        metadata={
            WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: 12,
            WorkflowNodeExecutionMetadataKey.TOTAL_PRICE: Decimal("0.01"),
        },
        created_at=created_at or datetime(2026, 8, 12, 1, tzinfo=UTC),
        finished_at=finished_at,
    )


def _stored_execution(
    *,
    execution_id: str = EXECUTION_ID,
    tenant_id: str = TENANT_ID,
    app_id: str = APP_ID,
    process_data: dict[str, object] | None = None,
) -> WorkflowNodeExecutionModel:
    return WorkflowNodeExecutionModel(
        id=execution_id,
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id=WORKFLOW_ID,
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        workflow_run_id=WORKFLOW_RUN_ID,
        index=1,
        predecessor_node_id=None,
        node_execution_id="old-runtime-id",
        node_id="llm-node",
        node_type=BuiltinNodeTypes.LLM,
        title="Old title",
        agent_workspace_binding_id="00000000-0000-0000-0000-000000000070",
        inputs=json.dumps({"old": "input"}),
        process_data=json.dumps(process_data or {"workflow_agent_binding_id": "workflow-binding-1"}),
        outputs=json.dumps({"old": "output"}),
        status=WorkflowNodeExecutionStatus.RUNNING,
        error=None,
        elapsed_time=0,
        execution_metadata="{}",
        created_at=datetime(2026, 8, 12, 1),
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=ACCOUNT_ID,
        finished_at=None,
    )


def test_create_helper_builds_real_mapped_model_with_serialized_runtime_values() -> None:
    execution = _execution(outputs={"answer": "world"})

    model = _create_node_execution_from_domain(
        execution,
        tenant_id=TENANT_ID,
        app_id=APP_ID,
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        creator_user_id=ACCOUNT_ID,
        creator_user_role=CreatorUserRole.ACCOUNT,
    )

    assert isinstance(model, WorkflowNodeExecutionModel)
    assert model.id == EXECUTION_ID
    assert model.tenant_id == TENANT_ID
    assert model.workflow_run_id == WORKFLOW_RUN_ID
    assert model.node_type == BuiltinNodeTypes.LLM
    assert model.inputs_dict == {"question": "hello"}
    assert model.process_data_dict == {"attempt": 1}
    assert model.outputs_dict == {"answer": "world"}
    assert json.loads(model.execution_metadata or "{}") == {"total_tokens": 12, "total_price": 0.01}


def test_update_helper_preserves_binding_identity_and_immutable_ownership() -> None:
    stored = _stored_execution()
    incoming = _execution(
        status=WorkflowNodeExecutionStatus.SUCCEEDED,
        process_data={"attempt": 2},
        outputs={"answer": "updated"},
        elapsed_time=1.25,
        finished_at=datetime(2026, 8, 12, 1, 0, 2, tzinfo=UTC),
    )

    _update_node_execution_from_domain(stored, incoming)

    assert stored.tenant_id == TENANT_ID
    assert stored.app_id == APP_ID
    assert stored.workflow_id == WORKFLOW_ID
    assert stored.created_by == ACCOUNT_ID
    assert stored.node_execution_id == "old-runtime-id"
    assert stored.process_data_dict == {
        "attempt": 2,
        "workflow_agent_binding_id": "workflow-binding-1",
    }
    assert stored.outputs_dict == {"answer": "updated"}
    assert stored.status is WorkflowNodeExecutionStatus.SUCCEEDED
    assert stored.elapsed_time == 1.25


def test_task_creates_and_commits_node_execution(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    execution = _execution(outputs={"answer": "created"})

    result = save_workflow_node_execution_task.run(
        execution_data=execution.model_dump(),
        tenant_id=TENANT_ID,
        app_id=APP_ID,
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN.value,
        creator_user_id=ACCOUNT_ID,
        creator_user_role=CreatorUserRole.ACCOUNT.value,
    )

    assert result is True
    with sqlite_session_factory() as observer:
        persisted = observer.get(WorkflowNodeExecutionModel, EXECUTION_ID)
        assert persisted is not None
        assert persisted.tenant_id == TENANT_ID
        assert persisted.app_id == APP_ID
        assert persisted.outputs_dict == {"answer": "created"}
        assert persisted.created_by_role is CreatorUserRole.ACCOUNT
        assert persisted.created_by == ACCOUNT_ID


def test_task_updates_only_mutable_execution_state(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as seed_session:
        seed_session.add(_stored_execution())
    finished_at = datetime(2026, 8, 12, 1, 0, 3, tzinfo=UTC)
    execution = _execution(
        status=WorkflowNodeExecutionStatus.FAILED,
        inputs={"question": "updated"},
        process_data={"attempt": 3},
        outputs={"partial": True},
        error="provider failed",
        elapsed_time=2.5,
        created_at=datetime(2026, 8, 12, 2, tzinfo=UTC),
        finished_at=finished_at,
    )

    result = save_workflow_node_execution_task.run(
        execution_data=execution.model_dump(),
        tenant_id=TENANT_ID,
        app_id=APP_ID,
        triggered_from=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP.value,
        creator_user_id="different-account",
        creator_user_role=CreatorUserRole.END_USER.value,
    )

    assert result is True
    with sqlite_session_factory() as observer:
        persisted = observer.get(WorkflowNodeExecutionModel, EXECUTION_ID)
        assert persisted is not None
        assert persisted.triggered_from is WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN
        assert persisted.created_by_role is CreatorUserRole.ACCOUNT
        assert persisted.created_by == ACCOUNT_ID
        assert persisted.created_at == datetime(2026, 8, 12, 1)
        assert persisted.inputs_dict == {"question": "updated"}
        assert persisted.process_data_dict == {
            "attempt": 3,
            "workflow_agent_binding_id": "workflow-binding-1",
        }
        assert persisted.outputs_dict == {"partial": True}
        assert persisted.status is WorkflowNodeExecutionStatus.FAILED
        assert persisted.error == "provider failed"
        assert persisted.elapsed_time == 2.5
        assert persisted.finished_at == finished_at.replace(tzinfo=None)


def test_task_does_not_overwrite_same_id_from_another_tenant(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    other_tenant_id = "00000000-0000-0000-0000-000000000099"
    with sqlite_session_factory.begin() as seed_session:
        seed_session.add(_stored_execution(tenant_id=other_tenant_id))
    retry = MagicMock(side_effect=RuntimeError("retry requested"))
    monkeypatch.setattr(save_workflow_node_execution_task, "retry", retry)

    with pytest.raises(RuntimeError, match="retry requested"):
        save_workflow_node_execution_task.run(
            execution_data=_execution(outputs={"unsafe": True}).model_dump(),
            tenant_id=TENANT_ID,
            app_id=APP_ID,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN.value,
            creator_user_id=ACCOUNT_ID,
            creator_user_role=CreatorUserRole.ACCOUNT.value,
        )

    retry.assert_called_once()
    assert retry.call_args.kwargs["countdown"] == 60
    with sqlite_session_factory() as observer:
        persisted = observer.get(WorkflowNodeExecutionModel, EXECUTION_ID)
        assert persisted is not None
        assert persisted.tenant_id == other_tenant_id
        assert persisted.outputs_dict == {"old": "output"}


def test_task_retries_invalid_payload_without_committing(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    retry = MagicMock(side_effect=RuntimeError("retry requested"))
    monkeypatch.setattr(save_workflow_node_execution_task, "retry", retry)
    invalid_payload = _execution().model_dump()
    invalid_payload["node_id"] = None

    with pytest.raises(RuntimeError, match="retry requested"):
        save_workflow_node_execution_task.run(
            execution_data=invalid_payload,
            tenant_id=TENANT_ID,
            app_id=APP_ID,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN.value,
            creator_user_id=ACCOUNT_ID,
            creator_user_role=CreatorUserRole.ACCOUNT.value,
        )

    retry.assert_called_once()
    with sqlite_session_factory() as observer:
        assert observer.get(WorkflowNodeExecutionModel, EXECUTION_ID) is None


def test_task_uses_exponential_retry_delay_for_redelivery(monkeypatch: pytest.MonkeyPatch) -> None:
    retry = MagicMock(side_effect=RuntimeError("retry requested"))
    monkeypatch.setattr(save_workflow_node_execution_task, "retry", retry)
    task = cast(Any, save_workflow_node_execution_task)

    task.push_request(retries=2)
    try:
        with pytest.raises(RuntimeError, match="retry requested"):
            save_workflow_node_execution_task.run(
                execution_data={"id": EXECUTION_ID},
                tenant_id=TENANT_ID,
                app_id=APP_ID,
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN.value,
                creator_user_id=ACCOUNT_ID,
                creator_user_role=CreatorUserRole.ACCOUNT.value,
            )
    finally:
        task.pop_request()

    assert retry.call_args.kwargs["countdown"] == 240


def test_task_repeated_delivery_updates_one_row(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    created_at = datetime(2026, 8, 12, 1, tzinfo=UTC)
    first = _execution(created_at=created_at, outputs={"delivery": 1})
    second = _execution(
        created_at=created_at + timedelta(minutes=1),
        status=WorkflowNodeExecutionStatus.SUCCEEDED,
        outputs={"delivery": 2},
        finished_at=created_at + timedelta(seconds=5),
    )
    task_kwargs = {
        "tenant_id": TENANT_ID,
        "app_id": APP_ID,
        "triggered_from": WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN.value,
        "creator_user_id": ACCOUNT_ID,
        "creator_user_role": CreatorUserRole.ACCOUNT.value,
    }

    assert save_workflow_node_execution_task.run(execution_data=first.model_dump(), **task_kwargs)
    assert save_workflow_node_execution_task.run(execution_data=second.model_dump(), **task_kwargs)

    with sqlite_session_factory() as observer:
        assert observer.scalar(select(func.count()).select_from(WorkflowNodeExecutionModel)) == 1
        persisted = observer.get(WorkflowNodeExecutionModel, EXECUTION_ID)
        assert persisted is not None
        assert persisted.outputs_dict == {"delivery": 2}
        assert persisted.created_at == created_at.replace(tzinfo=None)
