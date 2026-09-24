"""
Unit tests for the RepositoryFactory.

This module tests the factory pattern implementation for creating repository instances
based on configuration, including error handling.
"""

from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import MagicMock, patch

import pytest
from flask import has_app_context
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.file.uploads import FileUploadWriter
from core.repositories.celery_workflow_node_execution_query_repository import (
    CeleryWorkflowNodeExecutionQueryRepository,
)
from core.repositories.celery_workflow_node_execution_write_repository import CeleryWorkflowNodeExecutionWriteRepository
from core.repositories.factory import (
    DifyCoreRepositoryFactory,
    OrderConfig,
    RepositoryImportError,
    WorkflowExecutionRepository,
    WorkflowNodeExecutionQuery,
)
from core.repositories.sqlalchemy_workflow_node_execution_query_repository import (
    SQLAlchemyWorkflowNodeExecutionQueryRepository,
)
from core.repositories.sqlalchemy_workflow_node_execution_write_repository import (
    SQLAlchemyWorkflowNodeExecutionWriteRepository,
)
from extensions.logstore.aliyun_logstore import AliyunLogStore
from extensions.logstore.repositories import (
    logstore_workflow_node_execution_query_repository as logstore_query_module,
)
from extensions.logstore.repositories import logstore_workflow_node_execution_write_repository as logstore_writer_module
from extensions.logstore.repositories.logstore_workflow_node_execution_query_repository import (
    LogstoreWorkflowNodeExecutionQueryRepository,
)
from extensions.logstore.repositories.logstore_workflow_node_execution_write_repository import (
    LogstoreWorkflowNodeExecutionWriteRepository,
)
from graphon.entities import WorkflowNodeExecution
from libs.module_loading import import_string
from models import Account, EndUser
from models.enums import WorkflowRunTriggeredFrom
from models.workflow import WorkflowNodeExecutionTriggeredFrom
from services.file_upload_service import FileUploadService

RESOURCE_TENANT_ID = "resource-tenant-id"


class LegacyNodeExecutionRepository:
    """Independent backend that accepts only the original five constructor arguments."""

    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session] | Engine,
        tenant_id: str,
        user: Account | EndUser,
        app_id: str,
        triggered_from: WorkflowNodeExecutionTriggeredFrom,
    ) -> None:
        self.constructor_args = (session_factory, tenant_id, user, app_id, triggered_from)
        self.executions: list[WorkflowNodeExecution] = []

    def save(self, execution: WorkflowNodeExecution) -> None:
        self.executions.append(execution)

    def save_synchronously(self, execution: WorkflowNodeExecution) -> None:
        self.save(execution)

    def save_execution_data(self, execution: WorkflowNodeExecution) -> None:
        self.save(execution)

    def get_by_workflow_execution(
        self, workflow_execution_id: str, order_config: OrderConfig | None = None
    ) -> Sequence[WorkflowNodeExecution]:
        del order_config
        return [execution for execution in self.executions if execution.workflow_execution_id == workflow_execution_id]


class FailingLegacyNodeExecutionRepository(LegacyNodeExecutionRepository):
    def __init__(self, **_kwargs: object) -> None:
        raise RuntimeError("Legacy backend initialization failed")


LogstoreWriterAlias = LogstoreWorkflowNodeExecutionWriteRepository

_BUILTIN_NODE_BACKENDS = [
    (
        "core.repositories.sqlalchemy_workflow_node_execution_write_repository.SQLAlchemyWorkflowNodeExecutionWriteRepository",
        SQLAlchemyWorkflowNodeExecutionWriteRepository,
        SQLAlchemyWorkflowNodeExecutionQueryRepository,
    ),
    (
        "core.repositories.SQLAlchemyWorkflowNodeExecutionWriteRepository",
        SQLAlchemyWorkflowNodeExecutionWriteRepository,
        SQLAlchemyWorkflowNodeExecutionQueryRepository,
    ),
    (
        "core.repositories.celery_workflow_node_execution_write_repository.CeleryWorkflowNodeExecutionWriteRepository",
        CeleryWorkflowNodeExecutionWriteRepository,
        CeleryWorkflowNodeExecutionQueryRepository,
    ),
    (
        "core.repositories.CeleryWorkflowNodeExecutionWriteRepository",
        CeleryWorkflowNodeExecutionWriteRepository,
        CeleryWorkflowNodeExecutionQueryRepository,
    ),
    (
        "extensions.logstore.repositories.logstore_workflow_node_execution_write_repository."
        "LogstoreWorkflowNodeExecutionWriteRepository",
        LogstoreWorkflowNodeExecutionWriteRepository,
        LogstoreWorkflowNodeExecutionQueryRepository,
    ),
    (
        f"{__name__}.LogstoreWriterAlias",
        LogstoreWorkflowNodeExecutionWriteRepository,
        LogstoreWorkflowNodeExecutionQueryRepository,
    ),
    (
        "core.repositories.sqlalchemy_workflow_node_execution_repository.SQLAlchemyWorkflowNodeExecutionRepository",
        SQLAlchemyWorkflowNodeExecutionWriteRepository,
        SQLAlchemyWorkflowNodeExecutionQueryRepository,
    ),
    (
        "core.repositories.SQLAlchemyWorkflowNodeExecutionRepository",
        SQLAlchemyWorkflowNodeExecutionWriteRepository,
        SQLAlchemyWorkflowNodeExecutionQueryRepository,
    ),
    (
        "core.repositories.celery_workflow_node_execution_repository.CeleryWorkflowNodeExecutionRepository",
        CeleryWorkflowNodeExecutionWriteRepository,
        CeleryWorkflowNodeExecutionQueryRepository,
    ),
    (
        "core.repositories.CeleryWorkflowNodeExecutionRepository",
        CeleryWorkflowNodeExecutionWriteRepository,
        CeleryWorkflowNodeExecutionQueryRepository,
    ),
    (
        "extensions.logstore.repositories.logstore_workflow_node_execution_repository."
        "LogstoreWorkflowNodeExecutionRepository",
        LogstoreWorkflowNodeExecutionWriteRepository,
        LogstoreWorkflowNodeExecutionQueryRepository,
    ),
]


@pytest.fixture
def node_user() -> Account:
    user = Account(name="Test Account", email="test@example.com")
    user.id = "user-1"
    return user


@pytest.fixture
def logstore_client(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    client = MagicMock(spec=AliyunLogStore)
    rows: list[dict[str, object]] = []
    client.execute_sql.return_value = rows
    client_type = MagicMock(
        return_value=client,
        workflow_node_execution_logstore=AliyunLogStore.workflow_node_execution_logstore,
    )
    monkeypatch.setattr(logstore_writer_module, "AliyunLogStore", client_type)
    monkeypatch.setattr(logstore_query_module, "AliyunLogStore", client_type)
    return client


@pytest.fixture
def sqlite_session_factory(sqlite_engine: Engine) -> sessionmaker[Session]:
    """Return a real session factory bound to the test's isolated SQLite engine."""
    factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    with factory() as session:
        assert session.get_bind() is sqlite_engine
    return factory


class TestRepositoryFactory:
    """Test cases for RepositoryFactory."""

    @pytest.fixture(autouse=True)
    def _repository_config(self, config_overrides) -> None:
        config_overrides(
            CORE_WORKFLOW_EXECUTION_REPOSITORY="unittest.mock.MagicMock",
            CORE_WORKFLOW_NODE_EXECUTION_REPOSITORY="unittest.mock.MagicMock",
        )

    def test_import_string_success(self):
        """Test successful class import."""
        # Test importing a real class
        class_path = "unittest.mock.MagicMock"
        result = import_string(class_path)
        assert result is MagicMock

    def test_import_string_invalid_path(self):
        """Test import with invalid module path."""
        with pytest.raises(ImportError) as exc_info:
            import_string("invalid.module.path")
        assert "No module named" in str(exc_info.value)

    def test_import_string_invalid_class_name(self):
        """Test import with invalid class name."""
        with pytest.raises(ImportError) as exc_info:
            import_string("unittest.mock.NonExistentClass")
        assert "does not define" in str(exc_info.value)

    def test_import_string_malformed_path(self):
        """Test import with malformed path (no dots)."""
        with pytest.raises(ImportError) as exc_info:
            import_string("invalidpath")
        assert "doesn't look like a module path" in str(exc_info.value)

    def test_create_workflow_execution_repository_success(self, sqlite_session_factory):
        """Test successful WorkflowExecutionRepository creation."""
        # Create non-database dependencies
        mock_user = Account(name="Test Account", email="test@example.com")
        app_id = "test-app-id"
        triggered_from = WorkflowRunTriggeredFrom.APP_RUN

        # Create mock repository class and instance
        mock_repository_class = MagicMock()
        mock_repository_instance = MagicMock(spec=WorkflowExecutionRepository)
        mock_repository_class.return_value = mock_repository_instance

        # Mock import_string
        with patch("core.repositories.factory.import_string", return_value=mock_repository_class, autospec=True):
            result = DifyCoreRepositoryFactory.create_workflow_execution_repository(
                session_factory=sqlite_session_factory,
                tenant_id=RESOURCE_TENANT_ID,
                user=mock_user,
                app_id=app_id,
                triggered_from=triggered_from,
            )

            # Verify the repository was created with correct parameters
            mock_repository_class.assert_called_once_with(
                session_factory=sqlite_session_factory,
                tenant_id=RESOURCE_TENANT_ID,
                user=mock_user,
                app_id=app_id,
                triggered_from=triggered_from,
            )
            assert result is mock_repository_instance

    def test_create_workflow_execution_repository_import_error(self, sqlite_session_factory, config_overrides):
        """Test WorkflowExecutionRepository creation with import error."""
        config_overrides(CORE_WORKFLOW_EXECUTION_REPOSITORY="invalid.module.InvalidClass")

        mock_user = Account(name="Test Account", email="test@example.com")

        with pytest.raises(RepositoryImportError) as exc_info:
            DifyCoreRepositoryFactory.create_workflow_execution_repository(
                session_factory=sqlite_session_factory,
                tenant_id=RESOURCE_TENANT_ID,
                user=mock_user,
                app_id="test-app-id",
                triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            )
        assert "Failed to create WorkflowExecutionRepository" in str(exc_info.value)

    def test_create_workflow_execution_repository_instantiation_error(self, sqlite_session_factory):
        """Test WorkflowExecutionRepository creation with instantiation error."""
        mock_user = Account(name="Test Account", email="test@example.com")

        # Create a mock repository class that raises exception on instantiation
        mock_repository_class = MagicMock()
        mock_repository_class.side_effect = Exception("Instantiation failed")

        # Mock import_string to return a failing class
        with patch("core.repositories.factory.import_string", return_value=mock_repository_class, autospec=True):
            with pytest.raises(RepositoryImportError) as exc_info:
                DifyCoreRepositoryFactory.create_workflow_execution_repository(
                    session_factory=sqlite_session_factory,
                    tenant_id=RESOURCE_TENANT_ID,
                    user=mock_user,
                    app_id="test-app-id",
                    triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
                )
            assert "Failed to create WorkflowExecutionRepository" in str(exc_info.value)

    def test_repository_import_error_exception(self):
        """Test RepositoryImportError exception handling."""
        error_message = "Custom error message"
        error = RepositoryImportError(error_message)
        assert str(error) == error_message

    def test_create_with_engine_instead_of_sessionmaker(self, sqlite_engine: Engine):
        """Test repository creation with Engine instead of sessionmaker."""
        # Pass the real Engine directly instead of wrapping it in sessionmaker
        mock_user = Account(name="Test Account", email="test@example.com")
        app_id = "test-app-id"
        triggered_from = WorkflowRunTriggeredFrom.APP_RUN

        # Create mock repository class and instance
        mock_repository_class = MagicMock()
        mock_repository_instance = MagicMock(spec=WorkflowExecutionRepository)
        mock_repository_class.return_value = mock_repository_instance

        # Mock import_string
        with patch("core.repositories.factory.import_string", return_value=mock_repository_class, autospec=True):
            result = DifyCoreRepositoryFactory.create_workflow_execution_repository(
                session_factory=sqlite_engine,
                tenant_id=RESOURCE_TENANT_ID,
                user=mock_user,
                app_id=app_id,
                triggered_from=triggered_from,
            )

            # Verify the repository was created with correct parameters
            mock_repository_class.assert_called_once_with(
                session_factory=sqlite_engine,
                tenant_id=RESOURCE_TENANT_ID,
                user=mock_user,
                app_id=app_id,
                triggered_from=triggered_from,
            )
            assert result is mock_repository_instance


@pytest.mark.parametrize("query_only", [False, True])
def test_legacy_node_backend_keeps_its_original_five_constructor_arguments(
    config_overrides: Callable[..., None],
    sqlite_session_factory: sessionmaker[Session],
    node_user: Account,
    file_uploads: FileUploadWriter,
    query_only: bool,
) -> None:
    config_overrides(CORE_WORKFLOW_NODE_EXECUTION_REPOSITORY=f"{__name__}.LegacyNodeExecutionRepository")
    if query_only:
        repository = DifyCoreRepositoryFactory.create_workflow_node_execution_query(
            session_factory=sqlite_session_factory,
            tenant_id=RESOURCE_TENANT_ID,
            user=node_user,
            app_id="app-1",
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )
    else:
        repositories = DifyCoreRepositoryFactory.create_workflow_node_execution_repositories(
            session_factory=sqlite_session_factory,
            tenant_id=RESOURCE_TENANT_ID,
            user=node_user,
            app_id="app-1",
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
            file_uploads=file_uploads,
        )
        assert repositories.writer is repositories.query
        repository = repositories.query

    assert isinstance(repository, LegacyNodeExecutionRepository)
    assert repository.constructor_args == (
        sqlite_session_factory,
        RESOURCE_TENANT_ID,
        node_user,
        "app-1",
        WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    )


@pytest.mark.parametrize(("class_path", "writer_type", "query_type"), _BUILTIN_NODE_BACKENDS)
def test_builtin_node_backend_and_class_alias_create_separate_ports(
    config_overrides: Callable[..., None],
    sqlite_session_factory: sessionmaker[Session],
    node_user: Account,
    file_uploads: FileUploadWriter,
    logstore_client: MagicMock,
    class_path: str,
    writer_type: type,
    query_type: type,
) -> None:
    config_overrides(CORE_WORKFLOW_NODE_EXECUTION_REPOSITORY=class_path)

    repositories = DifyCoreRepositoryFactory.create_workflow_node_execution_repositories(
        session_factory=sqlite_session_factory,
        tenant_id=RESOURCE_TENANT_ID,
        user=node_user,
        app_id="app-1",
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        file_uploads=file_uploads,
    )

    assert isinstance(repositories.writer, writer_type)
    assert isinstance(repositories.query, query_type)
    assert repositories.writer is not repositories.query
    if isinstance(repositories.writer, CeleryWorkflowNodeExecutionWriteRepository):
        assert isinstance(repositories.query, CeleryWorkflowNodeExecutionQueryRepository)
        assert repositories.writer._cache is repositories.query._cache
    if isinstance(repositories.writer, LogstoreWorkflowNodeExecutionWriteRepository):
        assert isinstance(repositories.query, LogstoreWorkflowNodeExecutionQueryRepository)
        assert repositories.writer.logstore_client is repositories.query.logstore_client is logstore_client


@pytest.mark.parametrize(
    ("class_path", "query_type"),
    [(path, query_type) for path, _writer_type, query_type in _BUILTIN_NODE_BACKENDS],
)
def test_builtin_query_requires_neither_writer_uploads_nor_flask_context(
    config_overrides: Callable[..., None],
    sqlite_session_factory: sessionmaker[Session],
    node_user: Account,
    logstore_client: MagicMock,
    class_path: str,
    query_type: type,
) -> None:
    config_overrides(CORE_WORKFLOW_NODE_EXECUTION_REPOSITORY=class_path)

    def read_outside_flask() -> WorkflowNodeExecutionQuery:
        assert not has_app_context()
        repository = DifyCoreRepositoryFactory.create_workflow_node_execution_query(
            session_factory=sqlite_session_factory,
            tenant_id=RESOURCE_TENANT_ID,
            user=node_user,
            app_id="app-1",
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )
        assert repository.get_by_workflow_execution("run-1") == []
        return repository

    with (
        patch.object(
            SQLAlchemyWorkflowNodeExecutionWriteRepository,
            "__init__",
            side_effect=AssertionError("Query must not initialize a SQL writer"),
        ),
        patch.object(
            CeleryWorkflowNodeExecutionWriteRepository,
            "__init__",
            side_effect=AssertionError("Query must not initialize a Celery writer"),
        ),
        patch.object(
            LogstoreWorkflowNodeExecutionWriteRepository,
            "__init__",
            side_effect=AssertionError("Query must not initialize a LogStore writer"),
        ),
        patch.object(
            FileUploadService, "__init__", side_effect=AssertionError("Query must not initialize an upload service")
        ),
        ThreadPoolExecutor(max_workers=1) as executor,
    ):
        repository = executor.submit(read_outside_flask).result()

    assert isinstance(repository, query_type)

    if isinstance(repository, LogstoreWorkflowNodeExecutionQueryRepository):
        assert repository.logstore_client is logstore_client


@pytest.mark.parametrize("query_only", [False, True])
@pytest.mark.parametrize(
    ("class_path", "error_type"),
    [
        ("invalid.module.InvalidClass", ImportError),
        (f"{__name__}.FailingLegacyNodeExecutionRepository", RuntimeError),
    ],
)
def test_node_backend_errors_preserve_the_original_cause(
    config_overrides: Callable[..., None],
    sqlite_session_factory: sessionmaker[Session],
    node_user: Account,
    file_uploads: FileUploadWriter,
    class_path: str,
    error_type: type[Exception],
    query_only: bool,
) -> None:
    config_overrides(CORE_WORKFLOW_NODE_EXECUTION_REPOSITORY=class_path)

    if query_only:
        with pytest.raises(RepositoryImportError) as raised:
            DifyCoreRepositoryFactory.create_workflow_node_execution_query(
                session_factory=sqlite_session_factory,
                tenant_id=RESOURCE_TENANT_ID,
                user=node_user,
                app_id="app-1",
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
            )
    else:
        with pytest.raises(RepositoryImportError) as raised:
            DifyCoreRepositoryFactory.create_workflow_node_execution_repositories(
                session_factory=sqlite_session_factory,
                tenant_id=RESOURCE_TENANT_ID,
                user=node_user,
                app_id="app-1",
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
                file_uploads=file_uploads,
            )

    assert class_path in str(raised.value)
    assert isinstance(raised.value.__cause__, error_type)
