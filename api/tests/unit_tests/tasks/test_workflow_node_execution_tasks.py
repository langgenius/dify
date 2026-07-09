from collections.abc import Mapping
from datetime import UTC, datetime
from unittest.mock import Mock, patch

import pytest

from graphon.entities.workflow_node_execution import WorkflowNodeExecution
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from models import Account, EndUser
from models.enums import CreatorUserRole
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom
from tasks.workflow_node_execution_tasks import (
    _create_node_execution_from_domain,
    _create_sqlalchemy_repository,
    _update_node_execution_metadata,
    save_workflow_node_execution_data_task,
    save_workflow_node_execution_task,
)


def _execution(
    *,
    metadata: Mapping[WorkflowNodeExecutionMetadataKey, object] | None = None,
) -> WorkflowNodeExecution:
    if metadata is None:
        metadata = {WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: 10}

    return WorkflowNodeExecution(
        id="exec-id",
        node_execution_id="node-exec-id",
        workflow_id="workflow-id",
        workflow_execution_id="run-id",
        index=1,
        node_id="node-id",
        node_type=BuiltinNodeTypes.LLM,
        title="LLM",
        inputs={"input": "value"},
        process_data={"process": "value"},
        outputs={"output": "value"},
        status=WorkflowNodeExecutionStatus.SUCCEEDED,
        metadata=metadata,
        created_at=datetime.now(UTC).replace(tzinfo=None),
        finished_at=datetime.now(UTC).replace(tzinfo=None),
    )


def test_create_node_execution_persists_metadata_without_data_payloads() -> None:
    db_model = _create_node_execution_from_domain(
        execution=_execution(),
        tenant_id="tenant-id",
        app_id="app-id",
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        creator_user_id="user-id",
        creator_user_role=CreatorUserRole.ACCOUNT,
    )

    assert db_model.inputs == "{}"
    assert db_model.process_data == "{}"
    assert db_model.outputs == "{}"
    assert db_model.execution_metadata == '{"total_tokens": 10}'


def test_create_node_execution_defaults_empty_metadata() -> None:
    db_model = _create_node_execution_from_domain(
        execution=_execution(metadata={}),
        tenant_id="tenant-id",
        app_id="app-id",
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        creator_user_id="user-id",
        creator_user_role=CreatorUserRole.ACCOUNT,
    )

    assert db_model.execution_metadata == "{}"


def test_update_node_execution_metadata_preserves_data_payloads() -> None:
    db_model = WorkflowNodeExecutionModel()
    db_model.inputs = '{"old_input": true}'
    db_model.process_data = '{"old_process": true}'
    db_model.outputs = '{"old_output": true}'

    _update_node_execution_metadata(db_model, _execution())

    assert db_model.inputs == '{"old_input": true}'
    assert db_model.process_data == '{"old_process": true}'
    assert db_model.outputs == '{"old_output": true}'
    assert db_model.status == WorkflowNodeExecutionStatus.SUCCEEDED


def test_update_node_execution_metadata_defaults_empty_metadata() -> None:
    db_model = WorkflowNodeExecutionModel()

    _update_node_execution_metadata(db_model, _execution(metadata={}))

    assert db_model.execution_metadata == "{}"


@patch("tasks.workflow_node_execution_tasks._create_sqlalchemy_repository")
def test_save_workflow_node_execution_data_task_uses_sqlalchemy_repository(mock_create_repository: Mock) -> None:
    repository = Mock()
    mock_create_repository.return_value = repository
    execution = _execution()

    result = save_workflow_node_execution_data_task.run(
        execution_data=execution.model_dump(),
        tenant_id="tenant-id",
        app_id="app-id",
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN.value,
        creator_user_id="user-id",
        creator_user_role=CreatorUserRole.ACCOUNT.value,
    )

    assert result is True
    mock_create_repository.assert_called_once_with(
        tenant_id="tenant-id",
        app_id="app-id",
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN.value,
        creator_user_id="user-id",
        creator_user_role=CreatorUserRole.ACCOUNT.value,
    )
    repository.save.assert_not_called()
    saved_data_execution = repository.save_execution_data.call_args.args[0]
    assert saved_data_execution.model_dump() == execution.model_dump()


@patch("tasks.workflow_node_execution_tasks._create_sqlalchemy_repository")
def test_save_workflow_node_execution_data_task_retries_on_failure(mock_create_repository: Mock) -> None:
    mock_create_repository.side_effect = RuntimeError("db unavailable")
    execution = _execution()

    with (
        patch.object(
            save_workflow_node_execution_data_task,
            "retry",
            side_effect=RuntimeError("retry requested"),
        ) as retry,
        pytest.raises(RuntimeError, match="retry requested"),
    ):
        save_workflow_node_execution_data_task.run(
            execution_data=execution.model_dump(),
            tenant_id="tenant-id",
            app_id="app-id",
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN.value,
            creator_user_id="user-id",
            creator_user_role=CreatorUserRole.ACCOUNT.value,
        )

    retry.assert_called_once()
    assert isinstance(retry.call_args.kwargs["exc"], RuntimeError)
    assert retry.call_args.kwargs["countdown"] == 60


@patch("tasks.workflow_node_execution_tasks.session_factory.create_session")
def test_save_workflow_node_execution_task_creates_metadata_record(mock_create_session: Mock) -> None:
    session = _TaskSession(existing_execution=None)
    mock_create_session.return_value = session

    result = save_workflow_node_execution_task.run(
        execution_data=_execution().model_dump(),
        tenant_id="tenant-id",
        app_id="app-id",
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN.value,
        creator_user_id="user-id",
        creator_user_role=CreatorUserRole.ACCOUNT.value,
    )

    assert result is True
    assert session.committed is True
    assert isinstance(session.added_execution, WorkflowNodeExecutionModel)
    assert session.added_execution.inputs == "{}"
    assert session.added_execution.process_data == "{}"
    assert session.added_execution.outputs == "{}"


@patch("tasks.workflow_node_execution_tasks.session_factory.create_session")
def test_save_workflow_node_execution_task_updates_metadata_without_payloads(mock_create_session: Mock) -> None:
    existing_execution = WorkflowNodeExecutionModel()
    existing_execution.inputs = '{"old_input": true}'
    existing_execution.process_data = '{"old_process": true}'
    existing_execution.outputs = '{"old_output": true}'
    session = _TaskSession(existing_execution=existing_execution)
    mock_create_session.return_value = session

    result = save_workflow_node_execution_task.run(
        execution_data=_execution().model_dump(),
        tenant_id="tenant-id",
        app_id="app-id",
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN.value,
        creator_user_id="user-id",
        creator_user_role=CreatorUserRole.ACCOUNT.value,
    )

    assert result is True
    assert session.committed is True
    assert session.added_execution is None
    assert existing_execution.inputs == '{"old_input": true}'
    assert existing_execution.process_data == '{"old_process": true}'
    assert existing_execution.outputs == '{"old_output": true}'
    assert existing_execution.status == WorkflowNodeExecutionStatus.SUCCEEDED


@patch("tasks.workflow_node_execution_tasks.session_factory.create_session")
def test_save_workflow_node_execution_task_ignores_stale_nonterminal_snapshot(mock_create_session: Mock) -> None:
    existing_execution = WorkflowNodeExecutionModel()
    existing_execution.status = WorkflowNodeExecutionStatus.SUCCEEDED
    existing_execution.finished_at = datetime(2026, 1, 1)
    session = _TaskSession(existing_execution=existing_execution)
    mock_create_session.return_value = session
    execution = _execution()
    execution.status = WorkflowNodeExecutionStatus.RUNNING
    execution.finished_at = None

    result = save_workflow_node_execution_task.run(
        execution_data=execution.model_dump(),
        tenant_id="tenant-id",
        app_id="app-id",
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN.value,
        creator_user_id="user-id",
        creator_user_role=CreatorUserRole.ACCOUNT.value,
    )

    assert result is True
    assert session.committed is False
    assert existing_execution.status == WorkflowNodeExecutionStatus.SUCCEEDED


def test_create_sqlalchemy_repository_builds_account_context(monkeypatch) -> None:
    account = Mock()
    session = _Session({Account: account})

    def session_maker():
        return session

    monkeypatch.setattr(
        "tasks.workflow_node_execution_tasks.session_factory.get_session_maker",
        lambda: session_maker,
    )

    with patch(
        "core.repositories.sqlalchemy_workflow_node_execution_repository.SQLAlchemyWorkflowNodeExecutionRepository"
    ) as repository_class:
        repository = _create_sqlalchemy_repository(
            tenant_id="tenant-id",
            app_id="",
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN.value,
            creator_user_id="user-id",
            creator_user_role=CreatorUserRole.ACCOUNT.value,
        )

    assert repository == repository_class.return_value
    account.set_tenant_id.assert_called_once_with("tenant-id")
    repository_class.assert_called_once_with(
        session_factory=session_maker,
        user=account,
        app_id=None,
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    )


def test_create_sqlalchemy_repository_builds_end_user_context(monkeypatch) -> None:
    end_user = Mock()
    session = _Session({EndUser: end_user})

    def session_maker():
        return session

    monkeypatch.setattr(
        "tasks.workflow_node_execution_tasks.session_factory.get_session_maker",
        lambda: session_maker,
    )

    with patch(
        "core.repositories.sqlalchemy_workflow_node_execution_repository.SQLAlchemyWorkflowNodeExecutionRepository"
    ) as repository_class:
        repository = _create_sqlalchemy_repository(
            tenant_id="tenant-id",
            app_id="app-id",
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN.value,
            creator_user_id="user-id",
            creator_user_role=CreatorUserRole.END_USER.value,
        )

    assert repository == repository_class.return_value
    repository_class.assert_called_once_with(
        session_factory=session_maker,
        user=end_user,
        app_id="app-id",
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    )


def test_create_sqlalchemy_repository_raises_for_missing_creator(monkeypatch) -> None:
    session = _Session({})

    def session_maker():
        return session

    monkeypatch.setattr(
        "tasks.workflow_node_execution_tasks.session_factory.get_session_maker",
        lambda: session_maker,
    )

    with (
        patch(
            "core.repositories.sqlalchemy_workflow_node_execution_repository.SQLAlchemyWorkflowNodeExecutionRepository"
        ),
        pytest.raises(ValueError, match="Creator user missing-user not found"),
    ):
        _create_sqlalchemy_repository(
            tenant_id="tenant-id",
            app_id="app-id",
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN.value,
            creator_user_id="missing-user",
            creator_user_role=CreatorUserRole.ACCOUNT.value,
        )


class _Session:
    def __init__(self, users: dict[type, object]) -> None:
        self._users = users

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        return None

    def get(self, model, _id: str):
        return self._users.get(model)

    def scalar(self, _stmt):
        return self._users.get(EndUser)


class _TaskSession:
    def __init__(self, existing_execution: WorkflowNodeExecutionModel | None) -> None:
        self._existing_execution = existing_execution
        self.added_execution: WorkflowNodeExecutionModel | None = None
        self.committed = False

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        return None

    def scalar(self, _stmt):
        return self._existing_execution

    def add(self, execution: WorkflowNodeExecutionModel) -> None:
        self.added_execution = execution

    def commit(self) -> None:
        self.committed = True
