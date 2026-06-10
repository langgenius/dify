from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import MagicMock

import pytest
from sqlalchemy import Engine

from models import Account, App, EndUser, WorkflowRunTriggeredFrom
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


def _app_model(**kwargs: Any) -> App:
    return cast(App, SimpleNamespace(**kwargs))


def _account(**kwargs: Any) -> Account:
    return cast(Account, SimpleNamespace(**kwargs))


def _end_user(**kwargs: Any) -> EndUser:
    return cast(EndUser, SimpleNamespace(**kwargs))


class TestWorkflowRunServiceInitialization:
    def test___init___should_create_sessionmaker_from_db_engine_when_session_factory_missing(
        self,
        monkeypatch: pytest.MonkeyPatch,
        repository_factory_mocks: tuple[MagicMock, MagicMock, Any],
    ) -> None:
        session_factory = MagicMock(name="session_factory")
        sessionmaker_mock = MagicMock(return_value=session_factory)
        monkeypatch.setattr(service_module, "sessionmaker", sessionmaker_mock)
        monkeypatch.setattr(service_module, "db", SimpleNamespace(engine="db-engine"))

        service = WorkflowRunService()

        sessionmaker_mock.assert_called_once_with(bind="db-engine", expire_on_commit=False)
        assert service._session_factory is session_factory

    def test___init___should_create_sessionmaker_when_engine_is_provided(
        self,
        monkeypatch: pytest.MonkeyPatch,
        repository_factory_mocks: tuple[MagicMock, MagicMock, Any],
    ) -> None:
        class FakeEngine:
            pass

        session_factory = MagicMock(name="session_factory")
        sessionmaker_mock = MagicMock(return_value=session_factory)
        monkeypatch.setattr(service_module, "Engine", FakeEngine)
        monkeypatch.setattr(service_module, "sessionmaker", sessionmaker_mock)
        engine = cast(Engine, FakeEngine())

        service = WorkflowRunService(session_factory=engine)

        sessionmaker_mock.assert_called_once_with(bind=engine, expire_on_commit=False)
        assert service._session_factory is session_factory

    def test___init___should_keep_provided_sessionmaker_and_create_repositories(
        self,
        repository_factory_mocks: tuple[MagicMock, MagicMock, Any],
    ) -> None:
        node_repo, workflow_run_repo, factory = repository_factory_mocks
        session_factory = MagicMock(name="session_factory")

        service = WorkflowRunService(session_factory=session_factory)

        assert service._session_factory is session_factory
        assert service._node_execution_service_repo is node_repo
        assert service._workflow_run_repo is workflow_run_repo
        factory.create_api_workflow_node_execution_repository.assert_called_once_with(session_factory)
        factory.create_api_workflow_run_repository.assert_called_once_with(session_factory)


class TestWorkflowRunServiceQueries:
    def test_get_paginate_workflow_runs_should_forward_filters_and_parse_limit(
        self,
        repository_factory_mocks: tuple[MagicMock, MagicMock, Any],
    ) -> None:
        _, workflow_run_repo, _ = repository_factory_mocks
        service = WorkflowRunService(session_factory=MagicMock(name="session_factory"))
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
    ) -> None:
        service = WorkflowRunService(session_factory=MagicMock(name="session_factory"))
        app_model = _app_model(tenant_id="tenant-1", id="app-1")
        run_with_message = SimpleNamespace(
            id="run-1",
            status="running",
            message=SimpleNamespace(id="msg-1", conversation_id="conv-1"),
        )
        run_without_message = SimpleNamespace(id="run-2", status="succeeded", message=None)
        pagination = SimpleNamespace(data=[run_with_message, run_without_message])
        monkeypatch.setattr(service, "get_paginate_workflow_runs", MagicMock(return_value=pagination))

        result = service.get_paginate_advanced_chat_workflow_runs(app_model=app_model, args={"limit": "2"})

        assert result is pagination
        assert len(result.data) == 2
        assert result.data[0].message_id == "msg-1"
        assert result.data[0].conversation_id == "conv-1"
        assert result.data[0].status == "running"
        assert not hasattr(result.data[1], "message_id")
        assert result.data[1].id == "run-2"

    def test_get_workflow_run_should_delegate_to_repository_by_tenant_and_app(
        self,
        repository_factory_mocks: tuple[MagicMock, MagicMock, Any],
    ) -> None:
        _, workflow_run_repo, _ = repository_factory_mocks
        service = WorkflowRunService(session_factory=MagicMock(name="session_factory"))
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
    ) -> None:
        _, workflow_run_repo, _ = repository_factory_mocks
        service = WorkflowRunService(session_factory=MagicMock(name="session_factory"))
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
    ) -> None:
        service = WorkflowRunService(session_factory=MagicMock(name="session_factory"))
        monkeypatch.setattr(service, "get_workflow_run", MagicMock(return_value=None))
        app_model = _app_model(id="app-1")
        user = _account(current_tenant_id="tenant-1")

        result = service.get_workflow_run_node_executions(app_model=app_model, run_id="run-1", user=user)

        assert result == []

    def test_get_workflow_run_node_executions_should_use_end_user_tenant_id(
        self,
        repository_factory_mocks: tuple[MagicMock, MagicMock, Any],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        node_repo, _, _ = repository_factory_mocks
        service = WorkflowRunService(session_factory=MagicMock(name="session_factory"))
        monkeypatch.setattr(service, "get_workflow_run", MagicMock(return_value=SimpleNamespace(id="run-1")))

        class FakeEndUser:
            def __init__(self, tenant_id: str) -> None:
                self.tenant_id = tenant_id

        monkeypatch.setattr(service_module, "EndUser", FakeEndUser)
        user = cast(EndUser, FakeEndUser(tenant_id="tenant-end-user"))
        app_model = _app_model(id="app-1")
        expected = [SimpleNamespace(id="exec-1")]
        node_repo.get_executions_by_workflow_run.return_value = expected

        result = service.get_workflow_run_node_executions(app_model=app_model, run_id="run-1", user=user)

        assert result == expected
        node_repo.get_executions_by_workflow_run.assert_called_once_with(
            tenant_id="tenant-end-user",
            app_id="app-1",
            workflow_run_id="run-1",
        )

    def test_get_workflow_run_node_executions_should_use_account_current_tenant_id(
        self,
        repository_factory_mocks: tuple[MagicMock, MagicMock, Any],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        node_repo, _, _ = repository_factory_mocks
        service = WorkflowRunService(session_factory=MagicMock(name="session_factory"))
        monkeypatch.setattr(service, "get_workflow_run", MagicMock(return_value=SimpleNamespace(id="run-1")))
        app_model = _app_model(id="app-1")
        user = _account(current_tenant_id="tenant-account")
        expected = [SimpleNamespace(id="exec-1"), SimpleNamespace(id="exec-2")]
        node_repo.get_executions_by_workflow_run.return_value = expected

        result = service.get_workflow_run_node_executions(app_model=app_model, run_id="run-1", user=user)

        assert result == expected
        node_repo.get_executions_by_workflow_run.assert_called_once_with(
            tenant_id="tenant-account",
            app_id="app-1",
            workflow_run_id="run-1",
        )

    def test_get_workflow_run_node_executions_should_raise_when_resolved_tenant_id_is_none(
        self,
        repository_factory_mocks: tuple[MagicMock, MagicMock, Any],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        service = WorkflowRunService(session_factory=MagicMock(name="session_factory"))
        monkeypatch.setattr(service, "get_workflow_run", MagicMock(return_value=SimpleNamespace(id="run-1")))
        app_model = _app_model(id="app-1")
        user = _account(current_tenant_id=None)

        with pytest.raises(ValueError, match="tenant_id cannot be None"):
            service.get_workflow_run_node_executions(app_model=app_model, run_id="run-1", user=user)
