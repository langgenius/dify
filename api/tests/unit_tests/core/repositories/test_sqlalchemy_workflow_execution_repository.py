from datetime import UTC, datetime
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from graphon.entities import WorkflowExecution
from graphon.enums import WorkflowExecutionStatus, WorkflowType
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
from models import Account, CreatorUserRole, EndUser, WorkflowRun
from models.enums import WorkflowRunTriggeredFrom


@pytest.fixture
def mock_session_factory():
    """Mock SQLAlchemy session factory."""
    session_factory = MagicMock(spec=sessionmaker)
    session = MagicMock()
    session.get.return_value = None
    session_factory.return_value.__enter__.return_value = session
    return session_factory


@pytest.fixture
def mock_engine():
    """Mock SQLAlchemy Engine."""
    return MagicMock(spec=Engine)


@pytest.fixture
def mock_account():
    """Mock Account user."""
    account = MagicMock(spec=Account)
    account.id = str(uuid4())
    account.current_tenant_id = str(uuid4())
    return account


@pytest.fixture
def mock_end_user():
    """Mock EndUser."""
    user = MagicMock(spec=EndUser)
    user.id = str(uuid4())
    user.tenant_id = str(uuid4())
    return user


@pytest.fixture
def sample_workflow_execution():
    """Sample WorkflowExecution for testing."""
    return WorkflowExecution(
        id_=str(uuid4()),
        workflow_id=str(uuid4()),
        workflow_type=WorkflowType.WORKFLOW,
        workflow_version="1.0",
        graph={"nodes": [], "edges": []},
        inputs={"input1": "value1"},
        outputs={"output1": "result1"},
        status=WorkflowExecutionStatus.SUCCEEDED,
        error_message="",
        total_tokens=100,
        total_steps=5,
        exceptions_count=0,
        started_at=datetime.now(UTC),
        finished_at=datetime.now(UTC),
    )


class TestSQLAlchemyWorkflowExecutionRepository:
    def test_init_with_sessionmaker(self, mock_session_factory, mock_account):
        app_id = "test_app_id"
        triggered_from = WorkflowRunTriggeredFrom.APP_RUN

        repo = SQLAlchemyWorkflowExecutionRepository(
            session_factory=mock_session_factory, user=mock_account, app_id=app_id, triggered_from=triggered_from
        )

        assert repo._session_factory == mock_session_factory
        assert repo._tenant_id == mock_account.current_tenant_id
        assert repo._app_id == app_id
        assert repo._triggered_from == triggered_from
        assert repo._creator_user_id == mock_account.id
        assert repo._creator_user_role == CreatorUserRole.ACCOUNT

    def test_init_with_engine(self, mock_engine, mock_account):
        repo = SQLAlchemyWorkflowExecutionRepository(
            session_factory=mock_engine,
            user=mock_account,
            app_id="test_app_id",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        )

        assert isinstance(repo._session_factory, sessionmaker)
        assert repo._session_factory.kw["bind"] == mock_engine

    def test_init_invalid_session_factory(self, mock_account):
        with pytest.raises(ValueError, match="Invalid session_factory type"):
            SQLAlchemyWorkflowExecutionRepository(
                session_factory="invalid", user=mock_account, app_id=None, triggered_from=None
            )

    def test_init_no_tenant_id(self, mock_session_factory):
        user = MagicMock(spec=Account)
        user.current_tenant_id = None

        with pytest.raises(ValueError, match="User must have a tenant_id"):
            SQLAlchemyWorkflowExecutionRepository(
                session_factory=mock_session_factory, user=user, app_id=None, triggered_from=None
            )

    def test_init_with_end_user(self, mock_session_factory, mock_end_user):
        repo = SQLAlchemyWorkflowExecutionRepository(
            session_factory=mock_session_factory, user=mock_end_user, app_id=None, triggered_from=None
        )
        assert repo._tenant_id == mock_end_user.tenant_id
        assert repo._creator_user_role == CreatorUserRole.END_USER

    def test_to_domain_model(self, mock_session_factory, mock_account):
        repo = SQLAlchemyWorkflowExecutionRepository(
            session_factory=mock_session_factory, user=mock_account, app_id=None, triggered_from=None
        )

        db_model = MagicMock(spec=WorkflowRun)
        db_model.id = str(uuid4())
        db_model.workflow_id = str(uuid4())
        db_model.type = "workflow"
        db_model.version = "1.0"
        db_model.inputs_dict = {"in": "val"}
        db_model.outputs_dict = {"out": "val"}
        db_model.graph_dict = {"nodes": []}
        db_model.status = "succeeded"
        db_model.error = "some error"
        db_model.total_tokens = 50
        db_model.total_steps = 3
        db_model.exceptions_count = 1
        db_model.created_at = datetime.now(UTC)
        db_model.finished_at = datetime.now(UTC)

        domain_model = repo._to_domain_model(db_model)

        assert domain_model.id_ == db_model.id
        assert domain_model.workflow_id == db_model.workflow_id
        assert domain_model.status == WorkflowExecutionStatus.SUCCEEDED
        assert domain_model.inputs == db_model.inputs_dict
        assert domain_model.error_message == "some error"

    def test_to_db_model(self, mock_session_factory, mock_account, sample_workflow_execution):
        repo = SQLAlchemyWorkflowExecutionRepository(
            session_factory=mock_session_factory,
            user=mock_account,
            app_id="test_app",
            triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
        )

        # Make elapsed time deterministic to avoid flaky tests
        sample_workflow_execution.started_at = datetime(2023, 1, 1, 0, 0, 0, tzinfo=UTC)
        sample_workflow_execution.finished_at = datetime(2023, 1, 1, 0, 0, 10, tzinfo=UTC)

        db_model = repo._to_db_model(sample_workflow_execution)

        assert db_model.id == sample_workflow_execution.id_
        assert db_model.tenant_id == repo._tenant_id
        assert db_model.app_id == "test_app"
        assert db_model.triggered_from == WorkflowRunTriggeredFrom.DEBUGGING
        assert db_model.status == sample_workflow_execution.status.value
        assert db_model.total_tokens == sample_workflow_execution.total_tokens
        assert db_model.elapsed_time == 10.0

    def test_to_db_model_edge_cases(self, mock_session_factory, mock_account, sample_workflow_execution):
        repo = SQLAlchemyWorkflowExecutionRepository(
            session_factory=mock_session_factory,
            user=mock_account,
            app_id="test_app",
            triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
        )
        # Test with empty/None fields
        sample_workflow_execution.graph = None
        sample_workflow_execution.inputs = None
        sample_workflow_execution.outputs = None
        sample_workflow_execution.error_message = None
        sample_workflow_execution.finished_at = None

        db_model = repo._to_db_model(sample_workflow_execution)

        assert db_model.graph is None
        assert db_model.inputs is None
        assert db_model.outputs is None
        assert db_model.error is None
        assert db_model.elapsed_time == 0

    def test_to_db_model_app_id_none(self, mock_session_factory, mock_account, sample_workflow_execution):
        repo = SQLAlchemyWorkflowExecutionRepository(
            session_factory=mock_session_factory,
            user=mock_account,
            app_id=None,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        )

        db_model = repo._to_db_model(sample_workflow_execution)
        assert not hasattr(db_model, "app_id") or db_model.app_id is None
        assert db_model.tenant_id == repo._tenant_id

    def test_to_db_model_missing_context(self, mock_session_factory, mock_account, sample_workflow_execution):
        repo = SQLAlchemyWorkflowExecutionRepository(
            session_factory=mock_session_factory, user=mock_account, app_id=None, triggered_from=None
        )

        # Test triggered_from missing
        with pytest.raises(ValueError, match="triggered_from is required"):
            repo._to_db_model(sample_workflow_execution)

        repo._triggered_from = WorkflowRunTriggeredFrom.APP_RUN
        repo._creator_user_id = None
        with pytest.raises(ValueError, match="created_by is required"):
            repo._to_db_model(sample_workflow_execution)

        repo._creator_user_id = "some_id"
        repo._creator_user_role = None
        with pytest.raises(ValueError, match="created_by_role is required"):
            repo._to_db_model(sample_workflow_execution)

    def test_save(self, mock_session_factory, mock_account, sample_workflow_execution):
        repo = SQLAlchemyWorkflowExecutionRepository(
            session_factory=mock_session_factory,
            user=mock_account,
            app_id="test_app",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        )

        repo.save(sample_workflow_execution)

        session = mock_session_factory.return_value.__enter__.return_value
        session.merge.assert_called_once()
        session.commit.assert_called_once()

        # Check cache
        assert sample_workflow_execution.id_ in repo._execution_cache
        cached_model = repo._execution_cache[sample_workflow_execution.id_]
        assert cached_model.id == sample_workflow_execution.id_

    def test_save_uses_execution_started_at_when_record_does_not_exist(
        self, mock_session_factory, mock_account, sample_workflow_execution
    ):
        repo = SQLAlchemyWorkflowExecutionRepository(
            session_factory=mock_session_factory,
            user=mock_account,
            app_id="test_app",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        )

        started_at = datetime(2026, 1, 1, 12, 0, 0, tzinfo=UTC)
        sample_workflow_execution.started_at = started_at

        session = mock_session_factory.return_value.__enter__.return_value
        session.get.return_value = None

        repo.save(sample_workflow_execution)

        saved_model = session.merge.call_args.args[0]
        assert saved_model.created_at == started_at
        session.commit.assert_called_once()

    def test_save_preserves_existing_created_at_when_record_already_exists(
        self, mock_session_factory, mock_account, sample_workflow_execution
    ):
        repo = SQLAlchemyWorkflowExecutionRepository(
            session_factory=mock_session_factory,
            user=mock_account,
            app_id="test_app",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        )

        execution_id = sample_workflow_execution.id_
        existing_created_at = datetime(2026, 1, 1, 12, 0, 0, tzinfo=UTC)

        existing_run = WorkflowRun()
        existing_run.id = execution_id
        existing_run.tenant_id = repo._tenant_id
        existing_run.created_at = existing_created_at

        session = mock_session_factory.return_value.__enter__.return_value
        session.get.return_value = existing_run

        sample_workflow_execution.started_at = datetime(2026, 1, 1, 12, 30, 0, tzinfo=UTC)

        repo.save(sample_workflow_execution)

        saved_model = session.merge.call_args.args[0]
        assert saved_model.created_at == existing_created_at
        session.commit.assert_called_once()
