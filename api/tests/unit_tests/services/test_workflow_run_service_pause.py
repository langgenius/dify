"""Tests for the session lifecycle owned by ``WorkflowRunService``."""

from unittest.mock import create_autospec, patch

import pytest
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session, sessionmaker

from repositories.api_workflow_run_repository import APIWorkflowRunRepository
from services.workflow_run_service import WorkflowRunService


@pytest.fixture
def sqlite_session_factory(sqlite_engine: Engine) -> sessionmaker[Session]:
    """Return a real factory whose sessions are bound to the isolated SQLite engine."""
    return sessionmaker(bind=sqlite_engine, expire_on_commit=False)


@pytest.fixture
def workflow_run_repository():
    """Keep the repository boundary mocked while exercising real session construction."""
    return create_autospec(APIWorkflowRunRepository)


def test_init_with_session_factory(
    sqlite_session_factory: sessionmaker[Session], workflow_run_repository: APIWorkflowRunRepository
) -> None:
    with patch("services.workflow_run_service.DifyAPIRepositoryFactory", autospec=True) as repository_factory:
        repository_factory.create_api_workflow_run_repository.return_value = workflow_run_repository

        service = WorkflowRunService(sqlite_session_factory)

    assert service._session_factory is sqlite_session_factory
    repository_factory.create_api_workflow_run_repository.assert_called_once_with(sqlite_session_factory)
    with service._session_factory() as session:
        assert session.scalar(text("SELECT 1")) == 1


def test_init_with_engine_creates_bound_session_factory(
    sqlite_engine: Engine, workflow_run_repository: APIWorkflowRunRepository
) -> None:
    with patch("services.workflow_run_service.DifyAPIRepositoryFactory", autospec=True) as repository_factory:
        repository_factory.create_api_workflow_run_repository.return_value = workflow_run_repository

        service = WorkflowRunService(sqlite_engine)

    assert service._session_factory.kw["bind"] is sqlite_engine
    assert service._session_factory.kw["expire_on_commit"] is False
    repository_factory.create_api_workflow_run_repository.assert_called_once_with(service._session_factory)
    with service._session_factory() as session:
        assert session.scalar(text("SELECT 1")) == 1


def test_init_with_default_repository_dependencies(sqlite_session_factory: sessionmaker[Session]) -> None:
    service = WorkflowRunService(sqlite_session_factory)

    assert service._session_factory is sqlite_session_factory
