import json
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from pytest_mock import MockerFixture
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.repositories.celery_workflow_execution_repository import CeleryWorkflowExecutionRepository
from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
from core.repositories.sqlalchemy_workflow_node_execution_repository import SQLAlchemyWorkflowNodeExecutionRepository
from extensions.logstore.aliyun_logstore import AliyunLogStore
from extensions.logstore.repositories.logstore_api_workflow_node_execution_repository import (
    LogstoreAPIWorkflowNodeExecutionRepository,
)
from extensions.logstore.repositories.logstore_api_workflow_run_repository import LogstoreAPIWorkflowRunRepository
from extensions.logstore.repositories.logstore_workflow_execution_repository import LogstoreWorkflowExecutionRepository
from extensions.logstore.repositories.logstore_workflow_node_execution_repository import (
    LogstoreWorkflowNodeExecutionRepository,
)
from graphon.entities import WorkflowExecution as _sqlalchemy_workflow_execution_repository_WorkflowExecution
from graphon.entities import WorkflowNodeExecution
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus, WorkflowType
from libs.datetime_utils import naive_utc_now
from models import Account, EndUser, Tenant, WorkflowRun
from models import CreatorUserRole as _sqlalchemy_workflow_execution_repository_CreatorUserRole
from models.enums import CreatorUserRole as _workflow_control_persistence_CreatorUserRole
from models.enums import EndUserType, WorkflowRunTriggeredFrom
from models.workflow import WorkflowNodeExecutionTriggeredFrom
from models.workflow import WorkflowType as ModelWorkflowType
from repositories.entities.workflow_execution import WorkflowExecution as TimedWorkflowExecution
from repositories.entities.workflow_execution import (
    WorkflowExecution as _workflow_control_persistence_WorkflowExecution,
)
from repositories.sqlalchemy_api_workflow_run_repository import DifyAPISQLAlchemyWorkflowRunRepository
from repositories.workflow_run_control import apply_workflow_stop_to_node
from tasks.workflow_execution_tasks import _update_workflow_run_from_execution

TABLES = (WorkflowRun,)

RESOURCE_TENANT_ID = "resource-tenant-id"


def _make_account(*, tenant_id: str | None = None) -> Account:
    account = Account(name="Repository User", email=f"{uuid4()}@example.com")
    account.id = str(uuid4())
    if tenant_id is not None:
        tenant = Tenant(name="Repository Tenant")
        tenant.id = tenant_id
        account._current_tenant = tenant
    return account


class TestSqlalchemyWorkflowExecutionRepositoryCases:
    @staticmethod
    def test_save_preserves_accumulated_duration_without_double_counting(
        sqlite_session_factory: sessionmaker[Session],
        account: Account,
        sample_workflow_execution: _sqlalchemy_workflow_execution_repository_WorkflowExecution,
    ) -> None:
        repository = SQLAlchemyWorkflowExecutionRepository(
            session_factory=sqlite_session_factory,
            tenant_id=RESOURCE_TENANT_ID,
            user=account,
            app_id="app-1",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        )
        execution = TimedWorkflowExecution(
            **(
                sample_workflow_execution.model_dump()
                | {"finished_at": None, "status": WorkflowExecutionStatus.RUNNING}
            ),
            accumulated_elapsed_time=5.0,
        )
        original_started_at = execution.started_at

        for status, duration in [
            (WorkflowExecutionStatus.RUNNING, 5.0),
            (WorkflowExecutionStatus.PAUSED, 7.0),
            (WorkflowExecutionStatus.SUCCEEDED, 9.0),
        ]:
            execution.status = status
            execution.accumulated_elapsed_time = duration
            if status == WorkflowExecutionStatus.SUCCEEDED:
                execution.finished_at = datetime(2027, 1, 1, tzinfo=UTC)
            repository.save(execution)
            repository.save(execution)
            with sqlite_session_factory() as session:
                stored = session.get(WorkflowRun, execution.id_)
                assert stored is not None
                assert stored.elapsed_time == duration
                assert stored.created_at == original_started_at.replace(tzinfo=None)
                assert repository._to_domain_model(stored).elapsed_time == duration

    @staticmethod
    @pytest.fixture
    def sqlite_session_factory(sqlite_engine: Engine) -> sessionmaker[Session]:
        """Create repository-owned sessions bound to the isolated SQLite engine."""
        return sessionmaker(bind=sqlite_engine, expire_on_commit=False)

    @staticmethod
    @pytest.fixture
    def account() -> Account:
        return _make_account(tenant_id=str(uuid4()))

    @staticmethod
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

    @staticmethod
    @pytest.fixture
    def sample_workflow_execution() -> _sqlalchemy_workflow_execution_repository_WorkflowExecution:
        """Sample WorkflowExecution for testing."""
        return _sqlalchemy_workflow_execution_repository_WorkflowExecution(
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
                session_factory=sqlite_session_factory,
                tenant_id=RESOURCE_TENANT_ID,
                user=account,
                app_id=app_id,
                triggered_from=triggered_from,
            )

            assert repo._session_factory is sqlite_session_factory
            assert repo._tenant_id == RESOURCE_TENANT_ID
            assert repo._app_id == app_id
            assert repo._triggered_from == triggered_from
            assert repo._creator_user_id == account.id
            assert repo._creator_user_role == _sqlalchemy_workflow_execution_repository_CreatorUserRole.ACCOUNT

        def test_init_with_engine(self, sqlite_engine: Engine, account: Account):
            repo = SQLAlchemyWorkflowExecutionRepository(
                session_factory=sqlite_engine,
                tenant_id=RESOURCE_TENANT_ID,
                user=account,
                app_id="test_app_id",
                triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            )

            assert isinstance(repo._session_factory, sessionmaker)
            assert repo._session_factory.kw["bind"] is sqlite_engine

        def test_init_invalid_session_factory(self, account: Account):
            with pytest.raises(ValueError, match="Invalid session_factory type"):
                SQLAlchemyWorkflowExecutionRepository(
                    session_factory="invalid",
                    tenant_id=RESOURCE_TENANT_ID,
                    user=account,
                    app_id=None,
                    triggered_from=None,
                )

        def test_init_no_tenant_id(self, sqlite_session_factory: sessionmaker[Session]):
            user = _make_account()

            with pytest.raises(ValueError, match="tenant_id is required"):
                SQLAlchemyWorkflowExecutionRepository(
                    session_factory=sqlite_session_factory,
                    tenant_id="",
                    user=user,
                    app_id=None,
                    triggered_from=None,
                )

        def test_init_uses_resource_tenant_when_account_has_no_current_tenant(
            self, sqlite_session_factory: sessionmaker[Session]
        ):
            user = _make_account()

            repo = SQLAlchemyWorkflowExecutionRepository(
                session_factory=sqlite_session_factory,
                tenant_id=RESOURCE_TENANT_ID,
                user=user,
                app_id="test-app",
                triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            )

            assert repo._tenant_id == RESOURCE_TENANT_ID
            assert repo._creator_user_id == user.id

        def test_init_with_end_user(self, sqlite_session_factory: sessionmaker[Session], end_user: EndUser):
            repo = SQLAlchemyWorkflowExecutionRepository(
                session_factory=sqlite_session_factory,
                tenant_id=RESOURCE_TENANT_ID,
                user=end_user,
                app_id=None,
                triggered_from=None,
            )
            assert repo._tenant_id == RESOURCE_TENANT_ID
            assert repo._creator_user_role == _sqlalchemy_workflow_execution_repository_CreatorUserRole.END_USER

        @pytest.mark.parametrize("sqlite_session", [TABLES], indirect=True)
        def test_to_domain_model(
            self,
            sqlite_session_factory: sessionmaker[Session],
            sqlite_session: Session,
            account: Account,
        ):
            repo = SQLAlchemyWorkflowExecutionRepository(
                session_factory=sqlite_session_factory,
                tenant_id=RESOURCE_TENANT_ID,
                user=account,
                app_id=None,
                triggered_from=None,
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
                created_by_role=_sqlalchemy_workflow_execution_repository_CreatorUserRole.ACCOUNT,
                created_by=account.id,
                finished_at=datetime.now(UTC),
            )
            db_model.created_at = datetime.now(UTC)
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
            sample_workflow_execution: _sqlalchemy_workflow_execution_repository_WorkflowExecution,
        ):
            repo = SQLAlchemyWorkflowExecutionRepository(
                session_factory=sqlite_session_factory,
                tenant_id=RESOURCE_TENANT_ID,
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
            sample_workflow_execution: _sqlalchemy_workflow_execution_repository_WorkflowExecution,
        ):
            repo = SQLAlchemyWorkflowExecutionRepository(
                session_factory=sqlite_session_factory,
                tenant_id=RESOURCE_TENANT_ID,
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
            sample_workflow_execution: _sqlalchemy_workflow_execution_repository_WorkflowExecution,
        ):
            repo = SQLAlchemyWorkflowExecutionRepository(
                session_factory=sqlite_session_factory,
                tenant_id=RESOURCE_TENANT_ID,
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
            sample_workflow_execution: _sqlalchemy_workflow_execution_repository_WorkflowExecution,
        ):
            repo = SQLAlchemyWorkflowExecutionRepository(
                session_factory=sqlite_session_factory,
                tenant_id=RESOURCE_TENANT_ID,
                user=account,
                app_id=None,
                triggered_from=None,
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
            sample_workflow_execution: _sqlalchemy_workflow_execution_repository_WorkflowExecution,
        ):
            repo = SQLAlchemyWorkflowExecutionRepository(
                session_factory=sqlite_session_factory,
                tenant_id=RESOURCE_TENANT_ID,
                user=account,
                app_id="test_app",
                triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            )

            repo.save(sample_workflow_execution)

            persisted_model = sqlite_session.get(WorkflowRun, sample_workflow_execution.id_)
            assert persisted_model is not None
            assert persisted_model.tenant_id == RESOURCE_TENANT_ID
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
            sample_workflow_execution: _sqlalchemy_workflow_execution_repository_WorkflowExecution,
        ):
            repo = SQLAlchemyWorkflowExecutionRepository(
                session_factory=sqlite_session_factory,
                tenant_id=RESOURCE_TENANT_ID,
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
            sample_workflow_execution: _sqlalchemy_workflow_execution_repository_WorkflowExecution,
        ):
            repo = SQLAlchemyWorkflowExecutionRepository(
                session_factory=sqlite_session_factory,
                tenant_id=RESOURCE_TENANT_ID,
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
            sample_workflow_execution: _sqlalchemy_workflow_execution_repository_WorkflowExecution,
        ):
            other_tenant_id = str(uuid4())
            other_account = _make_account(tenant_id=str(uuid4()))
            other_repo = SQLAlchemyWorkflowExecutionRepository(
                session_factory=sqlite_session_factory,
                tenant_id=other_tenant_id,
                user=other_account,
                app_id="test_app",
                triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            )
            other_repo.save(sample_workflow_execution)

            repo = SQLAlchemyWorkflowExecutionRepository(
                session_factory=sqlite_session_factory,
                tenant_id=RESOURCE_TENANT_ID,
                user=account,
                app_id="test_app",
                triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            )
            with pytest.raises(ValueError, match="Unauthorized access to workflow run"):
                repo.save(sample_workflow_execution)

            sqlite_session.expire_all()
            persisted_model = sqlite_session.get(WorkflowRun, sample_workflow_execution.id_)
            assert persisted_model is not None
            assert persisted_model.tenant_id == other_tenant_id


"""Configured history backends retain synchronous, monotonic task control."""


class TestWorkflowControlPersistenceCases:
    @staticmethod
    @pytest.fixture
    def logstore(monkeypatch: pytest.MonkeyPatch, mocker: MockerFixture) -> AliyunLogStore:
        monkeypatch.setattr(AliyunLogStore, "_instance", None)
        monkeypatch.setattr(AliyunLogStore, "_initialized", False)
        monkeypatch.setenv("ALIYUN_SLS_ENDPOINT", "https://example.com")
        mocker.patch.object(AliyunLogStore, "_check_endpoint_connectivity")
        store = AliyunLogStore()
        store._use_pg_protocol = True
        mocker.patch.object(store, "put_log")
        return store

    @staticmethod
    @pytest.mark.parametrize("backend", ["sql", "celery", "logstore"])
    def test_task_owner_is_durable_before_start_and_delayed_writes_cannot_revive_stop(
        sqlite_session_factory: sessionmaker[Session], logstore: AliyunLogStore, mocker: MockerFixture, backend: str
    ) -> None:
        queued_save = mocker.patch(
            "core.repositories.celery_workflow_execution_repository.save_workflow_execution_task.delay"
        )
        get_logs = mocker.patch.object(logstore, "get_logs")
        repository_class = {
            "sql": SQLAlchemyWorkflowExecutionRepository,
            "celery": CeleryWorkflowExecutionRepository,
            "logstore": LogstoreWorkflowExecutionRepository,
        }[backend]
        user = Account(name="Test", email="test@example.com")
        user.id = "account-1"
        repository = repository_class(
            session_factory=sqlite_session_factory,
            tenant_id="tenant-1",
            user=user,
            app_id="app-1",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        )
        if isinstance(repository, LogstoreWorkflowExecutionRepository):
            repository._enable_dual_write = False
        execution = _workflow_control_persistence_WorkflowExecution(
            id_="run-1",
            workflow_id="workflow-1",
            workflow_type=WorkflowType.WORKFLOW,
            workflow_version="1",
            graph={"nodes": [], "edges": []},
            inputs={},
            started_at=naive_utc_now(),
        )
        repository.save_synchronously(execution)
        queued_save.assert_not_called()
        control = DifyAPISQLAlchemyWorkflowRunRepository(sqlite_session_factory)
        control.bind_workflow_task(tenant_id="tenant-1", app_id="app-1", workflow_run_id="run-1", task_id="task-1")
        with sqlite_session_factory() as session:
            run = session.get(WorkflowRun, "run-1")
            assert run is not None
            assert run.task_id == "task-1"
            assert (run.created_by_role, run.created_by) == (
                _workflow_control_persistence_CreatorUserRole.ACCOUNT,
                "account-1",
            )
        execution.status = WorkflowExecutionStatus.PAUSED
        repository.save_synchronously(execution)
        stopped = control.stop_paused_workflow_task(tenant_id="tenant-1", app_id="app-1", task_id="task-1", owner=None)
        assert stopped is not None
        assert stopped.status == WorkflowExecutionStatus.STOPPED

        # A writer already queued or running before the stop cannot restore RUNNING.
        execution.status = WorkflowExecutionStatus.RUNNING
        repository.save_synchronously(execution)
        with sqlite_session_factory.begin() as session:
            run = session.get(WorkflowRun, "run-1")
            assert run is not None
            _update_workflow_run_from_execution(run, execution)
        with sqlite_session_factory() as session:
            run = session.get(WorkflowRun, "run-1")
            assert run is not None
            assert run.status == WorkflowExecutionStatus.STOPPED
            assert run.stop_requested_at is not None
        if backend == "logstore":
            # LogStore implements the configured run-control subset of the history protocol.
            api = LogstoreAPIWorkflowRunRepository(sqlite_session_factory)  # pyrefly: ignore[bad-instantiation]
            api._enable_dual_read = False
            found = api.get_workflow_run_by_id("tenant-1", "app-1", "run-1")
            assert found is not None
            assert found.status == WorkflowExecutionStatus.STOPPED
            unscoped = api.get_workflow_run_by_id_without_tenant("run-1")
            assert unscoped is not None
            assert unscoped.status == WorkflowExecutionStatus.STOPPED
            get_logs.assert_not_called()

    @staticmethod
    @pytest.mark.usefixtures("logstore")
    def test_logstore_pause_lifecycle_uses_sql_control_with_dual_write_disabled(
        sqlite_session_factory: sessionmaker[Session], mocker: MockerFixture
    ) -> None:
        mocker.patch("repositories.sqlalchemy_api_workflow_run_repository.storage.save")
        mocker.patch("repositories.sqlalchemy_api_workflow_run_repository.storage.delete")
        user = Account(name="Test", email="test@example.com")
        user.id = "account-1"
        sql = SQLAlchemyWorkflowExecutionRepository(
            session_factory=sqlite_session_factory,
            tenant_id="tenant-1",
            user=user,
            app_id="app-1",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        )
        sql.save_synchronously(
            _workflow_control_persistence_WorkflowExecution(
                id_="run-1",
                workflow_id="workflow-1",
                workflow_type=WorkflowType.WORKFLOW,
                workflow_version="1",
                graph={},
                inputs={},
                started_at=naive_utc_now(),
            )
        )
        api = LogstoreAPIWorkflowRunRepository(sqlite_session_factory)  # pyrefly: ignore[bad-instantiation]
        api.bind_workflow_task(tenant_id="tenant-1", app_id="app-1", workflow_run_id="run-1", task_id="task-1")
        pause = api.create_workflow_pause("run-1", "account-1", "{}", [])
        persisted_pause = api.get_workflow_pause("run-1")
        assert persisted_pause is not None
        assert persisted_pause.id == pause.id
        resume_callbacks: list[None] = []
        resumed = api.resume_workflow_pause("run-1", pause, before_resume=lambda: resume_callbacks.append(None))
        assert resume_callbacks == [None]
        api.delete_workflow_pause(resumed)
        assert api.get_workflow_pause("run-1") is None

    @staticmethod
    @pytest.mark.parametrize(
        ("record_type", "node_status"),
        [
            ("workflow", WorkflowNodeExecutionStatus.PAUSED),
            ("node", WorkflowNodeExecutionStatus.PAUSED),
            ("node", WorkflowNodeExecutionStatus.RETRY),
        ],
    )
    def test_logstore_stop_orders_before_delayed_upload_and_overrides_stale_indexes(
        sqlite_session_factory: sessionmaker[Session],
        logstore: AliyunLogStore,
        mocker: MockerFixture,
        record_type: str,
        node_status: WorkflowNodeExecutionStatus,
    ) -> None:
        user = Account(name="Test", email="test@example.com")
        user.id = "account-1"
        run = _workflow_control_persistence_WorkflowExecution(
            accumulated_elapsed_time=3.5,
            id_="run-1",
            workflow_id="workflow-1",
            workflow_type=WorkflowType.WORKFLOW,
            workflow_version="1",
            graph={},
            inputs={},
            started_at=naive_utc_now(),
        )
        run.status = WorkflowExecutionStatus.PAUSED
        SQLAlchemyWorkflowExecutionRepository(
            session_factory=sqlite_session_factory,
            tenant_id="tenant-1",
            user=user,
            app_id="app-1",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        ).save(run)
        control = DifyAPISQLAlchemyWorkflowRunRepository(sqlite_session_factory)
        control.bind_workflow_task(tenant_id="tenant-1", app_id="app-1", workflow_run_id="run-1", task_id="task-1")
        node = WorkflowNodeExecution(
            id="node-1",
            node_execution_id="node-1",
            workflow_id="workflow-1",
            workflow_execution_id="run-1",
            index=1,
            node_id="review",
            node_type="human-input",
            title="Review",
            created_at=run.started_at,
            status=node_status,
        )
        SQLAlchemyWorkflowNodeExecutionRepository(
            session_factory=sqlite_session_factory,
            tenant_id="tenant-1",
            user=user,
            app_id="app-1",
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        ).save_synchronously(node)
        records: list[dict[str, str]] = []
        interrupted = False

        def append_after_concurrent_stop(_store: str, fields: list[tuple[str, str]]) -> None:
            nonlocal interrupted
            if not interrupted:
                interrupted = True
                stopped = control.stop_paused_workflow_task(
                    tenant_id="tenant-1", app_id="app-1", task_id="task-1", owner=None
                )
                assert stopped is not None
                if record_type == "workflow":
                    run_writer.save(
                        run.model_copy(
                            update={
                                "status": WorkflowExecutionStatus.STOPPED,
                                "finished_at": stopped.finished_at,
                                "error_message": stopped.error,
                            }
                        )
                    )
                else:
                    node_writer.save_many(
                        [
                            node.model_copy(
                                update={
                                    "status": WorkflowNodeExecutionStatus.FAILED,
                                    "finished_at": stopped.finished_at,
                                    "error": stopped.error,
                                }
                            )
                        ]
                    )
            records.append(dict(fields))

        mocker.patch.object(logstore, "put_log", side_effect=append_after_concurrent_stop)
        run_writer = LogstoreWorkflowExecutionRepository(
            session_factory=sqlite_session_factory,
            tenant_id="tenant-1",
            user=user,
            app_id="app-1",
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        )
        node_writer = LogstoreWorkflowNodeExecutionRepository(
            session_factory=sqlite_session_factory,
            tenant_id="tenant-1",
            user=user,
            app_id="app-1",
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )
        run_writer._enable_dual_write = node_writer._enable_dual_write = False
        if record_type == "workflow":
            run_writer.save(run)
            expected_status = "stopped"
            assert max(records, key=lambda row: int(row["log_version"]))["status"] == expected_status
            run.accumulated_elapsed_time = 999.0
            run_writer.save(run)  # Another late RUNNING/PAUSED write also remains terminal.
            assert float(records[-1]["elapsed_time"]) == 3.5
        else:
            node_writer.save(node)
            expected_status = "failed"
            assert max(records, key=lambda row: int(row["log_version"]))["status"] == expected_status
            stale_node = next(row for row in records if row["status"] == node_status)
            mocker.patch.object(logstore, "execute_sql", return_value=[stale_node])
            api = LogstoreAPIWorkflowNodeExecutionRepository(sqlite_session_factory)  # pyrefly: ignore[bad-instantiation]
            assert api.get_executions_by_workflow_run("tenant-1", "app-1", "run-1")[0].status == expected_status
            by_id = api.get_execution_by_id("node-1", "tenant-1")
            assert by_id is not None
            assert by_id.status == expected_status
            assert (
                api.get_execution_snapshots_by_workflow_run("tenant-1", "app-1", "workflow-1", "workflow-run", "run-1")[
                    0
                ].status
                == expected_status
            )
            assert node_writer.get_by_workflow_execution("run-1")[0].status == expected_status
            node_writer.save(node)
        assert records[-1]["status"] == expected_status

    @staticmethod
    @pytest.mark.parametrize(
        "status",
        [
            WorkflowNodeExecutionStatus.SUCCEEDED,
            WorkflowNodeExecutionStatus.FAILED,
            WorkflowNodeExecutionStatus.EXCEPTION,
            WorkflowNodeExecutionStatus.STOPPED,
        ],
    )
    def test_stop_preserves_completed_node_history(status: WorkflowNodeExecutionStatus) -> None:
        finished_at = naive_utc_now()
        stopped = WorkflowRun(
            id="run-1",
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
            type=ModelWorkflowType.WORKFLOW,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            version="1",
            status=WorkflowExecutionStatus.STOPPED,
            created_by_role=_workflow_control_persistence_CreatorUserRole.ACCOUNT,
            created_by="account-1",
            error="User requested stop",
            finished_at=finished_at,
            stop_requested_at=finished_at,
        )
        node = WorkflowNodeExecution(
            id="node-1",
            workflow_id="workflow-1",
            workflow_execution_id="run-1",
            index=1,
            node_id="answer",
            node_type="llm",
            title="Answer",
            status=status,
            outputs={"answer": "preserved"},
            error=None if status == WorkflowNodeExecutionStatus.SUCCEEDED else "Original terminal error",
            elapsed_time=2.5,
            created_at=finished_at,
            finished_at=finished_at,
        )
        original = node.model_dump()

        apply_workflow_stop_to_node(node, stopped)

        assert node.model_dump() == original
