"""SQLite-backed tests for the workflow node execution repository."""

from __future__ import annotations

import json
import logging
from collections.abc import Callable, Generator, Mapping
from contextlib import contextmanager
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
from core.repositories.factory import OrderConfig
from core.repositories.sqlalchemy_workflow_node_execution_repository import (
    SQLAlchemyWorkflowNodeExecutionRepository,
    _deterministic_json_dump,
    _filter_by_offload_type,
    _find_first,
    _replace_or_append_offload,
)
from extensions.storage.storage_type import StorageType
from graphon.entities import WorkflowNodeExecution
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from models import Account, EndUser, Tenant
from models.enums import CreatorUserRole, ExecutionOffLoadType
from models.model import UploadFile
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionOffload, WorkflowNodeExecutionTriggeredFrom


def _account(*, tenant_id: str = "tenant-1", user_id: str = "user-1") -> Account:
    user = Account(name="Test Account", email="test@example.com")
    user.id = user_id
    user._current_tenant = Tenant(name="Test Tenant")
    user._current_tenant.id = tenant_id
    return user


def _end_user(*, tenant_id: str = "tenant-1", user_id: str = "end-user-1") -> EndUser:
    return EndUser(id=user_id, tenant_id=tenant_id)


def _upload_file(*, key: str = "storage-key") -> UploadFile:
    return UploadFile(
        tenant_id="tenant-1",
        storage_type=StorageType.LOCAL,
        key=key,
        name="offload.json",
        size=1,
        extension="json",
        mime_type="application/json",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="user-1",
        created_at=datetime.now(UTC),
        used=False,
    )


def _execution(
    *,
    execution_id: str = "execution-1",
    node_execution_id: str = "node-execution-1",
    run_id: str = "run-1",
    index: int = 1,
    status: WorkflowNodeExecutionStatus = WorkflowNodeExecutionStatus.SUCCEEDED,
    inputs: Mapping[str, Any] | None = None,
    outputs: Mapping[str, Any] | None = None,
    process_data: Mapping[str, Any] | None = None,
) -> WorkflowNodeExecution:
    return WorkflowNodeExecution(
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
    triggered_from: WorkflowNodeExecutionTriggeredFrom | None = WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
) -> SQLAlchemyWorkflowNodeExecutionRepository:
    monkeypatch.setattr(
        "core.repositories.sqlalchemy_workflow_node_execution_repository.FileService",
        lambda *_args: SimpleNamespace(upload_file=Mock()),
    )
    return SQLAlchemyWorkflowNodeExecutionRepository(
        session_factory=factory,
        tenant_id=tenant_id,
        user=user or _account(tenant_id=tenant_id),
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


def test_init_accepts_real_engine_and_sessionmaker_and_sets_role(
    monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session]
) -> None:
    engine_repo = _repository(monkeypatch, sqlite_engine)
    assert isinstance(engine_repo._session_factory, sessionmaker)
    end_user_repo = _repository(monkeypatch, sqlite_session_factory, user=_end_user())
    assert end_user_repo._creator_user_role.value == "end_user"


def test_init_rejects_invalid_factory_and_missing_tenant(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "core.repositories.sqlalchemy_workflow_node_execution_repository.FileService",
        lambda *_args: SimpleNamespace(upload_file=Mock()),
    )
    with pytest.raises(ValueError, match="Invalid session_factory type"):
        SQLAlchemyWorkflowNodeExecutionRepository(
            session_factory=object(),  # type: ignore[arg-type]
            tenant_id="tenant-1",
            user=_account(),
            app_id=None,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )
    user = _account()
    user._current_tenant = None
    with pytest.raises(ValueError, match="tenant_id"):
        SQLAlchemyWorkflowNodeExecutionRepository(
            session_factory=sessionmaker(),
            tenant_id="",
            user=user,
            app_id=None,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )


def test_init_uses_resource_tenant_when_account_has_no_current_tenant(
    monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    user = _account()
    user._current_tenant = None

    repo = _repository(
        monkeypatch,
        sqlite_session_factory,
        tenant_id="resource-tenant",
        user=user,
    )

    assert repo._tenant_id == "resource-tenant"
    assert repo._creator_user_id == user.id


def test_helper_functions_and_truncator_configuration(
    monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    assert _deterministic_json_dump({"b": 1, "a": 2}) == '{"a": 2, "b": 1}'
    assert _find_first([], lambda _value: True) is None
    assert _find_first([1, 2, 3], lambda value: value > 1) == 2
    inputs = WorkflowNodeExecutionOffload(type_=ExecutionOffLoadType.INPUTS)
    outputs = WorkflowNodeExecutionOffload(type_=ExecutionOffLoadType.OUTPUTS)
    assert _find_first([inputs, outputs], _filter_by_offload_type(ExecutionOffLoadType.OUTPUTS)) is outputs
    replaced = _replace_or_append_offload(
        [inputs, outputs], WorkflowNodeExecutionOffload(type_=ExecutionOffLoadType.INPUTS)
    )
    assert [item.type_ for item in replaced] == [ExecutionOffLoadType.OUTPUTS, ExecutionOffLoadType.INPUTS]

    created: dict[str, int] = {}

    class Truncator:
        def __init__(self, *, max_size_bytes: int, array_element_limit: int, string_length_limit: int) -> None:
            created.update(
                max_size_bytes=max_size_bytes,
                array_element_limit=array_element_limit,
                string_length_limit=string_length_limit,
            )

    monkeypatch.setattr("core.repositories.sqlalchemy_workflow_node_execution_repository.VariableTruncator", Truncator)
    _repository(monkeypatch, sqlite_session_factory)._create_truncator()
    assert created["max_size_bytes"] == dify_config.WORKFLOW_VARIABLE_TRUNCATION_MAX_SIZE


def test_to_db_model_uses_context_and_deterministic_json(
    monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    repo = _repository(monkeypatch, sqlite_session_factory)
    db_model = repo._to_db_model(
        _execution(
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
    assert _repository(monkeypatch, sqlite_session_factory, app_id=None)._to_db_model(_execution()).app_id is None
    repo._triggered_from = None
    with pytest.raises(ValueError, match="triggered_from is required"):
        repo._to_db_model(_execution())


def test_to_db_model_requires_creator_context(
    monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    repo = _repository(monkeypatch, sqlite_session_factory)
    execution = _execution()

    monkeypatch.setattr(repo, "_creator_user_id", None)
    with pytest.raises(ValueError, match="created_by is required"):
        repo._to_db_model(execution)

    monkeypatch.setattr(repo, "_creator_user_id", "user-1")
    monkeypatch.setattr(repo, "_creator_user_role", None)
    with pytest.raises(ValueError, match="created_by_role is required"):
        repo._to_db_model(execution)


def test_json_encode_uses_runtime_converter(monkeypatch: pytest.MonkeyPatch) -> None:
    class Converter:
        def to_json_encodable(self, values: Mapping[str, Any]) -> Mapping[str, Any]:
            return {"wrapped": values["value"]}

    monkeypatch.setattr(
        "core.repositories.sqlalchemy_workflow_node_execution_repository.WorkflowRuntimeTypeConverter",
        Converter,
    )

    assert SQLAlchemyWorkflowNodeExecutionRepository._json_encode({"value": 1}) == '{"wrapped": 1}'


def test_save_inserts_and_updates_persisted_execution(
    monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    repo = _repository(monkeypatch, sqlite_session_factory)
    execution = _execution(inputs={"value": 1}, outputs={"result": "first"})
    repo.save(execution)
    with sqlite_session_factory() as session:
        persisted = session.get(WorkflowNodeExecutionModel, execution.id)
        assert persisted is not None
        assert persisted.outputs_dict == {"result": "first"}
    execution.title = "Updated"
    execution.outputs = {"result": "second"}
    repo.save(execution)
    with sqlite_session_factory() as session:
        persisted = session.get(WorkflowNodeExecutionModel, execution.id)
        assert persisted is not None
        assert persisted.title == "Updated"
        assert persisted.outputs_dict == {"result": "second"}
    assert execution.node_execution_id is not None
    assert repo._node_execution_cache[execution.node_execution_id].id == execution.id


def test_save_owned_session_rolls_back_failed_insert(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repo = _repository(monkeypatch, sqlite_session_factory)
    with _raise_on_execution_insert(sqlite_engine), pytest.raises(RuntimeError, match="forced execution INSERT"):
        repo.save(_execution())
    with sqlite_session_factory() as session:
        assert session.scalar(select(WorkflowNodeExecutionModel)) is None


def test_save_execution_data_updates_existing_and_creates_missing(
    monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    repo = _repository(monkeypatch, sqlite_session_factory)
    existing = _execution(
        inputs={"initial": True},
        process_data={"workflow_agent_binding_id": "binding-1"},
    )
    repo.save(existing)
    existing.inputs = {"updated": True}
    existing.outputs = {"result": 2}
    existing.process_data = {"step": 3}
    monkeypatch.setattr(repo, "_truncate_and_upload", lambda *_args, **_kwargs: None)
    repo.save_execution_data(existing)
    with sqlite_session_factory() as session:
        persisted = session.get(WorkflowNodeExecutionModel, existing.id)
        assert persisted is not None
        assert persisted.inputs_dict == {"updated": True}
        assert persisted.outputs_dict == {"result": 2}
        assert persisted.process_data_dict == {
            "step": 3,
            "workflow_agent_binding_id": "binding-1",
        }

    missing = _execution(execution_id="missing", node_execution_id="missing-node", inputs={"new": True})
    repo.save_execution_data(missing)
    with sqlite_session_factory() as session:
        persisted = session.get(WorkflowNodeExecutionModel, missing.id)
        assert persisted is not None
        assert persisted.inputs_dict == {"new": True}


@pytest.mark.parametrize(
    ("execution_factory", "offload_type", "read_persisted", "read_truncated"),
    [
        (
            lambda: _execution(inputs={"large": "value"}),
            ExecutionOffLoadType.INPUTS,
            lambda model: model.inputs_dict,
            lambda execution: execution.get_truncated_inputs(),
        ),
        (
            lambda: _execution(outputs={"large": "value"}),
            ExecutionOffLoadType.OUTPUTS,
            lambda model: model.outputs_dict,
            lambda execution: execution.get_truncated_outputs(),
        ),
        (
            lambda: _execution(process_data={"large": "value"}),
            ExecutionOffLoadType.PROCESS_DATA,
            lambda model: model.process_data_dict,
            lambda execution: execution.get_truncated_process_data(),
        ),
    ],
)
def test_save_execution_data_persists_each_truncation_offload(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    execution_factory: Callable[[], WorkflowNodeExecution],
    offload_type: ExecutionOffLoadType,
    read_persisted: Callable[[WorkflowNodeExecutionModel], Mapping[str, Any] | None],
    read_truncated: Callable[[WorkflowNodeExecution], Mapping[str, Any] | None],
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
        persisted = session.get(WorkflowNodeExecutionModel, execution.id)
        assert persisted is not None
        assert read_persisted(persisted) == {"large": "truncated"}
        offloads = session.scalars(
            select(WorkflowNodeExecutionOffload).where(WorkflowNodeExecutionOffload.node_execution_id == execution.id)
        ).all()
        assert [item.type_ for item in offloads] == [offload_type]
    assert read_truncated(execution) == {"large": "truncated"}


def test_get_by_workflow_run_filters_tenant_app_trigger_and_paused_and_orders(
    monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    repo = _repository(monkeypatch, sqlite_session_factory)
    repo.save(_execution(execution_id="two", node_execution_id="node-two", index=2))
    repo.save(_execution(execution_id="one", node_execution_id="node-one", index=1))
    repo.save(
        _execution(
            execution_id="paused",
            node_execution_id="node-paused",
            index=3,
            status=WorkflowNodeExecutionStatus.PAUSED,
        )
    )
    _repository(monkeypatch, sqlite_session_factory, tenant_id="tenant-2").save(
        _execution(execution_id="foreign-tenant", node_execution_id="foreign-tenant")
    )
    _repository(monkeypatch, sqlite_session_factory, app_id="app-2").save(
        _execution(execution_id="foreign-app", node_execution_id="foreign-app")
    )
    _repository(
        monkeypatch,
        sqlite_session_factory,
        triggered_from=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP,
    ).save(_execution(execution_id="single-step", node_execution_id="single-step"))

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


def test_get_by_workflow_execution_maps_real_rows_to_domain(
    monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    repo = _repository(monkeypatch, sqlite_session_factory)
    repo.save(_execution(inputs={"input": 1}, outputs={"output": 2}))
    domains = repo.get_by_workflow_execution("run-1", OrderConfig(order_by=["index"], order_direction="asc"))
    assert len(domains) == 1
    assert domains[0].inputs == {"input": 1}
    assert domains[0].outputs == {"output": 2}


def test_to_domain_model_loads_offloaded_storage(
    monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    repo = _repository(monkeypatch, sqlite_session_factory)
    db_model = repo._to_db_model(
        _execution(
            inputs={"truncated": "inputs"},
            outputs={"truncated": "outputs"},
            process_data={"truncated": "process_data"},
        )
    )
    offloads = []
    for offload_type in ExecutionOffLoadType:
        offload = WorkflowNodeExecutionOffload(type_=offload_type)
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


def test_duplicate_detection_and_id_regeneration(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repo = _repository(monkeypatch, sqlite_session_factory)
    duplicate = IntegrityError("duplicate", params=None, orig=Mock(spec=psycopg2.errors.UniqueViolation))
    assert repo._is_duplicate_key_error(duplicate)
    assert not repo._is_duplicate_key_error(IntegrityError("other", params=None, orig=Exception("other")))
    execution = _execution(execution_id="old")
    db_model = repo._to_db_model(execution)
    monkeypatch.setattr("core.repositories.sqlalchemy_workflow_node_execution_repository.uuidv7", lambda: "new")
    caplog.set_level(logging.WARNING)
    repo._regenerate_id_on_duplicate(execution, db_model)
    assert execution.id == db_model.id == "new"
    assert "Duplicate key conflict" in caplog.text


def test_save_retries_postgres_duplicate_key(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repo = _repository(monkeypatch, sqlite_session_factory)
    execution = _execution(execution_id="old")
    duplicate = IntegrityError(
        "duplicate",
        params=None,
        orig=Mock(spec=psycopg2.errors.UniqueViolation),
    )
    persist = Mock(side_effect=[duplicate, None])
    monkeypatch.setattr(repo, "_persist_to_database", persist)
    monkeypatch.setattr("core.repositories.sqlalchemy_workflow_node_execution_repository.uuidv7", lambda: "new")

    repo.save(execution)

    assert persist.call_count == 2
    assert execution.id == "new"
    assert execution.node_execution_id is not None
    assert repo._node_execution_cache[execution.node_execution_id].id == "new"


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
        repo.save(_execution())
    assert "Non-duplicate key integrity error" in caplog.text

    caplog.clear()
    monkeypatch.setattr(repo, "_persist_to_database", Mock(side_effect=RuntimeError("boom")))
    with pytest.raises(RuntimeError, match="boom"):
        repo.save(_execution(execution_id="unexpected"))
    assert "Failed to save workflow node execution" in caplog.text
