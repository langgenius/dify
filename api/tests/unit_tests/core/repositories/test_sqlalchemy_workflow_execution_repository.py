import json
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
from graphon.entities import WorkflowExecution
from graphon.enums import WorkflowExecutionStatus, WorkflowType
from models import Account, CreatorUserRole, EndUser, Tenant, WorkflowRun
from models.enums import EndUserType, WorkflowRunTriggeredFrom
from models.workflow import WorkflowType as ModelWorkflowType

TABLES = (WorkflowRun,)


def _make_account(*, tenant_id: str | None = None) -> Account:
    account = Account(name="Repository User", email=f"{uuid4()}@example.com")
    account.id = str(uuid4())
    if tenant_id is not None:
        tenant = Tenant(name="Repository Tenant")
        tenant.id = tenant_id
        account._current_tenant = tenant
    return account


@pytest.fixture
def sqlite_session_factory(sqlite_engine: Engine) -> sessionmaker[Session]:
    """Create repository-owned sessions bound to the isolated SQLite engine."""
    return sessionmaker(bind=sqlite_engine, expire_on_commit=False)


@pytest.fixture
def account() -> Account:
    return _make_account(tenant_id=str(uuid4()))


@pytest.fixture
def end_user() -> EndUser:
    return EndUser(
        id=str(uuid4()),
        tenant_id=str(uuid4()),
        app_id=None,
        type=EndUserType.SERVICE_API,
        external_user_id=None,
        name="Repository End User",
        session_id=str(uuid4()),
    )


@pytest.fixture
def sample_workflow_execution() -> WorkflowExecution:
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
    def test_init_with_sessionmaker(self, sqlite_session_factory: sessionmaker[Session], account: Account):
        app_id = "test_app_id"
        triggered_from = WorkflowRunTriggeredFrom.APP_RUN

        repo = SQLAlchemyWorkflowExecutionRepository(
            session_factory=sqlite_session_factory, user=account, app_id=app_id, triggered_from=triggered_from
        )

        assert repo._session_factory is sqlite_session_factory
        assert repo._tenant_id == account.current_tenant_id
        assert repo._app_id == app_id
        assert repo._triggered_from == triggered_from
        assert repo._creator_user_id == account.id
        assert repo._creator_user_role == CreatorUserRole.ACCOUNT

    def test_init_with_engine(self, sqlite_engine: Engine, account: Account):
        repo = SQLAlchemyWorkflowExecutionRepository(
            session_factory=sqlite_engine,
            user=account,
            app_id="test_app_id",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        )

        assert isinstance(repo._session_factory, sessionmaker)
        assert repo._session_factory.kw["bind"] is sqlite_engine

    def test_init_invalid_session_factory(self, account: Account):
        with pytest.raises(ValueError, match="Invalid session_factory type"):
            SQLAlchemyWorkflowExecutionRepository(
                session_factory="invalid", user=account, app_id=None, triggered_from=None
            )

    def test_init_no_tenant_id(self, sqlite_session_factory: sessionmaker[Session]):
        user = _make_account()

        with pytest.raises(ValueError, match="User must have a tenant_id"):
            SQLAlchemyWorkflowExecutionRepository(
                session_factory=sqlite_session_factory, user=user, app_id=None, triggered_from=None
            )

    def test_init_with_end_user(self, sqlite_session_factory: sessionmaker[Session], end_user: EndUser):
        repo = SQLAlchemyWorkflowExecutionRepository(
            session_factory=sqlite_session_factory, user=end_user, app_id=None, triggered_from=None
        )
        assert repo._tenant_id == end_user.tenant_id
        assert repo._creator_user_role == CreatorUserRole.END_USER

    @pytest.mark.parametrize("sqlite_session", [TABLES], indirect=True)
    def test_to_domain_model(
        self,
        sqlite_session_factory: sessionmaker[Session],
        sqlite_session: Session,
        account: Account,
    ):
        repo = SQLAlchemyWorkflowExecutionRepository(
            session_factory=sqlite_session_factory, user=account, app_id=None, triggered_from=None
        )

        db_model = WorkflowRun(
            id=str(uuid4()),
            tenant_id=account.current_tenant_id,
            app_id=str(uuid4()),
            workflow_id=str(uuid4()),
            type=ModelWorkflowType.WORKFLOW,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            version="1.0",
            inputs=json.dumps({"in": "val"}),
            outputs=json.dumps({"out": "val"}),
            graph=json.dumps({"nodes": []}),
            status=WorkflowExecutionStatus.SUCCEEDED,
            error="some error",
            elapsed_time=1.0,
            total_tokens=50,
            total_steps=3,
            exceptions_count=1,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=account.id,
            created_at=datetime.now(UTC),
            finished_at=datetime.now(UTC),
        )
        sqlite_session.add(db_model)
        sqlite_session.commit()
        sqlite_session.expunge_all()
        persisted_model = sqlite_session.get(WorkflowRun, db_model.id)
        assert persisted_model is not None

        domain_model = repo._to_domain_model(persisted_model)

        assert domain_model.id_ == persisted_model.id
        assert domain_model.workflow_id == persisted_model.workflow_id
        assert domain_model.status == WorkflowExecutionStatus.SUCCEEDED
        assert domain_model.inputs == {"in": "val"}
        assert domain_model.error_message == "some error"

    def test_to_db_model(
        self,
        sqlite_session_factory: sessionmaker[Session],
        account: Account,
        sample_workflow_execution: WorkflowExecution,
    ):
        repo = SQLAlchemyWorkflowExecutionRepository(
            session_factory=sqlite_session_factory,
            user=account,
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

    def test_to_db_model_edge_cases(
        self,
        sqlite_session_factory: sessionmaker[Session],
        account: Account,
        sample_workflow_execution: WorkflowExecution,
    ):
        repo = SQLAlchemyWorkflowExecutionRepository(
            session_factory=sqlite_session_factory,
            user=account,
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

    def test_to_db_model_app_id_none(
        self,
        sqlite_session_factory: sessionmaker[Session],
        account: Account,
        sample_workflow_execution: WorkflowExecution,
    ):
        repo = SQLAlchemyWorkflowExecutionRepository(
            session_factory=sqlite_session_factory,
            user=account,
            app_id=None,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        )

        db_model = repo._to_db_model(sample_workflow_execution)
        assert not hasattr(db_model, "app_id") or db_model.app_id is None
        assert db_model.tenant_id == repo._tenant_id

    def test_to_db_model_missing_context(
        self,
        sqlite_session_factory: sessionmaker[Session],
        account: Account,
        sample_workflow_execution: WorkflowExecution,
    ):
        repo = SQLAlchemyWorkflowExecutionRepository(
            session_factory=sqlite_session_factory, user=account, app_id=None, triggered_from=None
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

    @pytest.mark.parametrize("sqlite_session", [TABLES], indirect=True)
    def test_save(
        self,
        sqlite_session_factory: sessionmaker[Session],
        sqlite_session: Session,
        account: Account,
        sample_workflow_execution: WorkflowExecution,
    ):
        repo = SQLAlchemyWorkflowExecutionRepository(
            session_factory=sqlite_session_factory,
            user=account,
            app_id="test_app",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        )

        repo.save(sample_workflow_execution)

        persisted_model = sqlite_session.get(WorkflowRun, sample_workflow_execution.id_)
        assert persisted_model is not None
        assert persisted_model.tenant_id == account.current_tenant_id
        assert persisted_model.inputs_dict == sample_workflow_execution.inputs
        assert persisted_model.outputs_dict == sample_workflow_execution.outputs

        # Check cache
        assert sample_workflow_execution.id_ in repo._execution_cache
        cached_model = repo._execution_cache[sample_workflow_execution.id_]
        assert cached_model.id == sample_workflow_execution.id_

    @pytest.mark.parametrize("sqlite_session", [TABLES], indirect=True)
    def test_save_uses_execution_started_at_when_record_does_not_exist(
        self,
        sqlite_session_factory: sessionmaker[Session],
        sqlite_session: Session,
        account: Account,
        sample_workflow_execution: WorkflowExecution,
    ):
        repo = SQLAlchemyWorkflowExecutionRepository(
            session_factory=sqlite_session_factory,
            user=account,
            app_id="test_app",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        )

        started_at = datetime(2026, 1, 1, 12, 0, 0, tzinfo=UTC)
        sample_workflow_execution.started_at = started_at

        repo.save(sample_workflow_execution)

        persisted_model = sqlite_session.get(WorkflowRun, sample_workflow_execution.id_)
        assert persisted_model is not None
        assert persisted_model.created_at == started_at.replace(tzinfo=None)

    @pytest.mark.parametrize("sqlite_session", [TABLES], indirect=True)
    def test_save_preserves_existing_created_at_when_record_already_exists(
        self,
        sqlite_session_factory: sessionmaker[Session],
        sqlite_session: Session,
        account: Account,
        sample_workflow_execution: WorkflowExecution,
    ):
        repo = SQLAlchemyWorkflowExecutionRepository(
            session_factory=sqlite_session_factory,
            user=account,
            app_id="test_app",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        )

        execution_id = sample_workflow_execution.id_
        existing_created_at = datetime(2026, 1, 1, 12, 0, 0, tzinfo=UTC)
        sample_workflow_execution.started_at = existing_created_at
        repo.save(sample_workflow_execution)

        sample_workflow_execution.started_at = datetime(2026, 1, 1, 12, 30, 0, tzinfo=UTC)

        repo.save(sample_workflow_execution)

        persisted_model = sqlite_session.get(WorkflowRun, execution_id)
        assert persisted_model is not None
        assert persisted_model.created_at == existing_created_at.replace(tzinfo=None)

    @pytest.mark.parametrize("sqlite_session", [TABLES], indirect=True)
    def test_save_rejects_execution_owned_by_another_tenant(
        self,
        sqlite_session_factory: sessionmaker[Session],
        sqlite_session: Session,
        account: Account,
        sample_workflow_execution: WorkflowExecution,
    ):
        other_account = _make_account(tenant_id=str(uuid4()))
        other_repo = SQLAlchemyWorkflowExecutionRepository(
            session_factory=sqlite_session_factory,
            user=other_account,
            app_id="test_app",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        )
        other_repo.save(sample_workflow_execution)

        repo = SQLAlchemyWorkflowExecutionRepository(
            session_factory=sqlite_session_factory,
            user=account,
            app_id="test_app",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        )
        with pytest.raises(ValueError, match="Unauthorized access to workflow run"):
            repo.save(sample_workflow_execution)

        sqlite_session.expire_all()
        persisted_model = sqlite_session.get(WorkflowRun, sample_workflow_execution.id_)
        assert persisted_model is not None
        assert persisted_model.tenant_id == other_account.current_tenant_id
