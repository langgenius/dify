"""SQLite-backed tests for the workflow node execution repository."""

from __future__ import annotations

import json
import logging
from collections.abc import Iterator, Mapping
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
from graphon.entities import WorkflowNodeExecution
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from models import Account, EndUser
from models.base import TypeBase
from models.enums import ExecutionOffLoadType
from models.model import UploadFile
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionOffload, WorkflowNodeExecutionTriggeredFrom

RESOURCE_TENANT_ID = "tenant"


@pytest.fixture
def session_factory(sqlite_engine: Engine) -> sessionmaker[Session]:
    models = (WorkflowNodeExecutionModel, WorkflowNodeExecutionOffload, UploadFile)
    TypeBase.metadata.create_all(sqlite_engine, tables=[model.__table__ for model in models])
    return sessionmaker(bind=sqlite_engine, expire_on_commit=False)


def _account(*, tenant_id: str = "tenant-1", user_id: str = "user-1") -> Account:
    user = Mock(spec=Account)
    user.id = user_id
    user.current_tenant_id = tenant_id
    return user


def _end_user(*, tenant_id: str = "tenant-1", user_id: str = "end-user-1") -> EndUser:
    user = Mock(spec=EndUser)
    user.id = user_id
    user.tenant_id = tenant_id
    return user


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
def _raise_on_execution_insert(engine: Engine) -> Iterator[None]:
    def raise_error(_conn, _cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith("INSERT") and "workflow_node_executions" in statement:
            raise RuntimeError("forced execution INSERT")

    event.listen(engine, "before_cursor_execute", raise_error)
    try:
        yield
    finally:
        event.remove(engine, "before_cursor_execute", raise_error)


def test_init_accepts_real_engine_and_sessionmaker_and_sets_role(
    monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine, session_factory: sessionmaker[Session]
) -> None:
    engine_repo = _repository(monkeypatch, sqlite_engine)
    assert isinstance(engine_repo._session_factory, sessionmaker)
    end_user_repo = _repository(monkeypatch, session_factory, user=_end_user())
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
    user.current_tenant_id = None
    with pytest.raises(ValueError, match="tenant_id"):
        SQLAlchemyWorkflowNodeExecutionRepository(
            session_factory=sessionmaker(),
            tenant_id="",
            user=user,
            app_id=None,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )


def test_helper_functions_and_truncator_configuration(
    monkeypatch: pytest.MonkeyPatch, session_factory: sessionmaker[Session]
) -> None:
    assert _deterministic_json_dump({"b": 1, "a": 2}) == '{"a": 2, "b": 1}'
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
        def __init__(self, *, max_size_bytes: int, array_element_limit: int, string_length_limit: int):
            created.update(
                max_size_bytes=max_size_bytes,
                array_element_limit=array_element_limit,
                string_length_limit=string_length_limit,
            )

    monkeypatch.setattr("core.repositories.sqlalchemy_workflow_node_execution_repository.VariableTruncator", Truncator)
    _repository(monkeypatch, session_factory)._create_truncator()
    assert created["max_size_bytes"] == dify_config.WORKFLOW_VARIABLE_TRUNCATION_MAX_SIZE


def test_to_db_model_uses_context_and_deterministic_json(
    monkeypatch: pytest.MonkeyPatch, session_factory: sessionmaker[Session]
) -> None:
    repo = _repository(monkeypatch, session_factory)
    db_model = repo._to_db_model(_execution(inputs={"b": 1, "a": 2}))
    assert json.loads(db_model.inputs or "{}") == {"a": 2, "b": 1}
    assert db_model.tenant_id == "tenant-1"
    assert db_model.app_id == "app-1"
    repo._triggered_from = None
    with pytest.raises(ValueError, match="triggered_from is required"):
        repo._to_db_model(_execution())


def test_save_inserts_and_updates_persisted_execution(
    monkeypatch: pytest.MonkeyPatch, session_factory: sessionmaker[Session]
) -> None:
    repo = _repository(monkeypatch, session_factory)
    execution = _execution(inputs={"value": 1}, outputs={"result": "first"})
    repo.save(execution)
    with session_factory() as session:
        persisted = session.get(WorkflowNodeExecutionModel, execution.id)
        assert persisted is not None
        assert persisted.outputs_dict == {"result": "first"}
    execution.title = "Updated"
    execution.outputs = {"result": "second"}
    repo.save(execution)
    with session_factory() as session:
        persisted = session.get(WorkflowNodeExecutionModel, execution.id)
        assert persisted is not None
        assert persisted.title == "Updated"
        assert persisted.outputs_dict == {"result": "second"}
    assert repo._node_execution_cache[execution.node_execution_id].id == execution.id


def test_save_owned_session_rolls_back_failed_insert(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
    session_factory: sessionmaker[Session],
) -> None:
    repo = _repository(monkeypatch, session_factory)
    with _raise_on_execution_insert(sqlite_engine), pytest.raises(RuntimeError, match="forced execution INSERT"):
        repo.save(_execution())
    with session_factory() as session:
        assert session.scalar(select(WorkflowNodeExecutionModel)) is None


def test_save_execution_data_updates_existing_and_creates_missing(
    monkeypatch: pytest.MonkeyPatch, session_factory: sessionmaker[Session]
) -> None:
    repo = _repository(monkeypatch, session_factory)
    existing = _execution(inputs={"initial": True})
    repo.save(existing)
    existing.inputs = {"updated": True}
    existing.outputs = {"result": 2}
    existing.process_data = {"step": 3}
    monkeypatch.setattr(repo, "_truncate_and_upload", lambda *_args, **_kwargs: None)
    repo.save_execution_data(existing)
    with session_factory() as session:
        persisted = session.get(WorkflowNodeExecutionModel, existing.id)
        assert persisted is not None
        assert persisted.inputs_dict == {"updated": True}
        assert persisted.outputs_dict == {"result": 2}
        assert persisted.process_data_dict == {"step": 3}

    missing = _execution(execution_id="missing", node_execution_id="missing-node", inputs={"new": True})
    repo.save_execution_data(missing)
    with session_factory() as session:
        persisted = session.get(WorkflowNodeExecutionModel, missing.id)
        assert persisted is not None
        assert persisted.inputs_dict == {"new": True}


def test_save_execution_data_persists_truncation_offload(
    monkeypatch: pytest.MonkeyPatch, session_factory: sessionmaker[Session]
) -> None:
    repo = _repository(monkeypatch, session_factory)
    execution = _execution(inputs={"large": "value"})
    repo.save(execution)
    offload = WorkflowNodeExecutionOffload(
        tenant_id="tenant-1",
        app_id="app-1",
        node_execution_id=execution.id,
        type_=ExecutionOffLoadType.INPUTS,
        file_id="file-1",
    )
    result = SimpleNamespace(truncated_value={"large": "truncated"}, offload=offload)
    monkeypatch.setattr(repo, "_truncate_and_upload", lambda values, *_args: result if values else None)
    repo.save_execution_data(execution)
    with session_factory() as session:
        persisted = session.get(WorkflowNodeExecutionModel, execution.id)
        assert persisted is not None
        assert persisted.inputs_dict == {"large": "truncated"}
        offloads = session.scalars(
            select(WorkflowNodeExecutionOffload).where(WorkflowNodeExecutionOffload.node_execution_id == execution.id)
        ).all()
        assert [item.type_ for item in offloads] == [ExecutionOffLoadType.INPUTS]


def test_get_by_workflow_run_filters_tenant_app_trigger_and_paused_and_orders(
    monkeypatch: pytest.MonkeyPatch, session_factory: sessionmaker[Session]
) -> None:
    repo = _repository(monkeypatch, session_factory)
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
    _repository(monkeypatch, session_factory, tenant_id="tenant-2").save(
        _execution(execution_id="foreign-tenant", node_execution_id="foreign-tenant")
    )
    _repository(monkeypatch, session_factory, app_id="app-2").save(
        _execution(execution_id="foreign-app", node_execution_id="foreign-app")
    )
    _repository(
        monkeypatch,
        session_factory,
        triggered_from=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP,
    ).save(_execution(execution_id="single-step", node_execution_id="single-step"))

    models = repo.get_db_models_by_workflow_run("run-1", OrderConfig(order_by=["index"], order_direction="desc"))
    assert [model.id for model in models] == ["two", "one"]
    assert set(repo._node_execution_cache) >= {"node-one", "node-two"}
    assert repo.get_db_models_by_workflow_run("missing-run") == []


def test_get_by_workflow_execution_maps_real_rows_to_domain(
    monkeypatch: pytest.MonkeyPatch, session_factory: sessionmaker[Session]
) -> None:
    repo = _repository(monkeypatch, session_factory)
    repo.save(_execution(inputs={"input": 1}, outputs={"output": 2}))
    domains = repo.get_by_workflow_execution("run-1", OrderConfig(order_by=["index"], order_direction="asc"))
    assert len(domains) == 1
    assert domains[0].inputs == {"input": 1}
    assert domains[0].outputs == {"output": 2}


def test_to_domain_model_loads_offloaded_storage(
    monkeypatch: pytest.MonkeyPatch, session_factory: sessionmaker[Session]
) -> None:
    repo = _repository(monkeypatch, session_factory)
    db_model = repo._to_db_model(_execution(inputs={"truncated": True}))
    file = SimpleNamespace(key="storage-key")
    offload = WorkflowNodeExecutionOffload(type_=ExecutionOffLoadType.INPUTS)
    offload.file = file
    db_model.offload_data = [offload]
    monkeypatch.setattr(
        "core.repositories.sqlalchemy_workflow_node_execution_repository.storage.load",
        lambda _key: b'{"full": true}',
    )
    domain = repo._to_domain_model(db_model)
    assert domain.inputs == {"full": True}
    assert domain.get_truncated_inputs() == {"truncated": True}


def test_truncate_and_upload_keeps_file_boundary_mocked(
    monkeypatch: pytest.MonkeyPatch, session_factory: sessionmaker[Session]
) -> None:
    uploaded = SimpleNamespace(id="file-1", key="file-key")
    repo = _repository(monkeypatch, session_factory)
    repo._file_service = SimpleNamespace(upload_file=Mock(return_value=uploaded))

    class Truncator:
        def truncate_variable_mapping(self, _value: Any) -> tuple[dict[str, bool], bool]:
            return {"truncated": True}, True

    monkeypatch.setattr(repo, "_create_truncator", lambda: Truncator())
    result = repo._truncate_and_upload({"value": 1}, "execution-1", ExecutionOffLoadType.INPUTS)
    assert result is not None
    assert result.truncated_value == {"truncated": True}
    assert result.offload.file_id == "file-1"


def test_duplicate_detection_and_id_regeneration(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    session_factory: sessionmaker[Session],
) -> None:
    repo = _repository(monkeypatch, session_factory)
    duplicate = IntegrityError("duplicate", params=None, orig=Mock(spec=psycopg2.errors.UniqueViolation))
    assert repo._is_duplicate_key_error(duplicate)
    assert not repo._is_duplicate_key_error(IntegrityError("other", params=None, orig=None))
    execution = _execution(execution_id="old")
    db_model = repo._to_db_model(execution)
    monkeypatch.setattr("core.repositories.sqlalchemy_workflow_node_execution_repository.uuidv7", lambda: "new")
    caplog.set_level(logging.WARNING)
    repo._regenerate_id_on_duplicate(execution, db_model)
    assert execution.id == db_model.id == "new"
    assert "Duplicate key conflict" in caplog.text
