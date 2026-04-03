"""Comprehensive unit tests for WorkflowRunService class.

This test suite covers all pause state management operations including:
- Retrieving pause state for workflow runs
- Saving pause state with file uploads
- Marking paused workflows as resumed
- Error handling and edge cases
- Database transaction management
- Repository-based approach testing
"""

from datetime import datetime
from unittest.mock import MagicMock, create_autospec, patch

import pytest
from graphon.enums import WorkflowExecutionStatus
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from models.workflow import WorkflowPause
from repositories.api_workflow_run_repository import APIWorkflowRunRepository
from repositories.sqlalchemy_api_workflow_run_repository import _PrivateWorkflowPauseEntity
from services.workflow_run_service import (
    WorkflowRunService,
)


class TestDataFactory:
    """Factory class for creating test data objects."""

    @staticmethod
    def create_workflow_run_mock(
        id: str = "workflow-run-123",
        tenant_id: str = "tenant-456",
        app_id: str = "app-789",
        workflow_id: str = "workflow-101",
        status: str | WorkflowExecutionStatus = "paused",
        **kwargs,
    ) -> MagicMock:
        """Create a mock WorkflowRun object."""
        mock_run = MagicMock()
        mock_run.id = id
        mock_run.tenant_id = tenant_id
        mock_run.app_id = app_id
        mock_run.workflow_id = workflow_id
        mock_run.status = status

        for key, value in kwargs.items():
            setattr(mock_run, key, value)

        return mock_run

    @staticmethod
    def create_workflow_pause_mock(
        id: str = "pause-123",
        tenant_id: str = "tenant-456",
        app_id: str = "app-789",
        workflow_id: str = "workflow-101",
        workflow_execution_id: str = "workflow-execution-123",
        state_file_id: str = "file-456",
        resumed_at: datetime | None = None,
        **kwargs,
    ) -> MagicMock:
        """Create a mock WorkflowPauseModel object."""
        mock_pause = MagicMock(spec=WorkflowPause)
        mock_pause.id = id
        mock_pause.tenant_id = tenant_id
        mock_pause.app_id = app_id
        mock_pause.workflow_id = workflow_id
        mock_pause.workflow_execution_id = workflow_execution_id
        mock_pause.state_file_id = state_file_id
        mock_pause.resumed_at = resumed_at

        for key, value in kwargs.items():
            setattr(mock_pause, key, value)

        return mock_pause

    @staticmethod
    def create_pause_entity_mock(
        pause_model: MagicMock | None = None,
    ) -> _PrivateWorkflowPauseEntity:
        """Create a mock _PrivateWorkflowPauseEntity object."""
        if pause_model is None:
            pause_model = TestDataFactory.create_workflow_pause_mock()

        return _PrivateWorkflowPauseEntity(pause_model=pause_model, reason_models=[], human_input_form=[])


class TestWorkflowRunService:
    """Comprehensive unit tests for WorkflowRunService class."""

    @pytest.fixture
    def mock_session_factory(self):
        """Create a mock session factory with proper session management."""
        mock_session = create_autospec(Session)

        # Create a mock context manager for the session
        mock_session_cm = MagicMock()
        mock_session_cm.__enter__ = MagicMock(return_value=mock_session)
        mock_session_cm.__exit__ = MagicMock(return_value=None)

        # Create a mock context manager for the transaction
        mock_transaction_cm = MagicMock()
        mock_transaction_cm.__enter__ = MagicMock(return_value=mock_session)
        mock_transaction_cm.__exit__ = MagicMock(return_value=None)

        mock_session.begin = MagicMock(return_value=mock_transaction_cm)

        # Create mock factory that returns the context manager
        mock_factory = MagicMock(spec=sessionmaker)
        mock_factory.return_value = mock_session_cm

        return mock_factory, mock_session

    @pytest.fixture
    def mock_workflow_run_repository(self):
        """Create a mock APIWorkflowRunRepository."""
        mock_repo = create_autospec(APIWorkflowRunRepository)
        return mock_repo

    @pytest.fixture
    def workflow_run_service(self, mock_session_factory, mock_workflow_run_repository):
        """Create WorkflowRunService instance with mocked dependencies."""
        session_factory, _ = mock_session_factory

        with patch("services.workflow_run_service.DifyAPIRepositoryFactory", autospec=True) as mock_factory:
            mock_factory.create_api_workflow_run_repository.return_value = mock_workflow_run_repository
            service = WorkflowRunService(session_factory)
            return service

    @pytest.fixture
    def workflow_run_service_with_engine(self, mock_session_factory, mock_workflow_run_repository):
        """Create WorkflowRunService instance with Engine input."""
        mock_engine = create_autospec(Engine)
        session_factory, _ = mock_session_factory

        with patch("services.workflow_run_service.DifyAPIRepositoryFactory", autospec=True) as mock_factory:
            mock_factory.create_api_workflow_run_repository.return_value = mock_workflow_run_repository
            service = WorkflowRunService(mock_engine)
            return service

    # ==================== Initialization Tests ====================

    def test_init_with_session_factory(self, mock_session_factory, mock_workflow_run_repository):
        """Test WorkflowRunService initialization with session_factory."""
        session_factory, _ = mock_session_factory

        with patch("services.workflow_run_service.DifyAPIRepositoryFactory", autospec=True) as mock_factory:
            mock_factory.create_api_workflow_run_repository.return_value = mock_workflow_run_repository
            service = WorkflowRunService(session_factory)

            assert service._session_factory == session_factory
            mock_factory.create_api_workflow_run_repository.assert_called_once_with(session_factory)

    def test_init_with_engine(self, mock_session_factory, mock_workflow_run_repository):
        """Test WorkflowRunService initialization with Engine (should convert to sessionmaker)."""
        mock_engine = create_autospec(Engine)
        session_factory, _ = mock_session_factory

        with patch("services.workflow_run_service.DifyAPIRepositoryFactory", autospec=True) as mock_factory:
            mock_factory.create_api_workflow_run_repository.return_value = mock_workflow_run_repository
            with patch(
                "services.workflow_run_service.sessionmaker", return_value=session_factory, autospec=True
            ) as mock_sessionmaker:
                service = WorkflowRunService(mock_engine)

                mock_sessionmaker.assert_called_once_with(bind=mock_engine, expire_on_commit=False)
                assert service._session_factory == session_factory
                mock_factory.create_api_workflow_run_repository.assert_called_once_with(session_factory)

    def test_init_with_default_dependencies(self, mock_session_factory):
        """Test WorkflowRunService initialization with default dependencies."""
        session_factory, _ = mock_session_factory

        service = WorkflowRunService(session_factory)

        assert service._session_factory == session_factory


# === Merged from test_workflow_run_service.py ===


from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import MagicMock

import pytest

from models import Account, App, EndUser, WorkflowRunTriggeredFrom
from services import workflow_run_service as service_module
from services.workflow_run_service import WorkflowRunService


@pytest.fixture
def repository_factory_mocks(monkeypatch: pytest.MonkeyPatch) -> tuple[MagicMock, MagicMock, Any]:
    # Arrange
    node_repo = MagicMock()
    workflow_run_repo = MagicMock()
    factory = SimpleNamespace(
        create_api_workflow_node_execution_repository=MagicMock(return_value=node_repo),
        create_api_workflow_run_repository=MagicMock(return_value=workflow_run_repo),
    )
    monkeypatch.setattr(service_module, "DifyAPIRepositoryFactory", factory)

    # Assert
    return node_repo, workflow_run_repo, factory


def _app_model(**kwargs: Any) -> App:
    return cast(App, SimpleNamespace(**kwargs))


def _account(**kwargs: Any) -> Account:
    return cast(Account, SimpleNamespace(**kwargs))


def _end_user(**kwargs: Any) -> EndUser:
    return cast(EndUser, SimpleNamespace(**kwargs))


def test___init___should_create_sessionmaker_from_db_engine_when_session_factory_missing(
    monkeypatch: pytest.MonkeyPatch,
    repository_factory_mocks: tuple[MagicMock, MagicMock, Any],
) -> None:
    # Arrange
    session_factory = MagicMock(name="session_factory")
    sessionmaker_mock = MagicMock(return_value=session_factory)
    monkeypatch.setattr(service_module, "sessionmaker", sessionmaker_mock)
    monkeypatch.setattr(service_module, "db", SimpleNamespace(engine="db-engine"))

    # Act
    service = WorkflowRunService()

    # Assert
    sessionmaker_mock.assert_called_once_with(bind="db-engine", expire_on_commit=False)
    assert service._session_factory is session_factory


def test___init___should_create_sessionmaker_when_engine_is_provided(
    monkeypatch: pytest.MonkeyPatch,
    repository_factory_mocks: tuple[MagicMock, MagicMock, Any],
) -> None:
    # Arrange
    class FakeEngine:
        pass

    session_factory = MagicMock(name="session_factory")
    sessionmaker_mock = MagicMock(return_value=session_factory)
    monkeypatch.setattr(service_module, "Engine", FakeEngine)
    monkeypatch.setattr(service_module, "sessionmaker", sessionmaker_mock)
    engine = cast(Engine, FakeEngine())

    # Act
    service = WorkflowRunService(session_factory=engine)

    # Assert
    sessionmaker_mock.assert_called_once_with(bind=engine, expire_on_commit=False)
    assert service._session_factory is session_factory


def test___init___should_keep_provided_sessionmaker_and_create_repositories(
    repository_factory_mocks: tuple[MagicMock, MagicMock, Any],
) -> None:
    # Arrange
    node_repo, workflow_run_repo, factory = repository_factory_mocks
    session_factory = MagicMock(name="session_factory")

    # Act
    service = WorkflowRunService(session_factory=session_factory)

    # Assert
    assert service._session_factory is session_factory
    assert service._node_execution_service_repo is node_repo
    assert service._workflow_run_repo is workflow_run_repo
    factory.create_api_workflow_node_execution_repository.assert_called_once_with(session_factory)
    factory.create_api_workflow_run_repository.assert_called_once_with(session_factory)


def test_get_paginate_workflow_runs_should_forward_filters_and_parse_limit(
    repository_factory_mocks: tuple[MagicMock, MagicMock, Any],
) -> None:
    # Arrange
    _, workflow_run_repo, _ = repository_factory_mocks
    service = WorkflowRunService(session_factory=MagicMock(name="session_factory"))
    app_model = _app_model(tenant_id="tenant-1", id="app-1")
    expected = MagicMock(name="pagination")
    workflow_run_repo.get_paginated_workflow_runs.return_value = expected
    args = {"limit": "7", "last_id": "last-1", "status": "succeeded"}

    # Act
    result = service.get_paginate_workflow_runs(
        app_model=app_model,
        args=args,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
    )

    # Assert
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
    repository_factory_mocks: tuple[MagicMock, MagicMock, Any],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
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

    # Act
    result = service.get_paginate_advanced_chat_workflow_runs(app_model=app_model, args={"limit": "2"})

    # Assert
    assert result is pagination
    assert len(result.data) == 2
    assert result.data[0].message_id == "msg-1"
    assert result.data[0].conversation_id == "conv-1"
    assert result.data[0].status == "running"
    assert not hasattr(result.data[1], "message_id")
    assert result.data[1].id == "run-2"


def test_get_workflow_run_should_delegate_to_repository_by_tenant_and_app(
    repository_factory_mocks: tuple[MagicMock, MagicMock, Any],
) -> None:
    # Arrange
    _, workflow_run_repo, _ = repository_factory_mocks
    service = WorkflowRunService(session_factory=MagicMock(name="session_factory"))
    app_model = _app_model(tenant_id="tenant-1", id="app-1")
    expected = MagicMock(name="workflow_run")
    workflow_run_repo.get_workflow_run_by_id.return_value = expected

    # Act
    result = service.get_workflow_run(app_model=app_model, run_id="run-1")

    # Assert
    assert result is expected
    workflow_run_repo.get_workflow_run_by_id.assert_called_once_with(
        tenant_id="tenant-1",
        app_id="app-1",
        run_id="run-1",
    )


def test_get_workflow_runs_count_should_forward_optional_filters(
    repository_factory_mocks: tuple[MagicMock, MagicMock, Any],
) -> None:
    # Arrange
    _, workflow_run_repo, _ = repository_factory_mocks
    service = WorkflowRunService(session_factory=MagicMock(name="session_factory"))
    app_model = _app_model(tenant_id="tenant-1", id="app-1")
    expected = {"total": 3, "succeeded": 2}
    workflow_run_repo.get_workflow_runs_count.return_value = expected

    # Act
    result = service.get_workflow_runs_count(
        app_model=app_model,
        status="succeeded",
        time_range="7d",
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
    )

    # Assert
    assert result == expected
    workflow_run_repo.get_workflow_runs_count.assert_called_once_with(
        tenant_id="tenant-1",
        app_id="app-1",
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        status="succeeded",
        time_range="7d",
    )


def test_get_workflow_run_node_executions_should_return_empty_list_when_run_not_found(
    repository_factory_mocks: tuple[MagicMock, MagicMock, Any],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    service = WorkflowRunService(session_factory=MagicMock(name="session_factory"))
    monkeypatch.setattr(service, "get_workflow_run", MagicMock(return_value=None))
    app_model = _app_model(id="app-1")
    user = _account(current_tenant_id="tenant-1")

    # Act
    result = service.get_workflow_run_node_executions(app_model=app_model, run_id="run-1", user=user)

    # Assert
    assert result == []


def test_get_workflow_run_node_executions_should_use_end_user_tenant_id(
    repository_factory_mocks: tuple[MagicMock, MagicMock, Any],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
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

    # Act
    result = service.get_workflow_run_node_executions(app_model=app_model, run_id="run-1", user=user)

    # Assert
    assert result == expected
    node_repo.get_executions_by_workflow_run.assert_called_once_with(
        tenant_id="tenant-end-user",
        app_id="app-1",
        workflow_run_id="run-1",
    )


def test_get_workflow_run_node_executions_should_use_account_current_tenant_id(
    repository_factory_mocks: tuple[MagicMock, MagicMock, Any],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    node_repo, _, _ = repository_factory_mocks
    service = WorkflowRunService(session_factory=MagicMock(name="session_factory"))
    monkeypatch.setattr(service, "get_workflow_run", MagicMock(return_value=SimpleNamespace(id="run-1")))
    app_model = _app_model(id="app-1")
    user = _account(current_tenant_id="tenant-account")
    expected = [SimpleNamespace(id="exec-1"), SimpleNamespace(id="exec-2")]
    node_repo.get_executions_by_workflow_run.return_value = expected

    # Act
    result = service.get_workflow_run_node_executions(app_model=app_model, run_id="run-1", user=user)

    # Assert
    assert result == expected
    node_repo.get_executions_by_workflow_run.assert_called_once_with(
        tenant_id="tenant-account",
        app_id="app-1",
        workflow_run_id="run-1",
    )


def test_get_workflow_run_node_executions_should_raise_when_resolved_tenant_id_is_none(
    repository_factory_mocks: tuple[MagicMock, MagicMock, Any],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    service = WorkflowRunService(session_factory=MagicMock(name="session_factory"))
    monkeypatch.setattr(service, "get_workflow_run", MagicMock(return_value=SimpleNamespace(id="run-1")))
    app_model = _app_model(id="app-1")
    user = _account(current_tenant_id=None)

    # Act / Assert
    with pytest.raises(ValueError, match="tenant_id cannot be None"):
        service.get_workflow_run_node_executions(app_model=app_model, run_id="run-1", user=user)
