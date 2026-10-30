import logging
import sys
from collections.abc import Iterator, Sequence
from contextlib import AbstractContextManager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from types import ModuleType
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session, sessionmaker

import tasks.remove_app_and_related_data_task as remove_app_task_module
from enums import DeploymentEdition
from enums.creator import CreatorUserRole
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus
from graphon.variables.segments import StringSegment
from graphon.variables.types import SegmentType
from libs.archive_storage import ArchiveStorageNotConfiguredError
from models import AppModelConfig, AppStar, UploadFile
from models.agent import WorkflowAgentBindingType, WorkflowAgentNodeBinding
from models.enums import WorkflowRunTriggeredFrom
from models.workflow import (
    ExecutionOffLoadType,
    WorkflowArchiveLog,
    WorkflowDraftVariable,
    WorkflowDraftVariableFile,
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionOffload,
    WorkflowNodeExecutionTriggeredFrom,
    WorkflowRun,
    WorkflowType,
)
from services.network_access_group_service import NetworkAccessGroupUpstreamError
from tasks.remove_app_and_related_data_task import (
    _delete_app_stars,
    _delete_app_workflow_archive_logs,
    _delete_archived_workflow_run_files,
    _delete_draft_variable_offload_data,
    _delete_draft_variables,
    _delete_workflow_agent_node_bindings,
    delete_draft_variables_batch,
)
from tests.helpers.unit.config_override import apply_config_overrides
from tests.helpers.unit.model_factories import make_app, make_upload_file


@dataclass
class _NetworkAccessGroups:
    failure: Exception | None = None
    calls: list[tuple[str, str]] = field(default_factory=list)

    def cleanup_app_binding(self, *, workspace_id: str, app_id: str) -> bool:
        self.calls.append((workspace_id, app_id))
        if self.failure is not None:
            raise self.failure
        return True


@dataclass(frozen=True)
class _ApplicationServices:
    network_access_groups: _NetworkAccessGroups


@dataclass
class _DeleteStorage:
    failures: list[Exception | None] = field(default_factory=list)
    deleted: list[str] = field(default_factory=list)

    def delete(self, key: str) -> None:
        self.deleted.append(key)
        if self.failures:
            failure = self.failures.pop(0)
            if failure is not None:
                raise failure


@dataclass
class _ArchiveStorage:
    keys: list[str] = field(default_factory=list)
    list_failure: Exception | None = None
    delete_failures: list[Exception | None] = field(default_factory=list)
    listed: list[str] = field(default_factory=list)
    deleted: list[str] = field(default_factory=list)

    def list_objects(self, prefix: str) -> list[str]:
        self.listed.append(prefix)
        if self.list_failure is not None:
            raise self.list_failure
        return self.keys

    def delete_object(self, key: str) -> None:
        self.deleted.append(key)
        if self.delete_failures:
            failure = self.delete_failures.pop(0)
            if failure is not None:
                raise failure


def test_delete_workflow_agent_node_bindings_is_scoped_to_tenant_and_app(sqlite_session: Session) -> None:
    target = WorkflowAgentNodeBinding(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        workflow_version="draft",
        node_id="node-1",
        binding_type=WorkflowAgentBindingType.INLINE_AGENT,
        agent_id="agent-1",
        current_snapshot_id="snapshot-1",
        node_job_config={},
    )
    kept = WorkflowAgentNodeBinding(
        tenant_id="tenant-1",
        app_id="app-2",
        workflow_id="workflow-2",
        workflow_version="draft",
        node_id="node-2",
        binding_type=WorkflowAgentBindingType.INLINE_AGENT,
        agent_id="agent-2",
        current_snapshot_id="snapshot-2",
        node_job_config={},
    )
    other_tenant = WorkflowAgentNodeBinding(
        tenant_id="tenant-2",
        app_id="app-1",
        workflow_id="workflow-3",
        workflow_version="draft",
        node_id="node-3",
        binding_type=WorkflowAgentBindingType.INLINE_AGENT,
        agent_id="agent-3",
        current_snapshot_id="snapshot-3",
        node_job_config={},
    )
    sqlite_session.add_all([target, kept, other_tenant])
    sqlite_session.commit()
    target_id = target.id
    kept_id = kept.id
    other_tenant_id = other_tenant.id

    _delete_workflow_agent_node_bindings("tenant-1", "app-1")

    sqlite_session.expire_all()
    assert sqlite_session.get(WorkflowAgentNodeBinding, target_id) is None
    assert sqlite_session.get(WorkflowAgentNodeBinding, kept_id) is not None
    assert sqlite_session.get(WorkflowAgentNodeBinding, other_tenant_id) is not None


def test_app_cleanup_removes_agent_bindings_before_workflows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[str] = []
    apply_config_overrides(
        monkeypatch,
        DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY,
    )
    other_cleanup_names = (
        "cleanup_app_storage",
        "_delete_app_model_configs",
        "_delete_app_site",
        "_delete_app_mcp_servers",
        "_delete_app_api_tokens",
        "_delete_installed_apps",
        "_delete_app_stars",
        "_delete_recommended_apps",
        "_delete_app_annotation_data",
        "_delete_app_dataset_joins",
        "_delete_app_workflow_runs",
        "_delete_app_workflow_node_executions",
        "_delete_app_workflow_app_logs",
        "_delete_app_conversations",
        "_delete_app_messages",
        "_delete_workflow_tool_providers",
        "_delete_app_tag_bindings",
        "_delete_end_users",
        "_delete_trace_app_configs",
        "_delete_conversation_variables",
        "_delete_draft_variables",
        "_delete_app_triggers",
        "_delete_workflow_plugin_triggers",
        "_delete_workflow_webhook_triggers",
        "_delete_workflow_schedule_plans",
        "_delete_workflow_trigger_logs",
    )
    for name in other_cleanup_names:
        monkeypatch.setattr(remove_app_task_module, name, lambda *_args, **_kwargs: None)

    def delete_bindings(tenant_id: str, app_id: str) -> None:
        assert (tenant_id, app_id) == ("tenant-1", "app-1")
        events.append("bindings")

    def delete_workflows(tenant_id: str, app_id: str) -> None:
        assert (tenant_id, app_id) == ("tenant-1", "app-1")
        events.append("workflows")

    monkeypatch.setattr(remove_app_task_module, "_delete_workflow_agent_node_bindings", delete_bindings)
    monkeypatch.setattr(remove_app_task_module, "_delete_app_workflows", delete_workflows)

    remove_app_task_module.remove_app_and_related_data_task.run(tenant_id="tenant-1", app_id="app-1")

    assert events == ["bindings", "workflows"]


def test_app_cleanup_removes_legacy_workflow_tool_execution_before_its_owner_run(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    tenant_id = "tenant-1"
    app_id = "root-app"
    workflow_run_id = "legacy-run"
    execution_id = "legacy-tool-execution"
    apply_config_overrides(
        monkeypatch,
        DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY,
        API_WORKFLOW_NODE_EXECUTION_REPOSITORY=(
            "repositories.sqlalchemy_api_workflow_node_execution_repository."
            "DifyAPISQLAlchemyWorkflowNodeExecutionRepository"
        ),
        API_WORKFLOW_RUN_REPOSITORY=(
            "repositories.sqlalchemy_api_workflow_run_repository.DifyAPISQLAlchemyWorkflowRunRepository"
        ),
    )
    monkeypatch.setattr(
        type(remove_app_task_module.db),
        "engine",
        property(lambda _self: sqlite_session_factory.kw["bind"]),
    )
    monkeypatch.setattr(remove_app_task_module, "cleanup_app_storage", lambda *_args: None)
    for name in tuple(vars(remove_app_task_module)):
        if name.startswith("_delete_") and name not in {
            "_delete_app_workflow_node_executions",
            "_delete_app_workflow_runs",
        }:
            monkeypatch.setattr(remove_app_task_module, name, lambda *_args, **_kwargs: None)

    with sqlite_session_factory.begin() as session:
        session.add(
            WorkflowRun(
                id=workflow_run_id,
                tenant_id=tenant_id,
                app_id=app_id,
                workflow_id="root-workflow",
                type=WorkflowType.WORKFLOW,
                triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
                version="1",
                graph="{}",
                inputs="{}",
                status=WorkflowExecutionStatus.SUCCEEDED,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by="account-1",
            )
        )
        session.add(
            WorkflowNodeExecutionModel(
                id=execution_id,
                tenant_id=tenant_id,
                app_id="source-app",
                workflow_id="source-workflow",
                workflow_run_id=workflow_run_id,
                node_id="tool-node",
                node_type="tool",
                title="Legacy workflow tool",
                index=1,
                triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_TOOL,
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by="account-1",
                process_data=None,
            )
        )
        session.add(
            WorkflowNodeExecutionOffload(
                tenant_id=tenant_id,
                app_id="source-app",
                node_execution_id=execution_id,
                type_=ExecutionOffLoadType.PROCESS_DATA,
                file_id="offload-file-1",
            )
        )

    remove_app_task_module.remove_app_and_related_data_task.run(tenant_id=tenant_id, app_id=app_id)

    with sqlite_session_factory() as session:
        assert session.get(WorkflowNodeExecutionModel, execution_id) is None
        assert session.scalar(select(func.count()).select_from(WorkflowNodeExecutionOffload)) == 0
        assert session.get(WorkflowRun, workflow_run_id) is None


def test_cloud_app_cleanup_schedules_independent_binding_cleanup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    calls: list[tuple[dict[str, str], int]] = []

    def apply_async(*, kwargs: dict[str, str], countdown: int) -> None:
        calls.append((kwargs, countdown))

    monkeypatch.setattr(
        remove_app_task_module.cleanup_app_network_access_group_binding_task,
        "apply_async",
        apply_async,
    )

    remove_app_task_module._schedule_app_network_access_group_binding_cleanup("tenant-1", "app-1")

    assert calls == [({"tenant_id": "tenant-1", "app_id": "app-1"}, 10)]


def test_community_app_cleanup_does_not_schedule_binding_cleanup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
    calls: list[tuple[dict[str, str], int]] = []

    def apply_async(*, kwargs: dict[str, str], countdown: int) -> None:
        calls.append((kwargs, countdown))

    monkeypatch.setattr(
        remove_app_task_module.cleanup_app_network_access_group_binding_task,
        "apply_async",
        apply_async,
    )

    remove_app_task_module._schedule_app_network_access_group_binding_cleanup("tenant-1", "app-1")

    assert calls == []


def test_independent_binding_cleanup_task_succeeds(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    network_access_groups = _NetworkAccessGroups()
    application_services = _ApplicationServices(network_access_groups=network_access_groups)
    application_services_module = ModuleType("extensions.ext_application_services")
    application_services_module.application_services = lambda: application_services
    apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)

    with patch.dict(
        sys.modules,
        {"extensions.ext_application_services": application_services_module},
    ):
        remove_app_task_module.cleanup_app_network_access_group_binding_task.run(
            tenant_id="tenant-1",
            app_id="app-1",
        )

    assert network_access_groups.calls == [("tenant-1", "app-1")]
    assert remove_app_task_module.cleanup_app_network_access_group_binding_task.max_retries == 24


def test_independent_binding_cleanup_task_retries_with_exponential_backoff(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    upstream_error = NetworkAccessGroupUpstreamError(409, "NETWORK_ACCESS_APP_STILL_EXISTS")
    retry_error = RuntimeError("retry scheduled")
    network_access_groups = _NetworkAccessGroups(failure=upstream_error)
    application_services = _ApplicationServices(network_access_groups=network_access_groups)
    application_services_module = ModuleType("extensions.ext_application_services")
    application_services_module.application_services = lambda: application_services
    apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    retry_calls: list[tuple[Exception, int]] = []

    def retry(*, exc: Exception, countdown: int) -> None:
        retry_calls.append((exc, countdown))
        raise retry_error

    monkeypatch.setattr(
        remove_app_task_module.cleanup_app_network_access_group_binding_task,
        "retry",
        retry,
    )

    with (
        patch.dict(
            sys.modules,
            {"extensions.ext_application_services": application_services_module},
        ),
        pytest.raises(RuntimeError, match="retry scheduled"),
    ):
        remove_app_task_module.cleanup_app_network_access_group_binding_task.run(
            tenant_id="tenant-1",
            app_id="app-1",
        )

    assert retry_calls == [(upstream_error, 15)]
    assert remove_app_task_module._network_access_binding_cleanup_retry_delay(5) == 480
    assert remove_app_task_module._network_access_binding_cleanup_retry_delay(6) == 600
    assert remove_app_task_module._network_access_binding_cleanup_retry_delay(24) == 600


@pytest.mark.parametrize("failed_delete_number", [1, 2])
def test_app_cleanup_retries_remaining_model_configs_after_a_real_delete_failure(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    failed_delete_number: int,
) -> None:
    apply_config_overrides(
        monkeypatch,
        DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY,
    )
    # Keep the production task, lease and model-config batch helper real while
    # isolating unrelated cleanup owners from this database-failure regression.
    monkeypatch.setattr(remove_app_task_module, "cleanup_app_storage", lambda *_args: None)
    for name in tuple(vars(remove_app_task_module)):
        if name.startswith("_delete_") and name not in {"_delete_records", "_delete_app_model_configs"}:
            monkeypatch.setattr(remove_app_task_module, name, lambda *_args, **_kwargs: None)
    with sqlite_session_factory() as session:
        session.add_all(
            [AppModelConfig(app_id="app-1"), AppModelConfig(app_id="app-1"), AppModelConfig(app_id="other-app")]
        )
        session.commit()
        engine = session.get_bind()

    delete_attempts = 0

    def fail_model_config_delete(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        nonlocal delete_attempts
        if statement.startswith("DELETE FROM app_model_configs"):
            delete_attempts += 1
            if delete_attempts == failed_delete_number:
                raise RuntimeError("model config database unavailable")

    event.listen(engine, "before_cursor_execute", fail_model_config_delete)
    try:
        with pytest.raises(RuntimeError, match="model config database unavailable"):
            remove_app_task_module.remove_app_and_related_data_task.run(tenant_id="tenant-1", app_id="app-1")
    finally:
        event.remove(engine, "before_cursor_execute", fail_model_config_delete)

    with sqlite_session_factory() as session:
        assert (
            session.scalar(select(func.count()).select_from(AppModelConfig).where(AppModelConfig.app_id == "app-1"))
            == 3 - failed_delete_number
        )

    remove_app_task_module.remove_app_and_related_data_task.run(tenant_id="tenant-1", app_id="app-1")

    with sqlite_session_factory() as session:
        assert (
            session.scalar(select(func.count()).select_from(AppModelConfig).where(AppModelConfig.app_id == "app-1"))
            == 0
        )
        assert (
            session.scalar(select(func.count()).select_from(AppModelConfig).where(AppModelConfig.app_id == "other-app"))
            == 1
        )


class TestDeleteDraftVariablesBatch:
    def test_delete_draft_variables_batch_invalid_batch_size(self) -> None:
        """Test that invalid batch size raises ValueError."""
        app_id = "test-app-id"

        with pytest.raises(ValueError, match="batch_size must be positive"):
            delete_draft_variables_batch(app_id, -1)

        with pytest.raises(ValueError, match="batch_size must be positive"):
            delete_draft_variables_batch(app_id, 0)

    @patch("tasks.remove_app_and_related_data_task.delete_draft_variables_batch")
    def test_delete_draft_variables_calls_batch_function(self, mock_batch_delete: MagicMock) -> None:
        """Test that _delete_draft_variables calls the batch function correctly."""
        app_id = "test-app-id"
        expected_return = 42
        mock_batch_delete.return_value = expected_return

        result = _delete_draft_variables(app_id)

        assert result == expected_return
        mock_batch_delete.assert_called_once_with(app_id, batch_size=1000)


class _FakeResult:
    """Minimal stand-in for a SQLAlchemy ``Result``."""

    def __init__(self, rows: Sequence[Sequence[object]] = (), rowcount: int = 0) -> None:
        self._rows = [tuple(row) for row in rows]
        self.rowcount = rowcount

    def __iter__(self) -> Iterator[Sequence[object]]:
        return iter(self._rows)

    def all(self) -> list[Sequence[object]]:
        return list(self._rows)


class _FakeSession:
    def __init__(self, factory: "_FakeSessionFactory") -> None:
        self._factory = factory

    def execute(self, *_args: object, **_kwargs: object) -> _FakeResult:
        return self._factory.next_result()

    def begin(self) -> AbstractContextManager["_FakeSession"]:
        return _FakeTransactionContext(self._factory, self)


class _FakeTransactionContext:
    def __init__(self, factory: "_FakeSessionFactory", session: _FakeSession) -> None:
        self._factory = factory
        self._session = session

    def __enter__(self) -> _FakeSession:
        self._factory.open_count += 1
        return self._session

    def __exit__(self, *_exc_info: object) -> bool:
        self._factory.open_count -= 1
        return False


class _FakeSessionContext:
    def __init__(self, factory: "_FakeSessionFactory") -> None:
        self._factory = factory

    def __enter__(self) -> _FakeSession:
        self._factory.open_count += 1
        return _FakeSession(self._factory)

    def __exit__(self, *_exc_info: object) -> bool:
        self._factory.open_count -= 1
        return False


class _FakeSessionFactory:
    """Session factory stub that counts open sessions and hands out queued results.

    Lets the tests assert that object storage cleanup runs with no session open.
    """

    def __init__(self, results: list[_FakeResult] | None = None, *, failure: Exception | None = None) -> None:
        self._results = list(results or [])
        self._failure = failure
        self.open_count = 0
        self.open_count_at_storage_delete: list[int] = []

    def create_session(self) -> AbstractContextManager[_FakeSession]:
        return _FakeSessionContext(self)

    def next_result(self, *_args: object, **_kwargs: object) -> _FakeResult:
        if self._failure is not None:
            raise self._failure
        if self._results:
            return self._results.pop(0)
        return _FakeResult([])


class TestDeleteDraftVariableOffloadData:
    """Test the Offload data cleanup functionality."""

    def test_delete_draft_variable_offload_data_empty_file_ids(self) -> None:
        """An empty file_ids list must not open a session."""
        with patch("tasks.remove_app_and_related_data_task.session_factory") as mock_session_factory:
            result = _delete_draft_variable_offload_data([])

        assert result == 0
        mock_session_factory.create_session.assert_not_called()

    def test_storage_failure_preserves_owner_rows_and_missing_blob_retry_succeeds(
        self,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        app = make_app(app_id="app-1", tenant_id="tenant-1")
        upload = make_upload_file(file_id="upload-1", tenant_id="tenant-1", key="draft/offload.json")
        variable_file = WorkflowDraftVariableFile(
            tenant_id="tenant-1",
            app_id=app.id,
            user_id="account-1",
            upload_file_id=upload.id,
            size=128,
            length=8,
            value_type=SegmentType.STRING,
        )
        variable = WorkflowDraftVariable.new_node_variable(
            app_id=app.id,
            user_id="account-1",
            node_id="node-1",
            name="result",
            value=StringSegment(value="truncated"),
            node_execution_id="execution-1",
            file_id=variable_file.id,
        )
        with sqlite_session_factory.begin() as session:
            session.add_all([app, upload, variable_file, variable])

        monkeypatch.setattr(remove_app_task_module.session_factory, "create_session", sqlite_session_factory)
        cleanup_storage = _DeleteStorage(failures=[RuntimeError("storage unavailable")])
        monkeypatch.setattr("extensions.ext_storage.storage", cleanup_storage)

        with pytest.raises(RuntimeError, match="storage unavailable"):
            delete_draft_variables_batch(app.id, batch_size=10)

        with sqlite_session_factory() as session:
            assert session.get(WorkflowDraftVariable, variable.id) is not None
            assert session.get(WorkflowDraftVariableFile, variable_file.id) is not None
            persisted_upload = session.get(UploadFile, upload.id)
            assert persisted_upload is not None
            assert persisted_upload.key == upload.key

        cleanup_storage.failures.append(FileNotFoundError(upload.key))

        assert delete_draft_variables_batch(app.id, batch_size=10) == 1

        with sqlite_session_factory() as session:
            assert session.get(WorkflowDraftVariable, variable.id) is None
            assert session.get(WorkflowDraftVariableFile, variable_file.id) is None
            assert session.get(UploadFile, upload.id) is None
        assert cleanup_storage.deleted == [upload.key, upload.key]


class TestDeleteDraftVariablesBatchTransactionScope:
    """The batch loop must not hold a transaction while object storage is cleaned up."""

    def test_offload_cleanup_is_called_with_no_session_open(self, monkeypatch: pytest.MonkeyPatch) -> None:
        factory = _FakeSessionFactory([_FakeResult([("var-1", "vf-1")]), _FakeResult([], rowcount=1)])
        observed_open_counts: list[int] = []

        def _record_cleanup(file_ids: list[str]) -> int:
            observed_open_counts.append(factory.open_count)
            return len(file_ids)

        monkeypatch.setattr(remove_app_task_module, "session_factory", factory)
        monkeypatch.setattr(remove_app_task_module, "_delete_draft_variable_offload_data", _record_cleanup)

        total_deleted = delete_draft_variables_batch("app-1", batch_size=10)

        assert total_deleted == 1
        assert observed_open_counts == [0]
        assert factory.open_count == 0

    def test_rows_without_offloaded_files_skip_cleanup(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """A batch whose rows carry no file_id must not invoke the offload cleanup."""
        factory = _FakeSessionFactory([_FakeResult([("var-1", None)]), _FakeResult([], rowcount=1)])
        cleanup = MagicMock(return_value=0)

        monkeypatch.setattr(remove_app_task_module, "session_factory", factory)
        monkeypatch.setattr(remove_app_task_module, "_delete_draft_variable_offload_data", cleanup)

        total_deleted = delete_draft_variables_batch("app-1", batch_size=10)

        assert total_deleted == 1
        cleanup.assert_not_called()
        assert factory.open_count == 0


class TestDeleteWorkflowArchiveLogs:
    @pytest.mark.parametrize("sqlite_session", [(WorkflowArchiveLog,)], indirect=True)
    @patch("tasks.remove_app_and_related_data_task._delete_records")
    @patch("tasks.remove_app_and_related_data_task.db")
    def test_delete_app_workflow_archive_logs_calls_delete_records(
        self, mock_db: MagicMock, mock_delete_records: MagicMock, sqlite_session: Session
    ) -> None:
        tenant_id = "tenant-1"
        app_id = "app-1"

        _delete_app_workflow_archive_logs(tenant_id, app_id)

        mock_delete_records.assert_called_once()
        query_sql, params, delete_func, name = mock_delete_records.call_args[0]
        assert "workflow_archive_logs" in query_sql
        assert params == {"tenant_id": tenant_id, "app_id": app_id}
        assert name == "workflow archive log"

        archive_log = WorkflowArchiveLog(
            tenant_id=str(uuid4()),
            app_id=str(uuid4()),
            workflow_id=str(uuid4()),
            workflow_run_id=str(uuid4()),
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=str(uuid4()),
            log_id=None,
            log_created_at=None,
            log_created_from=None,
            run_version="1",
            run_status=WorkflowExecutionStatus.SUCCEEDED,
            run_triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
            run_error=None,
            run_elapsed_time=0,
            run_total_tokens=0,
            run_total_steps=1,
            run_created_at=datetime.now(UTC),
            run_finished_at=datetime.now(UTC),
            run_exceptions_count=0,
            trigger_metadata=None,
        )
        sqlite_session.add(archive_log)
        sqlite_session.commit()

        delete_func(sqlite_session, archive_log.id)
        sqlite_session.commit()
        sqlite_session.expunge_all()

        assert sqlite_session.get(WorkflowArchiveLog, archive_log.id) is None


class TestDeleteAppStars:
    @pytest.mark.parametrize("sqlite_session", [(AppStar,)], indirect=True)
    @patch("tasks.remove_app_and_related_data_task._delete_records")
    def test_delete_app_stars_calls_delete_records(
        self, mock_delete_records: MagicMock, sqlite_session: Session
    ) -> None:
        tenant_id = "tenant-1"
        app_id = "app-1"

        _delete_app_stars(tenant_id, app_id)

        mock_delete_records.assert_called_once()
        query_sql, params, delete_func, name = mock_delete_records.call_args[0]
        assert "app_stars" in query_sql
        assert params == {"tenant_id": tenant_id, "app_id": app_id}
        assert name == "app star"

        app_star = AppStar(tenant_id=str(uuid4()), app_id=str(uuid4()), account_id=str(uuid4()))
        sqlite_session.add(app_star)
        sqlite_session.commit()

        delete_func(sqlite_session, app_star.id)
        sqlite_session.commit()
        sqlite_session.expunge_all()

        assert sqlite_session.get(AppStar, app_star.id) is None


class TestDeleteArchivedWorkflowRunFiles:
    @patch("tasks.remove_app_and_related_data_task.get_archive_storage")
    def test_delete_archived_workflow_run_files_not_configured(
        self, mock_get_storage: MagicMock, caplog: pytest.LogCaptureFixture
    ) -> None:
        mock_get_storage.side_effect = ArchiveStorageNotConfiguredError("missing config")

        with (
            caplog.at_level(logging.ERROR, logger="tasks.remove_app_and_related_data_task"),
            pytest.raises(ArchiveStorageNotConfiguredError, match="missing config"),
        ):
            _delete_archived_workflow_run_files("tenant-1", "app-1")

        assert caplog.text.count("Archive storage not configured") == 1

    @patch("tasks.remove_app_and_related_data_task.get_archive_storage")
    def test_delete_archived_workflow_run_files_list_failure(
        self, mock_get_storage: MagicMock, caplog: pytest.LogCaptureFixture
    ) -> None:
        storage = _ArchiveStorage(list_failure=Exception("list failed"))
        mock_get_storage.return_value = storage

        with (
            caplog.at_level(logging.ERROR, logger="tasks.remove_app_and_related_data_task"),
            pytest.raises(Exception, match="list failed"),
        ):
            _delete_archived_workflow_run_files("tenant-1", "app-1")

        assert storage.listed == ["tenant-1/app_id=app-1/"]
        assert storage.deleted == []
        assert "Failed to list archive files for app app-1" in caplog.text

    @patch("tasks.remove_app_and_related_data_task.get_archive_storage")
    def test_delete_archived_workflow_run_files_propagates_partial_delete_failure(
        self, mock_get_storage: MagicMock
    ) -> None:
        storage = _ArchiveStorage(
            keys=["key-1", "key-2"],
            delete_failures=[None, RuntimeError("archive delete failed")],
        )
        mock_get_storage.return_value = storage

        with pytest.raises(RuntimeError, match="archive delete failed"):
            _delete_archived_workflow_run_files("tenant-1", "app-1")

        assert storage.deleted == ["key-1", "key-2"]

    @patch("tasks.remove_app_and_related_data_task.get_archive_storage")
    def test_delete_archived_workflow_run_files_success(
        self, mock_get_storage: MagicMock, caplog: pytest.LogCaptureFixture
    ) -> None:
        storage = _ArchiveStorage(keys=["key-1", "key-2"])
        mock_get_storage.return_value = storage

        with caplog.at_level(logging.INFO, logger="tasks.remove_app_and_related_data_task"):
            _delete_archived_workflow_run_files("tenant-1", "app-1")

        assert storage.listed == ["tenant-1/app_id=app-1/"]
        assert storage.deleted == ["key-1", "key-2"]
        assert "Deleted 2 archive objects for app app-1" in caplog.text
