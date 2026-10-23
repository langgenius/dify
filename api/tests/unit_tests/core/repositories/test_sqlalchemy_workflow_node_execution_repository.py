from __future__ import annotations

import json
import logging
from collections.abc import Callable, Generator, Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from unittest.mock import Mock

import psycopg2.errors
import pytest
from sqlalchemy import Engine, event, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.repositories.celery_workflow_node_execution_repository import CeleryWorkflowNodeExecutionRepository
from core.repositories.factory import OrderConfig
from core.repositories.sqlalchemy_workflow_node_execution_repository import (
    SQLAlchemyWorkflowNodeExecutionRepository,
    _deterministic_json_dump,
    _filter_by_offload_type,
    _find_first,
    _replace_or_append_offload,
)
from core.workflow.node_execution_process_data import WORKFLOW_TOOL_ROOT_APP_ID_KEY
from graphon.entities import (
    WorkflowNodeExecution as _sqlalchemy_workflow_node_execution_repository_WorkflowNodeExecution,
)
from graphon.entities.workflow_node_execution import (
    WorkflowNodeExecution as _workflow_node_execution_conflict_handling_WorkflowNodeExecution,
)
from graphon.entities.workflow_node_execution import (
    WorkflowNodeExecution as _workflow_node_execution_truncation_WorkflowNodeExecution,
)
from graphon.entities.workflow_node_execution import (
    WorkflowNodeExecutionStatus as _ConflictExecutionStatus,
)
from graphon.entities.workflow_node_execution import (
    WorkflowNodeExecutionStatus as _workflow_node_execution_truncation_WorkflowNodeExecutionStatus,
)
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionMetadataKey
from graphon.enums import (
    WorkflowNodeExecutionStatus as _RepositoryExecutionStatus,
)
from libs.datetime_utils import naive_utc_now
from models import Account, EndUser, Tenant
from models import WorkflowNodeExecutionModel as _workflow_node_execution_conflict_handling_WorkflowNodeExecutionModel
from models import (
    WorkflowNodeExecutionTriggeredFrom as _workflow_node_execution_conflict_handling_WorkflowNodeExecutionTriggeredFrom,
)
from models import (
    WorkflowNodeExecutionTriggeredFrom as _workflow_node_execution_truncation_WorkflowNodeExecutionTriggeredFrom,
)
from models.enums import CreatorUserRole, ExecutionOffLoadType
from models.model import UploadFile
from models.workflow import (
    WorkflowNodeExecutionModel as _sqlalchemy_workflow_node_execution_repository_WorkflowNodeExecutionModel,
)
from models.workflow import WorkflowNodeExecutionModel as _workflow_node_execution_truncation_WorkflowNodeExecutionModel
from models.workflow import WorkflowNodeExecutionOffload
from models.workflow import (
    WorkflowNodeExecutionTriggeredFrom as _RepositoryTriggeredFrom,
)
from tests.helpers.unit.model_factories import make_account, make_tenant, make_upload_file

"""SQLite-backed tests for the workflow node execution repository."""


def _sqlalchemy_workflow_node_execution_repository_account(
    *, tenant_id: str = "tenant-1", user_id: str = "user-1"
) -> Account:
    return make_account(
        account_id=user_id,
        name="Test Account",
        email="test@example.com",
        tenant=make_tenant(tenant_id=tenant_id, name="Test Tenant"),
    )


def _end_user(*, tenant_id: str = "tenant-1", user_id: str = "end-user-1") -> EndUser:
    return EndUser(id=user_id, tenant_id=tenant_id)


def _upload_file(*, key: str = "storage-key") -> UploadFile:
    return make_upload_file(
        key=key,
        name="offload.json",
        size=1,
        extension="json",
        mime_type="application/json",
        created_by="user-1",
        created_at=datetime.now(UTC),
    )


def _offload(type_: ExecutionOffLoadType, *, file_id: str = "file-1") -> WorkflowNodeExecutionOffload:
    return WorkflowNodeExecutionOffload(
        tenant_id="tenant-1",
        app_id="app-1",
        node_execution_id="execution-1",
        type_=type_,
        file_id=file_id,
    )


def _sqlalchemy_workflow_node_execution_repository_execution(
    *,
    execution_id: str = "execution-1",
    node_execution_id: str = "node-execution-1",
    run_id: str = "run-1",
    index: int = 1,
    status: _RepositoryExecutionStatus = _RepositoryExecutionStatus.SUCCEEDED,
    inputs: Mapping[str, Any] | None = None,
    outputs: Mapping[str, Any] | None = None,
    process_data: Mapping[str, Any] | None = None,
) -> _sqlalchemy_workflow_node_execution_repository_WorkflowNodeExecution:
    return _sqlalchemy_workflow_node_execution_repository_WorkflowNodeExecution(
        id=execution_id,
        node_execution_id=node_execution_id,
        workflow_id="workflow-1",
        workflow_execution_id=run_id,
        index=index,
        predecessor_node_id=None,
        node_id=f"node-{index}",
        node_type=BuiltinNodeTypes.LLM,
        title=f"Node {index}",
        inputs=inputs,
        outputs=outputs,
        process_data=process_data,
        status=status,
        error=None,
        elapsed_time=1.0,
        metadata={WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: index},
        created_at=datetime.now(UTC),
        finished_at=None,
    )


def _repository(
    monkeypatch: pytest.MonkeyPatch,
    factory: sessionmaker[Session] | Engine,
    *,
    tenant_id: str = "tenant-1",
    app_id: str | None = "app-1",
    user: Account | EndUser | None = None,
    triggered_from: _RepositoryTriggeredFrom | None = _RepositoryTriggeredFrom.WORKFLOW_RUN,
) -> SQLAlchemyWorkflowNodeExecutionRepository:
    monkeypatch.setattr(
        "core.repositories.sqlalchemy_workflow_node_execution_repository.FileService",
        lambda *_args: SimpleNamespace(upload_file=Mock()),
    )
    return SQLAlchemyWorkflowNodeExecutionRepository(
        session_factory=factory,
        tenant_id=tenant_id,
        user=user or _sqlalchemy_workflow_node_execution_repository_account(tenant_id=tenant_id),
        app_id=app_id,
        triggered_from=triggered_from,
    )


@contextmanager
def _raise_on_execution_insert(engine: Engine) -> Generator[None]:
    def raise_error(
        _conn: Any,
        _cursor: Any,
        statement: str,
        _parameters: Any,
        _context: Any,
        _executemany: Any,
    ) -> None:
        if statement.lstrip().upper().startswith("INSERT") and "workflow_node_executions" in statement:
            raise RuntimeError("forced execution INSERT")

    event.listen(engine, "before_cursor_execute", raise_error)
    try:
        yield
    finally:
        event.remove(engine, "before_cursor_execute", raise_error)


class TestSqlalchemyWorkflowNodeExecutionRepositoryCases:
    @staticmethod
    def test_init_accepts_real_engine_and_sessionmaker_and_sets_role(
        monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        engine_repo = _repository(monkeypatch, sqlite_engine)
        assert isinstance(engine_repo._session_factory, sessionmaker)
        end_user_repo = _repository(monkeypatch, sqlite_session_factory, user=_end_user())
        assert end_user_repo._creator_user_role.value == "end_user"

    @staticmethod
    @pytest.mark.parametrize("source_app", ["app-1", "source-app"])
    def test_workflow_tool_scope_isolates_execution_history_with_same_tenant_and_creator(
        monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session], source_app: str
    ) -> None:
        caller = _repository(monkeypatch, sqlite_session_factory, user=_end_user())
        source = caller.for_workflow_tool(source_app)
        caller.save_synchronously(
            _sqlalchemy_workflow_node_execution_repository_execution(execution_id="caller", node_execution_id="caller")
        )
        source.save_synchronously(
            _sqlalchemy_workflow_node_execution_repository_execution(execution_id="source", node_execution_id="source")
        )

        assert [node.id for node in caller.get_by_workflow_execution("run-1")] == ["caller"]
        assert [node.id for node in source.get_by_workflow_execution("run-1")] == ["source"]
        with sqlite_session_factory() as session:
            row = session.get(_sqlalchemy_workflow_node_execution_repository_WorkflowNodeExecutionModel, "source")
            assert row is not None
            assert (row.tenant_id, row.app_id, row.created_by, row.created_by_role, row.triggered_from) == (
                "tenant-1",
                source_app,
                "end-user-1",
                CreatorUserRole.END_USER,
                _RepositoryTriggeredFrom.WORKFLOW_TOOL,
            )

    @staticmethod
    def test_init_rejects_invalid_factory_and_missing_tenant(monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            "core.repositories.sqlalchemy_workflow_node_execution_repository.FileService",
            lambda *_args: SimpleNamespace(upload_file=Mock()),
        )
        with pytest.raises(ValueError, match="Invalid session_factory type"):
            SQLAlchemyWorkflowNodeExecutionRepository(
                session_factory=object(),  # type: ignore[arg-type]
                tenant_id="tenant-1",
                user=_sqlalchemy_workflow_node_execution_repository_account(),
                app_id=None,
                triggered_from=_RepositoryTriggeredFrom.WORKFLOW_RUN,
            )
        user = _sqlalchemy_workflow_node_execution_repository_account()
        user._current_tenant = None
        with pytest.raises(ValueError, match="tenant_id"):
            SQLAlchemyWorkflowNodeExecutionRepository(
                session_factory=sessionmaker(),
                tenant_id="",
                user=user,
                app_id=None,
                triggered_from=_RepositoryTriggeredFrom.WORKFLOW_RUN,
            )

    @staticmethod
    def test_init_uses_resource_tenant_when_account_has_no_current_tenant(
        monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        user = _sqlalchemy_workflow_node_execution_repository_account()
        user._current_tenant = None

        repo = _repository(
            monkeypatch,
            sqlite_session_factory,
            tenant_id="resource-tenant",
            user=user,
        )

        assert repo._tenant_id == "resource-tenant"
        assert repo._creator_user_id == user.id

    @staticmethod
    def test_helper_functions_and_truncator_configuration(
        monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        assert _deterministic_json_dump({"b": 1, "a": 2}) == '{"a": 2, "b": 1}'
        assert _find_first([], lambda _value: True) is None
        assert _find_first([1, 2, 3], lambda value: value > 1) == 2
        inputs = _offload(ExecutionOffLoadType.INPUTS)
        outputs = _offload(ExecutionOffLoadType.OUTPUTS)
        assert _find_first([inputs, outputs], _filter_by_offload_type(ExecutionOffLoadType.OUTPUTS)) is outputs
        replaced = _replace_or_append_offload([inputs, outputs], _offload(ExecutionOffLoadType.INPUTS))
        assert [item.type_ for item in replaced] == [ExecutionOffLoadType.OUTPUTS, ExecutionOffLoadType.INPUTS]

        created: dict[str, int] = {}

        class Truncator:
            def __init__(self, *, max_size_bytes: int, array_element_limit: int, string_length_limit: int) -> None:
                created.update(
                    max_size_bytes=max_size_bytes,
                    array_element_limit=array_element_limit,
                    string_length_limit=string_length_limit,
                )

        monkeypatch.setattr(
            "core.repositories.sqlalchemy_workflow_node_execution_repository.VariableTruncator", Truncator
        )
        _repository(monkeypatch, sqlite_session_factory)._create_truncator()
        assert created["max_size_bytes"] == dify_config.WORKFLOW_VARIABLE_TRUNCATION_MAX_SIZE

    @staticmethod
    def test_to_db_model_uses_context_and_deterministic_json(
        monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        repo = _repository(monkeypatch, sqlite_session_factory)
        db_model = repo._to_db_model(
            _sqlalchemy_workflow_node_execution_repository_execution(
                inputs={"b": 1, "a": 2},
                process_data={"agent_workspace_binding_id": "participant-1"},
            )
        )
        assert json.loads(db_model.inputs or "{}") == {"a": 2, "b": 1}
        assert db_model.tenant_id == "tenant-1"
        assert db_model.app_id == "app-1"
        assert db_model.created_by == "user-1"
        assert db_model.created_by_role == CreatorUserRole.ACCOUNT
        assert json.loads(db_model.execution_metadata or "{}") == {"total_tokens": 1}
        assert db_model.agent_workspace_binding_id is None
        assert (
            _repository(monkeypatch, sqlite_session_factory, app_id=None)
            ._to_db_model(_sqlalchemy_workflow_node_execution_repository_execution())
            .app_id
            is None
        )
        repo._triggered_from = None
        with pytest.raises(ValueError, match="triggered_from is required"):
            repo._to_db_model(_sqlalchemy_workflow_node_execution_repository_execution())

    @staticmethod
    def test_to_db_model_requires_creator_context(
        monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        repo = _repository(monkeypatch, sqlite_session_factory)
        execution = _sqlalchemy_workflow_node_execution_repository_execution()

        monkeypatch.setattr(repo, "_creator_user_id", None)
        with pytest.raises(ValueError, match="created_by is required"):
            repo._to_db_model(execution)

        monkeypatch.setattr(repo, "_creator_user_id", "user-1")
        monkeypatch.setattr(repo, "_creator_user_role", None)
        with pytest.raises(ValueError, match="created_by_role is required"):
            repo._to_db_model(execution)

    @staticmethod
    def test_json_encode_uses_runtime_converter(monkeypatch: pytest.MonkeyPatch) -> None:
        class Converter:
            def to_json_encodable(self, values: Mapping[str, Any]) -> Mapping[str, Any]:
                return {"wrapped": values["value"]}

        monkeypatch.setattr(
            "core.repositories.sqlalchemy_workflow_node_execution_repository.WorkflowRuntimeTypeConverter",
            Converter,
        )

        assert SQLAlchemyWorkflowNodeExecutionRepository._json_encode({"value": 1}) == '{"wrapped": 1}'

    @staticmethod
    def test_save_inserts_and_updates_persisted_execution(
        monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        repo = _repository(monkeypatch, sqlite_session_factory)
        execution = _sqlalchemy_workflow_node_execution_repository_execution(
            inputs={"value": 1}, outputs={"result": "first"}
        )
        repo.save(execution)
        with sqlite_session_factory() as session:
            persisted = session.get(
                _sqlalchemy_workflow_node_execution_repository_WorkflowNodeExecutionModel, execution.id
            )
            assert persisted is not None
            assert persisted.outputs_dict == {"result": "first"}
        execution.title = "Updated"
        execution.outputs = {"result": "second"}
        repo.save(execution)
        with sqlite_session_factory() as session:
            persisted = session.get(
                _sqlalchemy_workflow_node_execution_repository_WorkflowNodeExecutionModel, execution.id
            )
            assert persisted is not None
            assert persisted.title == "Updated"
            assert persisted.outputs_dict == {"result": "second"}
        assert execution.node_execution_id is not None
        assert repo._node_execution_cache[execution.node_execution_id].id == execution.id

    @staticmethod
    def test_save_owned_session_rolls_back_failed_insert(
        monkeypatch: pytest.MonkeyPatch,
        sqlite_engine: Engine,
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        repo = _repository(monkeypatch, sqlite_session_factory)
        with _raise_on_execution_insert(sqlite_engine), pytest.raises(RuntimeError, match="forced execution INSERT"):
            repo.save(_sqlalchemy_workflow_node_execution_repository_execution())
        with sqlite_session_factory() as session:
            assert (
                session.scalar(select(_sqlalchemy_workflow_node_execution_repository_WorkflowNodeExecutionModel))
                is None
            )

    @staticmethod
    def test_save_execution_data_updates_existing_and_creates_missing(
        monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        repo = _repository(monkeypatch, sqlite_session_factory)
        existing = _sqlalchemy_workflow_node_execution_repository_execution(
            inputs={"initial": True},
            process_data={
                "workflow_agent_binding_id": "binding-1",
                "workflow_tool_invocation_id": "tool-call-1",
                "workflow_tool_root_app_id": "root-app",
            },
        )
        repo.save(existing)
        existing.inputs = {"updated": True}
        existing.outputs = {"result": 2}
        existing.process_data = {"step": 3}
        monkeypatch.setattr(repo, "_truncate_and_upload", lambda *_args, **_kwargs: None)
        repo.save_execution_data(existing)
        with sqlite_session_factory() as session:
            persisted = session.get(
                _sqlalchemy_workflow_node_execution_repository_WorkflowNodeExecutionModel, existing.id
            )
            assert persisted is not None
            assert persisted.inputs_dict == {"updated": True}
            assert persisted.outputs_dict == {"result": 2}
            assert persisted.process_data_dict == {
                "step": 3,
                "workflow_agent_binding_id": "binding-1",
                "workflow_tool_invocation_id": "tool-call-1",
                "workflow_tool_root_app_id": "root-app",
            }

        missing = _sqlalchemy_workflow_node_execution_repository_execution(
            execution_id="missing", node_execution_id="missing-node", inputs={"new": True}
        )
        repo.save_execution_data(missing)
        with sqlite_session_factory() as session:
            persisted = session.get(
                _sqlalchemy_workflow_node_execution_repository_WorkflowNodeExecutionModel, missing.id
            )
            assert persisted is not None
            assert persisted.inputs_dict == {"new": True}

    @staticmethod
    @pytest.mark.parametrize(
        ("execution_factory", "offload_type", "read_persisted", "read_truncated"),
        [
            (
                lambda: _sqlalchemy_workflow_node_execution_repository_execution(inputs={"large": "value"}),
                ExecutionOffLoadType.INPUTS,
                lambda model: model.inputs_dict,
                lambda execution: execution.get_truncated_inputs(),
            ),
            (
                lambda: _sqlalchemy_workflow_node_execution_repository_execution(outputs={"large": "value"}),
                ExecutionOffLoadType.OUTPUTS,
                lambda model: model.outputs_dict,
                lambda execution: execution.get_truncated_outputs(),
            ),
            (
                lambda: _sqlalchemy_workflow_node_execution_repository_execution(process_data={"large": "value"}),
                ExecutionOffLoadType.PROCESS_DATA,
                lambda model: model.process_data_dict,
                lambda execution: execution.get_truncated_process_data(),
            ),
        ],
    )
    def test_save_execution_data_persists_each_truncation_offload(
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session_factory: sessionmaker[Session],
        execution_factory: Callable[[], _sqlalchemy_workflow_node_execution_repository_WorkflowNodeExecution],
        offload_type: ExecutionOffLoadType,
        read_persisted: Callable[
            [_sqlalchemy_workflow_node_execution_repository_WorkflowNodeExecutionModel], Mapping[str, Any] | None
        ],
        read_truncated: Callable[
            [_sqlalchemy_workflow_node_execution_repository_WorkflowNodeExecution], Mapping[str, Any] | None
        ],
    ) -> None:
        repo = _repository(monkeypatch, sqlite_session_factory)
        execution = execution_factory()
        repo.save(execution)
        offload = WorkflowNodeExecutionOffload(
            tenant_id="tenant-1",
            app_id="app-1",
            node_execution_id=execution.id,
            type_=offload_type,
            file_id="file-1",
        )
        result = SimpleNamespace(truncated_value={"large": "truncated"}, offload=offload)
        monkeypatch.setattr(repo, "_truncate_and_upload", lambda values, *_args: result if values else None)
        repo.save_execution_data(execution)
        with sqlite_session_factory() as session:
            persisted = session.get(
                _sqlalchemy_workflow_node_execution_repository_WorkflowNodeExecutionModel, execution.id
            )
            assert persisted is not None
            assert read_persisted(persisted) == {"large": "truncated"}
            offloads = session.scalars(
                select(WorkflowNodeExecutionOffload).where(
                    WorkflowNodeExecutionOffload.node_execution_id == execution.id
                )
            ).all()
            assert [item.type_ for item in offloads] == [offload_type]
        assert read_truncated(execution) == {"large": "truncated"}

    @staticmethod
    def test_get_by_workflow_run_filters_tenant_app_trigger_and_paused_and_orders(
        monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        repo = _repository(monkeypatch, sqlite_session_factory)
        repo.save(
            _sqlalchemy_workflow_node_execution_repository_execution(
                execution_id="two", node_execution_id="node-two", index=2
            )
        )
        repo.save(
            _sqlalchemy_workflow_node_execution_repository_execution(
                execution_id="one", node_execution_id="node-one", index=1
            )
        )
        repo.save(
            _sqlalchemy_workflow_node_execution_repository_execution(
                execution_id="paused",
                node_execution_id="node-paused",
                index=3,
                status=_RepositoryExecutionStatus.PAUSED,
            )
        )
        _repository(monkeypatch, sqlite_session_factory, tenant_id="tenant-2").save(
            _sqlalchemy_workflow_node_execution_repository_execution(
                execution_id="foreign-tenant", node_execution_id="foreign-tenant"
            )
        )
        _repository(monkeypatch, sqlite_session_factory, app_id="app-2").save(
            _sqlalchemy_workflow_node_execution_repository_execution(
                execution_id="foreign-app", node_execution_id="foreign-app"
            )
        )
        _repository(
            monkeypatch,
            sqlite_session_factory,
            triggered_from=_RepositoryTriggeredFrom.SINGLE_STEP,
        ).save(
            _sqlalchemy_workflow_node_execution_repository_execution(
                execution_id="single-step", node_execution_id="single-step"
            )
        )

        models = repo.get_db_models_by_workflow_run(
            "run-1",
            OrderConfig(order_by=["missing", "index"], order_direction="desc"),
        )
        assert [model.id for model in models] == ["two", "one"]
        assert set(repo._node_execution_cache) >= {"node-one", "node-two"}
        assert repo.get_db_models_by_workflow_run("missing-run") == []
        no_app_repo = _repository(monkeypatch, sqlite_session_factory, app_id=None)
        assert (
            no_app_repo.get_db_models_by_workflow_run(
                "missing-run",
                OrderConfig(order_by=["missing"], order_direction="asc"),
            )
            == []
        )

    @staticmethod
    def test_get_by_workflow_execution_maps_real_rows_to_domain(
        monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        repo = _repository(monkeypatch, sqlite_session_factory)
        repo.save(_sqlalchemy_workflow_node_execution_repository_execution(inputs={"input": 1}, outputs={"output": 2}))
        domains = repo.get_by_workflow_execution("run-1", OrderConfig(order_by=["index"], order_direction="asc"))
        assert len(domains) == 1
        assert domains[0].inputs == {"input": 1}
        assert domains[0].outputs == {"output": 2}

    @staticmethod
    @pytest.mark.parametrize(
        "repository_type", [SQLAlchemyWorkflowNodeExecutionRepository, CeleryWorkflowNodeExecutionRepository]
    )
    def test_resume_history_includes_paused_nodes_without_changing_default_reads(
        sqlite_session_factory: sessionmaker[Session],
        repository_type: type[SQLAlchemyWorkflowNodeExecutionRepository | CeleryWorkflowNodeExecutionRepository],
    ) -> None:
        user = _sqlalchemy_workflow_node_execution_repository_account()
        writer = SQLAlchemyWorkflowNodeExecutionRepository(
            sqlite_session_factory,
            tenant_id="tenant-1",
            user=user,
            app_id="app-1",
            triggered_from=_RepositoryTriggeredFrom.WORKFLOW_RUN,
        )
        writer.save_synchronously(
            _sqlalchemy_workflow_node_execution_repository_execution(
                execution_id="finished", node_execution_id="finished"
            )
        )
        paused = _sqlalchemy_workflow_node_execution_repository_execution(
            execution_id="paused",
            node_execution_id="paused",
            status=_RepositoryExecutionStatus.PAUSED,
        )
        writer.save_synchronously(paused)
        writer.for_workflow_tool("app-1").save_synchronously(
            paused.model_copy(update={"id": "source-paused", "node_execution_id": "source-paused"})
        )
        reader = repository_type(
            sqlite_session_factory,
            tenant_id="tenant-1",
            user=user,
            app_id="app-1",
            triggered_from=_RepositoryTriggeredFrom.WORKFLOW_RUN,
        )
        source_reader = reader.for_workflow_tool("app-1")
        assert {node.id for node in reader.get_by_workflow_execution("run-1")} == {"finished"}
        assert source_reader.get_by_workflow_execution("run-1") == []
        assert {node.id for node in reader.get_by_workflow_execution("run-1", include_paused=True)} == {
            "finished",
            "paused",
        }
        assert {node.id for node in source_reader.get_by_workflow_execution("run-1", include_paused=True)} == {
            "source-paused"
        }
        assert {node.id for node in reader.get_by_workflow_execution("run-1")} == {"finished"}
        assert source_reader.get_by_workflow_execution("run-1") == []

    @staticmethod
    def test_run_reads_keep_workflow_tool_internals_in_their_source_scope(
        monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        caller = _repository(monkeypatch, sqlite_session_factory)
        caller.save(
            _sqlalchemy_workflow_node_execution_repository_execution(execution_id="root", node_execution_id="root")
        )
        for execution_id, tenant_id, app_id, root_app_id, run_id, origin in (
            (
                "child",
                "tenant-1",
                "source-app",
                "app-1",
                "run-1",
                _RepositoryTriggeredFrom.WORKFLOW_TOOL,
            ),
            (
                "same-app",
                "tenant-1",
                "app-1",
                "app-1",
                "run-1",
                _RepositoryTriggeredFrom.WORKFLOW_TOOL,
            ),
            (
                "foreign-root",
                "tenant-1",
                "source-app",
                "app-2",
                "run-1",
                _RepositoryTriggeredFrom.WORKFLOW_TOOL,
            ),
            (
                "foreign-tenant",
                "tenant-2",
                "source-app",
                "app-1",
                "run-1",
                _RepositoryTriggeredFrom.WORKFLOW_TOOL,
            ),
            (
                "foreign-run",
                "tenant-1",
                "source-app",
                "app-1",
                "run-2",
                _RepositoryTriggeredFrom.WORKFLOW_TOOL,
            ),
            (
                "foreign-app",
                "tenant-1",
                "source-app",
                "app-1",
                "run-1",
                _RepositoryTriggeredFrom.WORKFLOW_RUN,
            ),
        ):
            _repository(
                monkeypatch, sqlite_session_factory, tenant_id=tenant_id, app_id=app_id, triggered_from=origin
            ).save(
                _sqlalchemy_workflow_node_execution_repository_execution(
                    execution_id=execution_id,
                    node_execution_id=execution_id,
                    run_id=run_id,
                    process_data={WORKFLOW_TOOL_ROOT_APP_ID_KEY: root_app_id},
                )
            )
        assert [node.id for node in caller.get_by_workflow_execution("run-1")] == ["root"]
        source = caller.for_workflow_tool("source-app")
        assert {node.id for node in source.get_by_workflow_execution("run-1")} == {"child", "foreign-root"}

    @staticmethod
    def test_to_domain_model_loads_offloaded_storage(
        monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        repo = _repository(monkeypatch, sqlite_session_factory)
        db_model = repo._to_db_model(
            _sqlalchemy_workflow_node_execution_repository_execution(
                inputs={"truncated": "inputs"},
                outputs={"truncated": "outputs"},
                process_data={"truncated": "process_data"},
            )
        )
        offloads = []
        for offload_type in ExecutionOffLoadType:
            offload = _offload(offload_type)
            offload.file = _upload_file(key=offload_type.value)
            offloads.append(offload)
        db_model.offload_data = offloads
        monkeypatch.setattr(
            "core.repositories.sqlalchemy_workflow_node_execution_repository.storage.load",
            lambda key: json.dumps({"full": key}).encode(),
        )
        domain = repo._to_domain_model(db_model)
        assert domain.inputs == {"full": "inputs"}
        assert domain.outputs == {"full": "outputs"}
        assert domain.process_data == {"full": "process_data"}
        assert domain.get_truncated_inputs() == {"truncated": "inputs"}
        assert domain.get_truncated_outputs() == {"truncated": "outputs"}
        assert domain.get_truncated_process_data() == {"truncated": "process_data"}

    @staticmethod
    def test_truncate_and_upload_keeps_file_boundary_mocked(
        monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        uploaded = _upload_file(key="file-key")
        uploaded.id = "file-1"
        repo = _repository(monkeypatch, sqlite_session_factory)
        upload_file = Mock(return_value=uploaded)
        monkeypatch.setattr(repo._file_service, "upload_file", upload_file)

        class Truncator:
            def truncate_variable_mapping(self, _value: Any) -> tuple[dict[str, bool], bool]:
                return {"truncated": True}, True

        monkeypatch.setattr(repo, "_create_truncator", lambda: Truncator())
        result = repo._truncate_and_upload({"value": 1}, "execution-1", ExecutionOffLoadType.INPUTS)
        assert result is not None
        assert result.truncated_value == {"truncated": True}
        upload_file.assert_called_once_with(
            filename="node_execution_execution-1_inputs.json",
            content=b'{"value": 1}',
            mimetype="application/json",
            user=repo._user,
            tenant_id="tenant-1",
        )
        assert result.offload.file_id == "file-1"
        assert result.offload.type_ == ExecutionOffLoadType.INPUTS
        assert result.offload.tenant_id == "tenant-1"
        assert result.offload.app_id == "app-1"
        assert result.offload.node_execution_id == "execution-1"

    @staticmethod
    def test_truncate_and_upload_returns_none_for_missing_or_small_values(
        monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        repo = _repository(monkeypatch, sqlite_session_factory)
        assert repo._truncate_and_upload(None, "execution-1", ExecutionOffLoadType.INPUTS) is None

        class Truncator:
            def truncate_variable_mapping(self, value: Mapping[str, Any]) -> tuple[Mapping[str, Any], bool]:
                return value, False

        monkeypatch.setattr(repo, "_create_truncator", lambda: Truncator())
        assert repo._truncate_and_upload({"value": 1}, "execution-1", ExecutionOffLoadType.INPUTS) is None

    @staticmethod
    def test_duplicate_detection_and_id_regeneration(
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        repo = _repository(monkeypatch, sqlite_session_factory)
        duplicate = IntegrityError("duplicate", params=None, orig=psycopg2.errors.UniqueViolation("duplicate key"))
        assert repo._is_duplicate_key_error(duplicate)
        assert not repo._is_duplicate_key_error(IntegrityError("other", params=None, orig=Exception("other")))
        execution = _sqlalchemy_workflow_node_execution_repository_execution(execution_id="old")
        db_model = repo._to_db_model(execution)
        monkeypatch.setattr("core.repositories.sqlalchemy_workflow_node_execution_repository.uuidv7", lambda: "new")
        caplog.set_level(logging.WARNING)
        repo._regenerate_id_on_duplicate(execution, db_model)
        assert execution.id == db_model.id == "new"
        assert "Duplicate key conflict" in caplog.text

    @staticmethod
    def test_save_retries_postgres_duplicate_key(
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        repo = _repository(monkeypatch, sqlite_session_factory)
        execution = _sqlalchemy_workflow_node_execution_repository_execution(execution_id="old")
        duplicate = IntegrityError(
            "duplicate",
            params=None,
            orig=psycopg2.errors.UniqueViolation("duplicate key"),
        )
        persist = Mock(side_effect=[duplicate, None])
        monkeypatch.setattr(repo, "_persist_to_database", persist)
        monkeypatch.setattr("core.repositories.sqlalchemy_workflow_node_execution_repository.uuidv7", lambda: "new")

        repo.save(execution)

        assert persist.call_count == 2
        assert execution.id == "new"
        assert execution.node_execution_id is not None
        assert repo._node_execution_cache[execution.node_execution_id].id == "new"

    @staticmethod
    def test_save_logs_and_reraises_non_duplicate_and_unexpected_errors(
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        repo = _repository(monkeypatch, sqlite_session_factory)
        non_duplicate = IntegrityError("other", params=None, orig=Exception("constraint"))
        monkeypatch.setattr(repo, "_persist_to_database", Mock(side_effect=non_duplicate))
        caplog.set_level(logging.ERROR)

        with pytest.raises(IntegrityError):
            repo.save(_sqlalchemy_workflow_node_execution_repository_execution())
        assert "Non-duplicate key integrity error" in caplog.text

        caplog.clear()
        monkeypatch.setattr(repo, "_persist_to_database", Mock(side_effect=RuntimeError("boom")))
        with pytest.raises(RuntimeError, match="boom"):
            repo.save(_sqlalchemy_workflow_node_execution_repository_execution(execution_id="unexpected"))
        assert "Failed to save workflow node execution" in caplog.text


"""Unit tests for workflow node execution conflict handling."""


@dataclass(frozen=True)
class ConflictDatabase:
    engine: Engine
    session: Session
    session_factory: sessionmaker[Session]


@dataclass(frozen=True)
class ConflictEvents:
    insert_attempts: list[str]
    rollbacks: list[bool]


def _workflow_node_execution_conflict_handling_account() -> Account:
    return make_account(
        account_id="test-user-id",
        name="Conflict User",
        email="conflict@example.com",
        tenant=make_tenant(tenant_id="test-tenant-id", name="Conflict Tenant"),
    )


def _workflow_node_execution_conflict_handling_execution(
    *,
    execution_id: str,
    status: _ConflictExecutionStatus = _ConflictExecutionStatus.RUNNING,
) -> _workflow_node_execution_conflict_handling_WorkflowNodeExecution:
    return _workflow_node_execution_conflict_handling_WorkflowNodeExecution(
        id=execution_id,
        workflow_id="test-workflow-id",
        workflow_execution_id="test-workflow-execution-id",
        node_execution_id="test-node-execution-id",
        node_id="test-node-id",
        node_type=BuiltinNodeTypes.START,
        title="Test Node",
        index=1,
        status=status,
        created_at=naive_utc_now(),
    )


@contextmanager
def _fail_inserts(
    engine: Engine,
    *,
    failure_count: int,
    duplicate: bool,
) -> Iterator[ConflictEvents]:
    insert_attempts: list[str] = []
    rollbacks: list[bool] = []

    def fail_insert(_connection, _cursor, statement, parameters, _context, _executemany) -> None:
        if not statement.lstrip().upper().startswith("INSERT INTO WORKFLOW_NODE_EXECUTIONS"):
            return
        insert_attempts.append(statement)
        if len(insert_attempts) > failure_count:
            return
        original_error = (
            psycopg2.errors.UniqueViolation("forced duplicate key")
            if duplicate
            else RuntimeError("forced non-duplicate constraint failure")
        )
        raise IntegrityError(statement, parameters, original_error)

    def record_rollback(_connection) -> None:
        rollbacks.append(True)

    event.listen(engine, "before_cursor_execute", fail_insert)
    event.listen(engine, "rollback", record_rollback)
    try:
        yield ConflictEvents(insert_attempts=insert_attempts, rollbacks=rollbacks)
    finally:
        event.remove(engine, "before_cursor_execute", fail_insert)
        event.remove(engine, "rollback", record_rollback)


class TestWorkflowNodeExecutionConflictHandlingCases:
    @staticmethod
    @pytest.fixture
    def conflict_database(
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
    ) -> ConflictDatabase:
        """Use the shared SQLite fixtures for repository-owned sessions and assertions."""
        engine = sqlite_session.get_bind()
        assert isinstance(engine, Engine)
        return ConflictDatabase(
            engine=engine,
            session=sqlite_session,
            session_factory=sqlite_session_factory,
        )

    @staticmethod
    @pytest.fixture
    def repository(conflict_database: ConflictDatabase) -> SQLAlchemyWorkflowNodeExecutionRepository:
        return SQLAlchemyWorkflowNodeExecutionRepository(
            session_factory=conflict_database.session_factory,
            tenant_id="test-tenant-id",
            user=_workflow_node_execution_conflict_handling_account(),
            app_id="test-app-id",
            triggered_from=_workflow_node_execution_conflict_handling_WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )

    class TestWorkflowNodeExecutionConflictHandling:
        """Test cases for handling duplicate key conflicts in workflow node execution."""

        def test_save_with_duplicate_key_retries_with_new_uuid(
            self,
            repository: SQLAlchemyWorkflowNodeExecutionRepository,
            conflict_database: ConflictDatabase,
        ) -> None:
            execution = _workflow_node_execution_conflict_handling_execution(execution_id="original-id")
            original_id = execution.id

            with _fail_inserts(conflict_database.engine, failure_count=1, duplicate=True) as conflicts:
                repository.save(execution)

            assert len(conflicts.insert_attempts) == 2
            assert len(conflicts.rollbacks) == 1
            assert execution.id != original_id
            assert (
                conflict_database.session.get(
                    _workflow_node_execution_conflict_handling_WorkflowNodeExecutionModel, original_id
                )
                is None
            )
            persisted = conflict_database.session.get(
                _workflow_node_execution_conflict_handling_WorkflowNodeExecutionModel, execution.id
            )
            assert persisted is not None
            assert persisted.node_execution_id == execution.node_execution_id

        def test_save_with_existing_record_updates_instead_of_insert(
            self,
            repository: SQLAlchemyWorkflowNodeExecutionRepository,
            conflict_database: ConflictDatabase,
        ) -> None:
            execution = _workflow_node_execution_conflict_handling_execution(execution_id="existing-id")
            repository.save(execution)

            execution.status = _ConflictExecutionStatus.SUCCEEDED
            repository.save(execution)

            conflict_database.session.expire_all()
            persisted = conflict_database.session.get(
                _workflow_node_execution_conflict_handling_WorkflowNodeExecutionModel, execution.id
            )
            assert persisted is not None
            assert persisted.status == _ConflictExecutionStatus.SUCCEEDED
            assert (
                conflict_database.session.query(
                    _workflow_node_execution_conflict_handling_WorkflowNodeExecutionModel
                ).count()
                == 1
            )

        def test_save_exceeds_max_retries_raises_error(
            self,
            repository: SQLAlchemyWorkflowNodeExecutionRepository,
            conflict_database: ConflictDatabase,
        ) -> None:
            execution = _workflow_node_execution_conflict_handling_execution(execution_id="test-id")

            with _fail_inserts(conflict_database.engine, failure_count=3, duplicate=True) as conflicts:
                with pytest.raises(IntegrityError):
                    repository.save(execution)

            assert len(conflicts.insert_attempts) == 3
            assert len(conflicts.rollbacks) == 3
            assert (
                conflict_database.session.query(
                    _workflow_node_execution_conflict_handling_WorkflowNodeExecutionModel
                ).count()
                == 0
            )

        def test_save_non_duplicate_integrity_error_raises_immediately(
            self,
            repository: SQLAlchemyWorkflowNodeExecutionRepository,
            conflict_database: ConflictDatabase,
        ) -> None:
            execution = _workflow_node_execution_conflict_handling_execution(execution_id="test-id")

            with _fail_inserts(conflict_database.engine, failure_count=1, duplicate=False) as conflicts:
                with pytest.raises(IntegrityError):
                    repository.save(execution)

            assert len(conflicts.insert_attempts) == 1
            assert len(conflicts.rollbacks) == 1
            assert (
                conflict_database.session.get(
                    _workflow_node_execution_conflict_handling_WorkflowNodeExecutionModel, execution.id
                )
                is None
            )


"""
Unit tests for WorkflowNodeExecution truncation functionality.

Tests the truncation and offloading logic for large inputs and outputs
in the SQLAlchemyWorkflowNodeExecutionRepository.
"""


@dataclass
class TruncationTestCase:
    """Test case data for truncation scenarios."""

    name: str
    inputs: dict[str, Any] | None
    outputs: dict[str, Any] | None
    should_truncate_inputs: bool
    should_truncate_outputs: bool
    description: str


def create_test_cases() -> list[TruncationTestCase]:
    """Create test cases for different truncation scenarios."""
    # Create large data that will definitely exceed the threshold (10KB)
    large_data = {"data": "x" * (dify_config.WORKFLOW_VARIABLE_TRUNCATION_MAX_SIZE + 1000)}
    small_data = {"data": "small"}

    return [
        TruncationTestCase(
            name="small_data_no_truncation",
            inputs=small_data,
            outputs=small_data,
            should_truncate_inputs=False,
            should_truncate_outputs=False,
            description="Small data should not be truncated",
        ),
        TruncationTestCase(
            name="large_inputs_truncation",
            inputs=large_data,
            outputs=small_data,
            should_truncate_inputs=True,
            should_truncate_outputs=False,
            description="Large inputs should be truncated",
        ),
        TruncationTestCase(
            name="large_outputs_truncation",
            inputs=small_data,
            outputs=large_data,
            should_truncate_inputs=False,
            should_truncate_outputs=True,
            description="Large outputs should be truncated",
        ),
        TruncationTestCase(
            name="large_both_truncation",
            inputs=large_data,
            outputs=large_data,
            should_truncate_inputs=True,
            should_truncate_outputs=True,
            description="Both large inputs and outputs should be truncated",
        ),
        TruncationTestCase(
            name="none_inputs_outputs",
            inputs=None,
            outputs=None,
            should_truncate_inputs=False,
            should_truncate_outputs=False,
            description="None inputs and outputs should not be truncated",
        ),
    ]


def create_workflow_node_execution(
    execution_id: str = "test-execution-id",
    inputs: dict[str, Any] | None = None,
    outputs: dict[str, Any] | None = None,
) -> _workflow_node_execution_truncation_WorkflowNodeExecution:
    """Factory function to create a WorkflowNodeExecution for testing."""
    return _workflow_node_execution_truncation_WorkflowNodeExecution(
        id=execution_id,
        node_execution_id="test-node-execution-id",
        workflow_id="test-workflow-id",
        workflow_execution_id="test-workflow-execution-id",
        index=1,
        node_id="test-node-id",
        node_type=BuiltinNodeTypes.LLM,
        title="Test Node",
        inputs=inputs,
        outputs=outputs,
        status=_workflow_node_execution_truncation_WorkflowNodeExecutionStatus.SUCCEEDED,
        created_at=datetime.now(UTC),
    )


def mock_user() -> Account:
    """Create an Account user for testing."""

    user = Account(name="Test Account", email="test@example.com")
    user.id = "test-user-id"
    user._current_tenant = Tenant(name="Test Tenant")
    user._current_tenant.id = "test-tenant-id"
    return user


def create_offload(type_: ExecutionOffLoadType) -> WorkflowNodeExecutionOffload:
    return WorkflowNodeExecutionOffload(
        tenant_id="test-tenant-id",
        app_id="test-app-id",
        node_execution_id="test-node-execution-id",
        type_=type_,
        file_id="test-file-id",
    )


class TestWorkflowNodeExecutionTruncationCases:
    class TestSQLAlchemyWorkflowNodeExecutionRepositoryTruncation:
        """Test class for truncation functionality in SQLAlchemyWorkflowNodeExecutionRepository."""

        def create_repository(self, sqlite_engine: Engine) -> SQLAlchemyWorkflowNodeExecutionRepository:
            """Create a repository backed by the test's isolated SQLite engine."""
            repository = SQLAlchemyWorkflowNodeExecutionRepository(
                session_factory=sqlite_engine,
                tenant_id="test-tenant-id",
                user=mock_user(),
                app_id="test-app-id",
                triggered_from=_workflow_node_execution_truncation_WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
            )
            with repository._session_factory() as session:
                assert isinstance(session, Session)
                assert session.get_bind() is sqlite_engine
            return repository

        def test_to_domain_model_without_offload_data(self, sqlite_engine: Engine):
            """Test _to_domain_model correctly handles models without offload data."""
            repo = self.create_repository(sqlite_engine)

            # Create a database model without offload data
            db_model = _workflow_node_execution_truncation_WorkflowNodeExecutionModel(
                id="test-id",
                node_execution_id="node-exec-id",
                workflow_id="workflow-id",
                workflow_run_id="run-id",
                index=1,
                predecessor_node_id=None,
                node_id="node-id",
                node_type=BuiltinNodeTypes.LLM,
                title="Test Node",
                inputs=json.dumps({"value": "inputs"}),
                process_data=json.dumps({"value": "process_data"}),
                outputs=json.dumps({"value": "outputs"}),
                status=_workflow_node_execution_truncation_WorkflowNodeExecutionStatus.SUCCEEDED,
                error=None,
                elapsed_time=1.0,
                execution_metadata="{}",
                created_at=datetime.now(UTC),
                finished_at=None,
                offload_data=[],
            )

            domain_model = repo._to_domain_model(db_model)

            # Check that no truncated data was set
            assert domain_model.get_truncated_inputs() is None
            assert domain_model.get_truncated_outputs() is None

    class TestWorkflowNodeExecutionModelTruncatedProperties:
        """Test the truncated properties on WorkflowNodeExecutionModel."""

        def test_inputs_truncated_with_offload_data(self):
            """Test inputs_truncated property when offload data exists."""
            model = _workflow_node_execution_truncation_WorkflowNodeExecutionModel()
            offload = create_offload(ExecutionOffLoadType.INPUTS)
            model.offload_data = [offload]

            assert model.inputs_truncated is True
            assert model.process_data_truncated is False
            assert model.outputs_truncated is False

        def test_outputs_truncated_with_offload_data(self):
            """Test outputs_truncated property when offload data exists."""
            model = _workflow_node_execution_truncation_WorkflowNodeExecutionModel()

            # Mock offload data with outputs file
            offload = create_offload(ExecutionOffLoadType.OUTPUTS)
            model.offload_data = [offload]

            assert model.inputs_truncated is False
            assert model.process_data_truncated is False
            assert model.outputs_truncated is True

        def test_process_data_truncated_with_offload_data(self):
            model = _workflow_node_execution_truncation_WorkflowNodeExecutionModel()
            offload = create_offload(ExecutionOffLoadType.PROCESS_DATA)
            model.offload_data = [offload]
            assert model.process_data_truncated is True
            assert model.inputs_truncated is False
            assert model.outputs_truncated is False

        def test_truncated_properties_without_offload_data(self):
            """Test truncated properties when no offload data exists."""
            model = _workflow_node_execution_truncation_WorkflowNodeExecutionModel(
                offload_data=[],
            )

            assert model.inputs_truncated is False
            assert model.outputs_truncated is False
            assert model.process_data_truncated is False

        def test_truncated_properties_without_offload_attribute(self):
            """Test truncated properties when offload_data attribute doesn't exist."""
            model = _workflow_node_execution_truncation_WorkflowNodeExecutionModel()
            # Don't set offload_data attribute at all

            assert model.inputs_truncated is False
            assert model.outputs_truncated is False
            assert model.process_data_truncated is False
