"""Workflow-run service tests with real SQLite-bound session factories."""

from decimal import Decimal
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session, sessionmaker

from graphon.enums import WorkflowExecutionStatus
from models import Account, App, EndUser, Message, WorkflowRun, WorkflowRunTriggeredFrom, WorkflowType
from models.account import Tenant
from models.enums import ConversationFromSource, CreatorUserRole, EndUserType
from models.model import AppMode
from services import workflow_run_service as service_module
from services.workflow_run_service import WorkflowRunService


@pytest.fixture
def repository_factory_mocks(monkeypatch: pytest.MonkeyPatch) -> tuple[MagicMock, MagicMock, Any]:
    node_repo = MagicMock()
    workflow_run_repo = MagicMock()
    factory = SimpleNamespace(
        create_api_workflow_node_execution_repository=MagicMock(return_value=node_repo),
        create_api_workflow_run_repository=MagicMock(return_value=workflow_run_repo),
    )
    monkeypatch.setattr(service_module, "DifyAPIRepositoryFactory", factory)
    return node_repo, workflow_run_repo, factory


def _app_model(*, app_id: str = "app-1", tenant_id: str = "tenant-1") -> App:
    return App(
        id=app_id,
        tenant_id=tenant_id,
        name="Workflow App",
        mode=AppMode.ADVANCED_CHAT,
        enable_site=False,
        enable_api=False,
    )


def _account(*, account_id: str = "account-1", current_tenant_id: str | None = "tenant-1") -> Account:
    account = Account(name="Workflow User", email=f"{account_id}@example.com")
    account.id = account_id
    if current_tenant_id is not None:
        tenant = Tenant(name="Workflow Tenant")
        tenant.id = current_tenant_id
        account._current_tenant = tenant
    return account


def _end_user(*, end_user_id: str = "end-user-1", tenant_id: str = "tenant-1") -> EndUser:
    return EndUser(
        id=end_user_id,
        tenant_id=tenant_id,
        type=EndUserType.SERVICE_API,
        session_id=f"session-{end_user_id}",
    )


def _workflow_run(
    *, run_id: str = "run-1", status: WorkflowExecutionStatus = WorkflowExecutionStatus.SUCCEEDED
) -> WorkflowRun:
    return WorkflowRun(
        id=run_id,
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        type=WorkflowType.CHAT,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="1",
        graph="{}",
        inputs="{}",
        status=status,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
    )


def _message(*, message_id: str, workflow_run_id: str, conversation_id: str) -> Message:
    message = Message(
        app_id="app-1",
        conversation_id=conversation_id,
        query="query",
        message={"role": "user", "content": "query"},
        answer="answer",
        message_unit_price=Decimal("0.0001"),
        answer_unit_price=Decimal("0.0001"),
        currency="USD",
        from_source=ConversationFromSource.API,
    )
    message.id = message_id
    message._inputs = {}
    message.workflow_run_id = workflow_run_id
    return message


class TestWorkflowRunServiceInitialization:
    def test___init___should_create_sessionmaker_from_db_engine_when_session_factory_missing(
        self,
        monkeypatch: pytest.MonkeyPatch,
        repository_factory_mocks: tuple[MagicMock, MagicMock, Any],
        sqlite_engine: Engine,
    ) -> None:
        monkeypatch.setattr(service_module, "db", SimpleNamespace(engine=sqlite_engine))

        service = WorkflowRunService()

        assert isinstance(service._session_factory, sessionmaker)
        assert service._session_factory.kw["bind"] is sqlite_engine
        assert service._session_factory.kw["expire_on_commit"] is False

    def test___init___should_create_sessionmaker_when_engine_is_provided(
        self,
        repository_factory_mocks: tuple[MagicMock, MagicMock, Any],
        sqlite_engine: Engine,
    ) -> None:
        service = WorkflowRunService(session_factory=sqlite_engine)

        assert isinstance(service._session_factory, sessionmaker)
        assert service._session_factory.kw["bind"] is sqlite_engine
        assert service._session_factory.kw["expire_on_commit"] is False

    def test___init___should_keep_provided_sessionmaker_and_create_repositories(
        self,
        repository_factory_mocks: tuple[MagicMock, MagicMock, Any],
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        node_repo, workflow_run_repo, factory = repository_factory_mocks

        service = WorkflowRunService(session_factory=sqlite_session_factory)

        assert service._session_factory is sqlite_session_factory
        assert service._node_execution_service_repo is node_repo
        assert service._workflow_run_repo is workflow_run_repo
        factory.create_api_workflow_node_execution_repository.assert_called_once_with(sqlite_session_factory)
        factory.create_api_workflow_run_repository.assert_called_once_with(sqlite_session_factory)


class TestWorkflowRunServiceQueries:
    def test_get_paginate_workflow_runs_should_forward_filters_and_parse_limit(
        self,
        repository_factory_mocks: tuple[MagicMock, MagicMock, Any],
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        _, workflow_run_repo, _ = repository_factory_mocks
        service = WorkflowRunService(session_factory=sqlite_session_factory)
        app_model = _app_model(tenant_id="tenant-1", app_id="app-1")
        expected = MagicMock(name="pagination")
        workflow_run_repo.get_paginated_workflow_runs.return_value = expected
        args = {"limit": "7", "last_id": "last-1", "status": "succeeded"}

        result = service.get_paginate_workflow_runs(
            app_model=app_model,
            args=args,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        )

        assert result is expected
        workflow_run_repo.get_paginated_workflow_runs.assert_called_once_with(
            tenant_id="tenant-1",
            app_id="app-1",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            limit=7,
            last_id="last-1",
            status="succeeded",
        )

    @pytest.mark.parametrize("sqlite_session", [(Message,)], indirect=True)
    def test_get_paginate_advanced_chat_workflow_runs_should_attach_message_fields_when_message_exists(
        self,
        repository_factory_mocks: tuple[MagicMock, MagicMock, Any],
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session_factory: sessionmaker[Session],
        sqlite_session: Session,
    ) -> None:
        service = WorkflowRunService(session_factory=sqlite_session_factory)
        app_model = _app_model(tenant_id="tenant-1", app_id="app-1")
        run_with_message = _workflow_run(status=WorkflowExecutionStatus.RUNNING)
        run_without_message = _workflow_run(run_id="run-2")
        pagination = SimpleNamespace(data=[run_with_message, run_without_message])
        monkeypatch.setattr(service, "get_paginate_workflow_runs", MagicMock(return_value=pagination))

        sqlite_session.add(_message(message_id="msg-1", conversation_id="conv-1", workflow_run_id="run-1"))
        sqlite_session.commit()

        result = service.get_paginate_advanced_chat_workflow_runs(app_model=app_model, args={"limit": "2"})

        assert result is pagination
        assert len(result.data) == 2
        assert result.data[0].message_id == "msg-1"
        assert result.data[0].conversation_id == "conv-1"
        assert result.data[0].status == "running"
        assert not hasattr(result.data[1], "message_id")
        assert result.data[1].id == "run-2"

    @pytest.mark.parametrize("sqlite_session", [(Message,)], indirect=True)
    def test_get_paginate_advanced_chat_workflow_runs_batch_loads_messages_without_n_plus_one(
        self,
        repository_factory_mocks: tuple[MagicMock, MagicMock, Any],
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session_factory: sessionmaker[Session],
        sqlite_session: Session,
    ) -> None:
        """Messages must load with a constant query count regardless of run count.

        Previously the deprecated WorkflowRun.message property issued one query per
        run (N+1); they are now batch-loaded in a single query.
        """
        service = WorkflowRunService(session_factory=sqlite_session_factory)
        app_model = _app_model(tenant_id="tenant-1", app_id="app-1")
        runs = [_workflow_run(run_id=f"run-{i}") for i in range(5)]
        pagination = SimpleNamespace(data=runs)
        monkeypatch.setattr(service, "get_paginate_workflow_runs", MagicMock(return_value=pagination))

        message_query_count = 0

        def count_message_query(*_args: object) -> None:
            nonlocal message_query_count
            message_query_count += 1

        engine = sqlite_session.get_bind()
        event.listen(engine, "before_cursor_execute", count_message_query)
        try:
            service.get_paginate_advanced_chat_workflow_runs(app_model=app_model, args={})
        finally:
            event.remove(engine, "before_cursor_execute", count_message_query)
        assert all(not hasattr(run, "message_id") for run in runs)
        assert message_query_count == 1

    def test_get_workflow_run_should_delegate_to_repository_by_tenant_and_app(
        self,
        repository_factory_mocks: tuple[MagicMock, MagicMock, Any],
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        _, workflow_run_repo, _ = repository_factory_mocks
        service = WorkflowRunService(session_factory=sqlite_session_factory)
        app_model = _app_model(tenant_id="tenant-1", app_id="app-1")
        expected = _workflow_run()
        workflow_run_repo.get_workflow_run_by_id.return_value = expected

        result = service.get_workflow_run(app_model=app_model, run_id="run-1")

        assert result is expected
        workflow_run_repo.get_workflow_run_by_id.assert_called_once_with(
            tenant_id="tenant-1",
            app_id="app-1",
            run_id="run-1",
        )

    def test_get_workflow_runs_count_should_forward_optional_filters(
        self,
        repository_factory_mocks: tuple[MagicMock, MagicMock, Any],
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        _, workflow_run_repo, _ = repository_factory_mocks
        service = WorkflowRunService(session_factory=sqlite_session_factory)
        app_model = _app_model(tenant_id="tenant-1", app_id="app-1")
        expected = {"total": 3, "succeeded": 2}
        workflow_run_repo.get_workflow_runs_count.return_value = expected

        result = service.get_workflow_runs_count(
            app_model=app_model,
            status="succeeded",
            time_range="7d",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        )

        assert result == expected
        workflow_run_repo.get_workflow_runs_count.assert_called_once_with(
            tenant_id="tenant-1",
            app_id="app-1",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            status="succeeded",
            time_range="7d",
        )

    def test_get_workflow_run_node_executions_should_return_empty_list_when_run_not_found(
        self,
        repository_factory_mocks: tuple[MagicMock, MagicMock, Any],
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        service = WorkflowRunService(session_factory=sqlite_session_factory)
        monkeypatch.setattr(service, "get_workflow_run", MagicMock(return_value=None))
        app_model = _app_model(app_id="app-1")
        user = _account(current_tenant_id="tenant-1")

        result = service.get_workflow_run_node_executions(app_model=app_model, run_id="run-1", user=user)

        assert result == []

    def test_get_workflow_run_node_executions_should_use_end_user_tenant_id(
        self,
        repository_factory_mocks: tuple[MagicMock, MagicMock, Any],
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        node_repo, _, _ = repository_factory_mocks
        service = WorkflowRunService(session_factory=sqlite_session_factory)
        monkeypatch.setattr(service, "get_workflow_run", MagicMock(return_value=_workflow_run()))
        user = _end_user(tenant_id="tenant-end-user")
        app_model = _app_model(app_id="app-1")
        expected_executions = [SimpleNamespace(id="exec-1")]
        expected_traces = [SimpleNamespace(id="exec-1:retry:1")]
        node_repo.get_executions_by_workflow_run.return_value = expected_executions
        mock_assemble = MagicMock(return_value=expected_traces)
        monkeypatch.setattr(service_module, "assemble_workflow_node_execution_traces", mock_assemble)

        result = service.get_workflow_run_node_executions(app_model=app_model, run_id="run-1", user=user)

        assert result == expected_traces
        node_repo.get_executions_by_workflow_run.assert_called_once_with(
            tenant_id="tenant-end-user",
            app_id="app-1",
            workflow_run_id="run-1",
        )
        mock_assemble.assert_called_once_with(expected_executions, node_repo)

    def test_get_workflow_run_node_executions_should_use_account_current_tenant_id(
        self,
        repository_factory_mocks: tuple[MagicMock, MagicMock, Any],
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        node_repo, _, _ = repository_factory_mocks
        service = WorkflowRunService(session_factory=sqlite_session_factory)
        monkeypatch.setattr(service, "get_workflow_run", MagicMock(return_value=_workflow_run()))
        app_model = _app_model(app_id="app-1")
        user = _account(current_tenant_id="tenant-account")
        expected_executions = [SimpleNamespace(id="exec-1"), SimpleNamespace(id="exec-2")]
        expected_traces = [SimpleNamespace(id="exec-1:retry:1"), SimpleNamespace(id="exec-1")]
        node_repo.get_executions_by_workflow_run.return_value = expected_executions
        mock_assemble = MagicMock(return_value=expected_traces)
        monkeypatch.setattr(service_module, "assemble_workflow_node_execution_traces", mock_assemble)

        result = service.get_workflow_run_node_executions(app_model=app_model, run_id="run-1", user=user)

        assert result == expected_traces
        node_repo.get_executions_by_workflow_run.assert_called_once_with(
            tenant_id="tenant-account",
            app_id="app-1",
            workflow_run_id="run-1",
        )
        mock_assemble.assert_called_once_with(expected_executions, node_repo)

    def test_get_workflow_run_node_executions_should_raise_when_resolved_tenant_id_is_none(
        self,
        repository_factory_mocks: tuple[MagicMock, MagicMock, Any],
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        service = WorkflowRunService(session_factory=sqlite_session_factory)
        monkeypatch.setattr(service, "get_workflow_run", MagicMock(return_value=_workflow_run()))
        app_model = _app_model(app_id="app-1")
        user = _account(current_tenant_id=None)

        with pytest.raises(ValueError, match="tenant_id cannot be None"):
            service.get_workflow_run_node_executions(app_model=app_model, run_id="run-1", user=user)
