"""Workflow-run service tests with real SQLite-bound session factories."""

from collections.abc import Iterator
from decimal import Decimal
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import MagicMock

import pytest
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session, sessionmaker

from models import Account, App, EndUser, Message, WorkflowRunTriggeredFrom
from models.enums import ConversationFromSource
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


@pytest.fixture
def sqlalchemy_session_factory(sqlite_engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=sqlite_engine, expire_on_commit=False)


@pytest.fixture
def message_session(sqlite_engine: Engine) -> Iterator[Session]:
    Message.metadata.create_all(sqlite_engine, tables=[Message.metadata.tables[Message.__tablename__]])
    with Session(sqlite_engine, expire_on_commit=False) as session:
        yield session


def _app_model(**kwargs: Any) -> App:
    return cast(App, SimpleNamespace(**kwargs))


def _account(**kwargs: Any) -> Account:
    return cast(Account, SimpleNamespace(**kwargs))


def _end_user(**kwargs: Any) -> EndUser:
    return cast(EndUser, SimpleNamespace(**kwargs))


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
        sqlalchemy_session_factory: sessionmaker[Session],
    ) -> None:
        node_repo, workflow_run_repo, factory = repository_factory_mocks

        service = WorkflowRunService(session_factory=sqlalchemy_session_factory)

        assert service._session_factory is sqlalchemy_session_factory
        assert service._node_execution_service_repo is node_repo
        assert service._workflow_run_repo is workflow_run_repo
        factory.create_api_workflow_node_execution_repository.assert_called_once_with(sqlalchemy_session_factory)
        factory.create_api_workflow_run_repository.assert_called_once_with(sqlalchemy_session_factory)


class TestWorkflowRunServiceQueries:
    def test_get_paginate_workflow_runs_should_forward_filters_and_parse_limit(
        self,
        repository_factory_mocks: tuple[MagicMock, MagicMock, Any],
        sqlalchemy_session_factory: sessionmaker[Session],
    ) -> None:
        _, workflow_run_repo, _ = repository_factory_mocks
        service = WorkflowRunService(session_factory=sqlalchemy_session_factory)
        app_model = _app_model(tenant_id="tenant-1", id="app-1")
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

    def test_get_paginate_advanced_chat_workflow_runs_should_attach_message_fields_when_message_exists(
        self,
        repository_factory_mocks: tuple[MagicMock, MagicMock, Any],
        monkeypatch: pytest.MonkeyPatch,
        sqlalchemy_session_factory: sessionmaker[Session],
        message_session: Session,
    ) -> None:
        service = WorkflowRunService(session_factory=sqlalchemy_session_factory)
        app_model = _app_model(tenant_id="tenant-1", id="app-1")
        run_with_message = SimpleNamespace(id="run-1", status="running")
        run_without_message = SimpleNamespace(id="run-2", status="succeeded")
        pagination = SimpleNamespace(data=[run_with_message, run_without_message])
        monkeypatch.setattr(service, "get_paginate_workflow_runs", MagicMock(return_value=pagination))

        message_session.add(_message(message_id="msg-1", conversation_id="conv-1", workflow_run_id="run-1"))
        message_session.commit()

        result = service.get_paginate_advanced_chat_workflow_runs(app_model=app_model, args={"limit": "2"})

        assert result is pagination
        assert len(result.data) == 2
        assert result.data[0].message_id == "msg-1"
        assert result.data[0].conversation_id == "conv-1"
        assert result.data[0].status == "running"
        assert not hasattr(result.data[1], "message_id")
        assert result.data[1].id == "run-2"

    def test_get_paginate_advanced_chat_workflow_runs_batch_loads_messages_without_n_plus_one(
        self,
        repository_factory_mocks: tuple[MagicMock, MagicMock, Any],
        monkeypatch: pytest.MonkeyPatch,
        sqlalchemy_session_factory: sessionmaker[Session],
        message_session: Session,
    ) -> None:
        """Messages must load with a constant query count regardless of run count.

        Previously the deprecated WorkflowRun.message property issued one query per
        run (N+1); they are now batch-loaded in a single query.
        """
        service = WorkflowRunService(session_factory=sqlalchemy_session_factory)
        app_model = _app_model(tenant_id="tenant-1", id="app-1")
        runs = [SimpleNamespace(id=f"run-{i}", status="succeeded") for i in range(5)]
        pagination = SimpleNamespace(data=runs)
        monkeypatch.setattr(service, "get_paginate_workflow_runs", MagicMock(return_value=pagination))

        message_query_count = 0

        def count_message_query(*_args: object) -> None:
            nonlocal message_query_count
            message_query_count += 1

        engine = message_session.get_bind()
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
        sqlalchemy_session_factory: sessionmaker[Session],
    ) -> None:
        _, workflow_run_repo, _ = repository_factory_mocks
        service = WorkflowRunService(session_factory=sqlalchemy_session_factory)
        app_model = _app_model(tenant_id="tenant-1", id="app-1")
        expected = MagicMock(name="workflow_run")
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
        sqlalchemy_session_factory: sessionmaker[Session],
    ) -> None:
        _, workflow_run_repo, _ = repository_factory_mocks
        service = WorkflowRunService(session_factory=sqlalchemy_session_factory)
        app_model = _app_model(tenant_id="tenant-1", id="app-1")
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
        sqlalchemy_session_factory: sessionmaker[Session],
    ) -> None:
        service = WorkflowRunService(session_factory=sqlalchemy_session_factory)
        monkeypatch.setattr(service, "get_workflow_run", MagicMock(return_value=None))
        app_model = _app_model(id="app-1")
        user = _account(current_tenant_id="tenant-1")

        result = service.get_workflow_run_node_executions(app_model=app_model, run_id="run-1", user=user)

        assert result == []

    def test_get_workflow_run_node_executions_should_use_end_user_tenant_id(
        self,
        repository_factory_mocks: tuple[MagicMock, MagicMock, Any],
        monkeypatch: pytest.MonkeyPatch,
        sqlalchemy_session_factory: sessionmaker[Session],
    ) -> None:
        node_repo, _, _ = repository_factory_mocks
        service = WorkflowRunService(session_factory=sqlalchemy_session_factory)
        monkeypatch.setattr(service, "get_workflow_run", MagicMock(return_value=SimpleNamespace(id="run-1")))

        class FakeEndUser:
            def __init__(self, tenant_id: str) -> None:
                self.tenant_id = tenant_id

        monkeypatch.setattr(service_module, "EndUser", FakeEndUser)
        user = cast(EndUser, FakeEndUser(tenant_id="tenant-end-user"))
        app_model = _app_model(id="app-1")
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
        sqlalchemy_session_factory: sessionmaker[Session],
    ) -> None:
        node_repo, _, _ = repository_factory_mocks
        service = WorkflowRunService(session_factory=sqlalchemy_session_factory)
        monkeypatch.setattr(service, "get_workflow_run", MagicMock(return_value=SimpleNamespace(id="run-1")))
        app_model = _app_model(id="app-1")
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
        sqlalchemy_session_factory: sessionmaker[Session],
    ) -> None:
        service = WorkflowRunService(session_factory=sqlalchemy_session_factory)
        monkeypatch.setattr(service, "get_workflow_run", MagicMock(return_value=SimpleNamespace(id="run-1")))
        app_model = _app_model(id="app-1")
        user = _account(current_tenant_id=None)

        with pytest.raises(ValueError, match="tenant_id cannot be None"):
            service.get_workflow_run_node_executions(app_model=app_model, run_id="run-1", user=user)
