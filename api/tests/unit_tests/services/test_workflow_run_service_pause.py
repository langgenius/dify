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
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.workflow.enums import WorkflowExecutionStatus
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
        pause_id: str | None = None,
        **kwargs,
    ) -> MagicMock:
        """Create a mock WorkflowRun object."""
        mock_run = MagicMock()
        mock_run.id = id
        mock_run.tenant_id = tenant_id
        mock_run.app_id = app_id
        mock_run.workflow_id = workflow_id
        mock_run.status = status
        mock_run.pause_id = pause_id

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
        mock_pause = MagicMock()
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
    def create_upload_file_mock(
        id: str = "file-456",
        key: str = "upload_files/test/state.json",
        name: str = "state.json",
        tenant_id: str = "tenant-456",
        **kwargs,
    ) -> MagicMock:
        """Create a mock UploadFile object."""
        mock_file = MagicMock()
        mock_file.id = id
        mock_file.key = key
        mock_file.name = name
        mock_file.tenant_id = tenant_id

        for key, value in kwargs.items():
            setattr(mock_file, key, value)

        return mock_file

    @staticmethod
    def create_pause_entity_mock(
        pause_model: MagicMock | None = None,
        upload_file: MagicMock | None = None,
    ) -> _PrivateWorkflowPauseEntity:
        """Create a mock _PrivateWorkflowPauseEntity object."""
        if pause_model is None:
            pause_model = TestDataFactory.create_workflow_pause_mock()
        if upload_file is None:
            upload_file = TestDataFactory.create_upload_file_mock()

        return _PrivateWorkflowPauseEntity.from_models(pause_model, upload_file)


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

        with patch("services.workflow_run_service.DifyAPIRepositoryFactory") as mock_factory:
            mock_factory.create_api_workflow_run_repository.return_value = mock_workflow_run_repository
            service = WorkflowRunService(session_factory)
            return service

    @pytest.fixture
    def workflow_run_service_with_engine(self, mock_session_factory, mock_workflow_run_repository):
        """Create WorkflowRunService instance with Engine input."""
        mock_engine = create_autospec(Engine)
        session_factory, _ = mock_session_factory

        with patch("services.workflow_run_service.DifyAPIRepositoryFactory") as mock_factory:
            mock_factory.create_api_workflow_run_repository.return_value = mock_workflow_run_repository
            service = WorkflowRunService(mock_engine)
            return service

    # ==================== Initialization Tests ====================

    def test_init_with_session_factory(self, mock_session_factory, mock_workflow_run_repository):
        """Test WorkflowRunService initialization with session_factory."""
        session_factory, _ = mock_session_factory

        with patch("services.workflow_run_service.DifyAPIRepositoryFactory") as mock_factory:
            mock_factory.create_api_workflow_run_repository.return_value = mock_workflow_run_repository
            service = WorkflowRunService(session_factory)

            assert service._session_factory == session_factory
            mock_factory.create_api_workflow_run_repository.assert_called_once_with(session_factory)

    def test_init_with_engine(self, mock_session_factory, mock_workflow_run_repository):
        """Test WorkflowRunService initialization with Engine (should convert to sessionmaker)."""
        mock_engine = create_autospec(Engine)
        session_factory, _ = mock_session_factory

        with patch("services.workflow_run_service.DifyAPIRepositoryFactory") as mock_factory:
            mock_factory.create_api_workflow_run_repository.return_value = mock_workflow_run_repository
            with patch("services.workflow_run_service.sessionmaker", return_value=session_factory) as mock_sessionmaker:
                service = WorkflowRunService(mock_engine)

                mock_sessionmaker.assert_called_once_with(bind=mock_engine, expire_on_commit=False)
                assert service._session_factory == session_factory
                mock_factory.create_api_workflow_run_repository.assert_called_once_with(session_factory)

    def test_init_with_default_dependencies(self, mock_session_factory):
        """Test WorkflowRunService initialization with default dependencies."""
        session_factory, _ = mock_session_factory

        service = WorkflowRunService(session_factory)

        assert service._session_factory == session_factory
