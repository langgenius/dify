from __future__ import annotations

import json
import logging
from collections.abc import Mapping
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, Mock

import psycopg2.errors
import pytest
from sqlalchemy import Engine, create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from configs import dify_config
from core.repositories.sqlalchemy_workflow_node_execution_repository import (
    SQLAlchemyWorkflowNodeExecutionRepository,
    _deterministic_json_dump,
    _filter_by_offload_type,
    _find_first,
    _replace_or_append_offload,
)
from dify_graph.entities import WorkflowNodeExecution
from dify_graph.enums import (
    BuiltinNodeTypes,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)
from dify_graph.repositories.workflow_node_execution_repository import OrderConfig
from models import Account, EndUser
from models.enums import ExecutionOffLoadType
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionOffload, WorkflowNodeExecutionTriggeredFrom


def _mock_account(*, tenant_id: str = "tenant", user_id: str = "user") -> Account:
    user = Mock(spec=Account)
    user.id = user_id
    user.current_tenant_id = tenant_id
    return user


def _mock_end_user(*, tenant_id: str = "tenant", user_id: str = "user") -> EndUser:
    user = Mock(spec=EndUser)
    user.id = user_id
    user.tenant_id = tenant_id
    return user


def _execution(
    *,
    execution_id: str = "exec-id",
    node_execution_id: str = "node-exec-id",
    workflow_run_id: str = "run-id",
    status: WorkflowNodeExecutionStatus = WorkflowNodeExecutionStatus.SUCCEEDED,
    inputs: Mapping[str, Any] | None = None,
    outputs: Mapping[str, Any] | None = None,
    process_data: Mapping[str, Any] | None = None,
    metadata: Mapping[WorkflowNodeExecutionMetadataKey, Any] | None = None,
) -> WorkflowNodeExecution:
    return WorkflowNodeExecution(
        id=execution_id,
        node_execution_id=node_execution_id,
        workflow_id="workflow-id",
        workflow_execution_id=workflow_run_id,
        index=1,
        predecessor_node_id=None,
        node_id="node-id",
        node_type=BuiltinNodeTypes.LLM,
        title="Title",
        inputs=inputs,
        outputs=outputs,
        process_data=process_data,
        status=status,
        error=None,
        elapsed_time=1.0,
        metadata=metadata,
        created_at=datetime.now(UTC),
        finished_at=None,
    )


class _SessionCtx:
    def __init__(self, session: Any):
        self._session = session

    def __enter__(self) -> Any:
        return self._session

    def __exit__(self, exc_type, exc, tb) -> None:
        return None


def _session_factory(session: Any) -> sessionmaker:
    factory = Mock(spec=sessionmaker)
    factory.return_value = _SessionCtx(session)
    return factory


def test_init_accepts_engine_and_sessionmaker_and_sets_role(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "core.repositories.sqlalchemy_workflow_node_execution_repository.FileService",
        lambda *_: SimpleNamespace(upload_file=Mock()),
    )

    engine: Engine = create_engine("sqlite:///:memory:")
    repo = SQLAlchemyWorkflowNodeExecutionRepository(
        session_factory=engine,
        user=_mock_account(),
        app_id=None,
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    )
    assert isinstance(repo._session_factory, sessionmaker)

    sm = Mock(spec=sessionmaker)
    repo = SQLAlchemyWorkflowNodeExecutionRepository(
        session_factory=sm,
        user=_mock_end_user(),
        app_id="app",
        triggered_from=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP,
    )
    assert repo._creator_user_role.value == "end_user"


def test_init_rejects_invalid_session_factory_type(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "core.repositories.sqlalchemy_workflow_node_execution_repository.FileService",
        lambda *_: SimpleNamespace(upload_file=Mock()),
    )
    with pytest.raises(ValueError, match="Invalid session_factory type"):
        SQLAlchemyWorkflowNodeExecutionRepository(  # type: ignore[arg-type]
            session_factory=object(),
            user=_mock_account(),
            app_id=None,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )


def test_init_requires_tenant_id(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "core.repositories.sqlalchemy_workflow_node_execution_repository.FileService",
        lambda *_: SimpleNamespace(upload_file=Mock()),
    )
    user = _mock_account()
    user.current_tenant_id = None
    with pytest.raises(ValueError, match="User must have a tenant_id"):
        SQLAlchemyWorkflowNodeExecutionRepository(
            session_factory=Mock(spec=sessionmaker),
            user=user,
            app_id=None,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )


def test_create_truncator_uses_config(monkeypatch: pytest.MonkeyPatch) -> None:
    created: dict[str, Any] = {}

    class FakeTruncator:
        def __init__(self, *, max_size_bytes: int, array_element_limit: int, string_length_limit: int):
            created.update(
                {
                    "max_size_bytes": max_size_bytes,
                    "array_element_limit": array_element_limit,
                    "string_length_limit": string_length_limit,
                }
            )

    monkeypatch.setattr(
        "core.repositories.sqlalchemy_workflow_node_execution_repository.VariableTruncator",
        FakeTruncator,
    )
    monkeypatch.setattr(
        "core.repositories.sqlalchemy_workflow_node_execution_repository.FileService",
        lambda *_: SimpleNamespace(upload_file=Mock()),
    )

    repo = SQLAlchemyWorkflowNodeExecutionRepository(
        session_factory=Mock(spec=sessionmaker),
        user=_mock_account(),
        app_id=None,
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    )
    _ = repo._create_truncator()
    assert created["max_size_bytes"] == dify_config.WORKFLOW_VARIABLE_TRUNCATION_MAX_SIZE


def test_helpers_find_first_and_replace_or_append_and_filter() -> None:
    assert _deterministic_json_dump({"b": 1, "a": 2}) == '{"a": 2, "b": 1}'
    assert _find_first([], lambda _: True) is None
    assert _find_first([1, 2, 3], lambda x: x > 1) == 2

    off1 = WorkflowNodeExecutionOffload(type_=ExecutionOffLoadType.INPUTS)
    off2 = WorkflowNodeExecutionOffload(type_=ExecutionOffLoadType.OUTPUTS)
    assert _find_first([off1, off2], _filter_by_offload_type(ExecutionOffLoadType.OUTPUTS)) is off2

    replaced = _replace_or_append_offload([off1, off2], WorkflowNodeExecutionOffload(type_=ExecutionOffLoadType.INPUTS))
    assert len(replaced) == 2
    assert [o.type_ for o in replaced] == [ExecutionOffLoadType.OUTPUTS, ExecutionOffLoadType.INPUTS]


def test_to_db_model_requires_constructor_context(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "core.repositories.sqlalchemy_workflow_node_execution_repository.FileService",
        lambda *_: SimpleNamespace(upload_file=Mock()),
    )
    repo = SQLAlchemyWorkflowNodeExecutionRepository(
        session_factory=Mock(spec=sessionmaker),
        user=_mock_account(),
        app_id=None,
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    )
    execution = _execution(inputs={"b": 1, "a": 2}, metadata={WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: 1})

    # Happy path: deterministic json dump should be sorted
    db_model = repo._to_db_model(execution)
    assert json.loads(db_model.inputs or "{}") == {"a": 2, "b": 1}
    assert json.loads(db_model.execution_metadata or "{}")["total_tokens"] == 1

    repo._triggered_from = None
    with pytest.raises(ValueError, match="triggered_from is required"):
        repo._to_db_model(execution)


def test_to_db_model_requires_creator_user_id_and_role(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "core.repositories.sqlalchemy_workflow_node_execution_repository.FileService",
        lambda *_: SimpleNamespace(upload_file=Mock()),
    )
    repo = SQLAlchemyWorkflowNodeExecutionRepository(
        session_factory=Mock(spec=sessionmaker),
        user=_mock_account(),
        app_id="app",
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    )
    execution = _execution()
    db_model = repo._to_db_model(execution)
    assert db_model.app_id == "app"

    repo._creator_user_id = None
    with pytest.raises(ValueError, match="created_by is required"):
        repo._to_db_model(execution)

    repo._creator_user_id = "user"
    repo._creator_user_role = None
    with pytest.raises(ValueError, match="created_by_role is required"):
        repo._to_db_model(execution)


def test_is_duplicate_key_error_and_regenerate_id(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(
        "core.repositories.sqlalchemy_workflow_node_execution_repository.FileService",
        lambda *_: SimpleNamespace(upload_file=Mock()),
    )
    repo = SQLAlchemyWorkflowNodeExecutionRepository(
        session_factory=Mock(spec=sessionmaker),
        user=_mock_account(),
        app_id=None,
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    )

    unique = Mock(spec=psycopg2.errors.UniqueViolation)
    duplicate_error = IntegrityError("dup", params=None, orig=unique)
    assert repo._is_duplicate_key_error(duplicate_error) is True
    assert repo._is_duplicate_key_error(IntegrityError("other", params=None, orig=None)) is False

    execution = _execution(execution_id="old-id")
    db_model = WorkflowNodeExecutionModel()
    db_model.id = "old-id"
    monkeypatch.setattr("core.repositories.sqlalchemy_workflow_node_execution_repository.uuidv7", lambda: "new-id")
    caplog.set_level(logging.WARNING)
    repo._regenerate_id_on_duplicate(execution, db_model)
    assert execution.id == "new-id"
    assert db_model.id == "new-id"
    assert any("Duplicate key conflict" in r.message for r in caplog.records)


def test_persist_to_database_updates_existing_and_inserts_new(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "core.repositories.sqlalchemy_workflow_node_execution_repository.FileService",
        lambda *_: SimpleNamespace(upload_file=Mock()),
    )
    session = MagicMock()
    repo = SQLAlchemyWorkflowNodeExecutionRepository(
        session_factory=_session_factory(session),
        user=_mock_account(),
        app_id=None,
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    )

    db_model = WorkflowNodeExecutionModel()
    db_model.id = "id1"
    db_model.node_execution_id = "node1"
    db_model.foo = "bar"  # type: ignore[attr-defined]
    db_model.__dict__["_private"] = "x"

    existing = SimpleNamespace()
    session.get.return_value = existing
    repo._persist_to_database(db_model)
    assert existing.foo == "bar"
    session.add.assert_not_called()
    assert repo._node_execution_cache["node1"] is db_model

    session.reset_mock()
    session.get.return_value = None
    repo._node_execution_cache.clear()
    repo._persist_to_database(db_model)
    session.add.assert_called_once_with(db_model)
    assert repo._node_execution_cache["node1"] is db_model


def test_truncate_and_upload_returns_none_when_no_values_or_not_truncated(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "core.repositories.sqlalchemy_workflow_node_execution_repository.FileService",
        lambda *_: SimpleNamespace(upload_file=Mock()),
    )
    repo = SQLAlchemyWorkflowNodeExecutionRepository(
        session_factory=Mock(spec=sessionmaker),
        user=_mock_account(),
        app_id="app",
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    )

    assert repo._truncate_and_upload(None, "e", ExecutionOffLoadType.INPUTS) is None

    class FakeTruncator:
        def truncate_variable_mapping(self, value: Any):  # type: ignore[no-untyped-def]
            return value, False

    monkeypatch.setattr(repo, "_create_truncator", lambda: FakeTruncator())
    assert repo._truncate_and_upload({"a": 1}, "e", ExecutionOffLoadType.INPUTS) is None


def test_truncate_and_upload_uploads_and_builds_offload(monkeypatch: pytest.MonkeyPatch) -> None:
    uploaded: dict[str, Any] = {}

    class FakeFileService:
        def upload_file(self, *, filename: str, content: bytes, mimetype: str, user: Any):  # type: ignore[no-untyped-def]
            uploaded.update({"filename": filename, "content": content, "mimetype": mimetype, "user": user})
            return SimpleNamespace(id="file-id", key="file-key")

    monkeypatch.setattr(
        "core.repositories.sqlalchemy_workflow_node_execution_repository.FileService", lambda *_: FakeFileService()
    )
    monkeypatch.setattr("core.repositories.sqlalchemy_workflow_node_execution_repository.uuidv7", lambda: "offload-id")

    repo = SQLAlchemyWorkflowNodeExecutionRepository(
        session_factory=Mock(spec=sessionmaker),
        user=_mock_account(),
        app_id="app",
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    )

    class FakeTruncator:
        def truncate_variable_mapping(self, value: Any):  # type: ignore[no-untyped-def]
            return {"truncated": True}, True

    monkeypatch.setattr(repo, "_create_truncator", lambda: FakeTruncator())

    result = repo._truncate_and_upload({"a": 1}, "exec", ExecutionOffLoadType.INPUTS)
    assert result is not None
    assert result.truncated_value == {"truncated": True}
    assert uploaded["filename"].startswith("node_execution_exec_inputs.json")
    assert result.offload.file_id == "file-id"
    assert result.offload.type_ == ExecutionOffLoadType.INPUTS


def test_to_domain_model_loads_offloaded_files(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "core.repositories.sqlalchemy_workflow_node_execution_repository.FileService",
        lambda *_: SimpleNamespace(upload_file=Mock()),
    )
    repo = SQLAlchemyWorkflowNodeExecutionRepository(
        session_factory=Mock(spec=sessionmaker),
        user=_mock_account(),
        app_id=None,
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    )

    db_model = WorkflowNodeExecutionModel()
    db_model.id = "id"
    db_model.node_execution_id = "node-exec"
    db_model.workflow_id = "wf"
    db_model.workflow_run_id = "run"
    db_model.index = 1
    db_model.predecessor_node_id = None
    db_model.node_id = "node"
    db_model.node_type = BuiltinNodeTypes.LLM
    db_model.title = "t"
    db_model.inputs = json.dumps({"trunc": "i"})
    db_model.process_data = json.dumps({"trunc": "p"})
    db_model.outputs = json.dumps({"trunc": "o"})
    db_model.status = WorkflowNodeExecutionStatus.SUCCEEDED
    db_model.error = None
    db_model.elapsed_time = 0.1
    db_model.execution_metadata = json.dumps({"total_tokens": 3})
    db_model.created_at = datetime.now(UTC)
    db_model.finished_at = None

    off_in = WorkflowNodeExecutionOffload(type_=ExecutionOffLoadType.INPUTS)
    off_out = WorkflowNodeExecutionOffload(type_=ExecutionOffLoadType.OUTPUTS)
    off_proc = WorkflowNodeExecutionOffload(type_=ExecutionOffLoadType.PROCESS_DATA)
    off_in.file = SimpleNamespace(key="k-in")
    off_out.file = SimpleNamespace(key="k-out")
    off_proc.file = SimpleNamespace(key="k-proc")
    db_model.offload_data = [off_out, off_in, off_proc]

    def fake_load(key: str) -> bytes:
        return json.dumps({"full": key}).encode()

    monkeypatch.setattr("core.repositories.sqlalchemy_workflow_node_execution_repository.storage.load", fake_load)

    domain = repo._to_domain_model(db_model)
    assert domain.inputs == {"full": "k-in"}
    assert domain.outputs == {"full": "k-out"}
    assert domain.process_data == {"full": "k-proc"}
    assert domain.get_truncated_inputs() == {"trunc": "i"}
    assert domain.get_truncated_outputs() == {"trunc": "o"}
    assert domain.get_truncated_process_data() == {"trunc": "p"}


def test_to_domain_model_returns_early_when_no_offload_data(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "core.repositories.sqlalchemy_workflow_node_execution_repository.FileService",
        lambda *_: SimpleNamespace(upload_file=Mock()),
    )
    repo = SQLAlchemyWorkflowNodeExecutionRepository(
        session_factory=Mock(spec=sessionmaker),
        user=_mock_account(),
        app_id=None,
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    )

    db_model = WorkflowNodeExecutionModel()
    db_model.id = "id"
    db_model.node_execution_id = "node-exec"
    db_model.workflow_id = "wf"
    db_model.workflow_run_id = "run"
    db_model.index = 1
    db_model.predecessor_node_id = None
    db_model.node_id = "node"
    db_model.node_type = BuiltinNodeTypes.LLM
    db_model.title = "t"
    db_model.inputs = json.dumps({"i": 1})
    db_model.process_data = json.dumps({"p": 2})
    db_model.outputs = json.dumps({"o": 3})
    db_model.status = WorkflowNodeExecutionStatus.SUCCEEDED
    db_model.error = None
    db_model.elapsed_time = 0.1
    db_model.execution_metadata = "{}"
    db_model.created_at = datetime.now(UTC)
    db_model.finished_at = None
    db_model.offload_data = []

    domain = repo._to_domain_model(db_model)
    assert domain.inputs == {"i": 1}
    assert domain.outputs == {"o": 3}


def test_json_encode_uses_runtime_converter(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeConverter:
        def to_json_encodable(self, values: Mapping[str, Any]) -> Mapping[str, Any]:
            return {"wrapped": values["a"]}

    monkeypatch.setattr(
        "core.repositories.sqlalchemy_workflow_node_execution_repository.WorkflowRuntimeTypeConverter",
        FakeConverter,
    )
    assert SQLAlchemyWorkflowNodeExecutionRepository._json_encode({"a": 1}) == '{"wrapped": 1}'


def test_save_execution_data_handles_existing_db_model_and_truncation(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "core.repositories.sqlalchemy_workflow_node_execution_repository.FileService",
        lambda *_: SimpleNamespace(upload_file=Mock()),
    )
    session = MagicMock()
    session.execute.return_value.scalars.return_value.first.return_value = SimpleNamespace(
        id="id",
        offload_data=[WorkflowNodeExecutionOffload(type_=ExecutionOffLoadType.INPUTS)],
        inputs=None,
        outputs=None,
        process_data=None,
    )
    session.merge = Mock()
    session.flush = Mock()
    session.begin.return_value.__enter__ = Mock(return_value=session)
    session.begin.return_value.__exit__ = Mock(return_value=None)

    repo = SQLAlchemyWorkflowNodeExecutionRepository(
        session_factory=_session_factory(session),
        user=_mock_account(),
        app_id="app",
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    )

    execution = _execution(inputs={"a": 1}, outputs={"b": 2}, process_data={"c": 3})

    trunc_result = SimpleNamespace(
        truncated_value={"trunc": True},
        offload=WorkflowNodeExecutionOffload(type_=ExecutionOffLoadType.INPUTS, file_id="f1"),
    )
    monkeypatch.setattr(
        repo, "_truncate_and_upload", lambda values, *_args, **_kwargs: trunc_result if values == {"a": 1} else None
    )
    monkeypatch.setattr(repo, "_json_encode", lambda values: json.dumps(values, sort_keys=True))

    repo.save_execution_data(execution)
    # Inputs should be truncated, outputs/process_data encoded directly
    db_model = session.merge.call_args.args[0]
    assert json.loads(db_model.inputs) == {"trunc": True}
    assert json.loads(db_model.outputs) == {"b": 2}
    assert json.loads(db_model.process_data) == {"c": 3}
    assert any(off.type_ == ExecutionOffLoadType.INPUTS for off in db_model.offload_data)
    assert execution.get_truncated_inputs() == {"trunc": True}


def test_save_execution_data_truncates_outputs_and_process_data(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "core.repositories.sqlalchemy_workflow_node_execution_repository.FileService",
        lambda *_: SimpleNamespace(upload_file=Mock()),
    )
    existing = SimpleNamespace(
        id="id",
        offload_data=[],
        inputs=None,
        outputs=None,
        process_data=None,
    )
    session = MagicMock()
    session.execute.return_value.scalars.return_value.first.return_value = existing
    session.merge = Mock()
    session.flush = Mock()
    session.begin.return_value.__enter__ = Mock(return_value=session)
    session.begin.return_value.__exit__ = Mock(return_value=None)

    repo = SQLAlchemyWorkflowNodeExecutionRepository(
        session_factory=_session_factory(session),
        user=_mock_account(),
        app_id="app",
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    )

    execution = _execution(inputs={"a": 1}, outputs={"b": 2}, process_data={"c": 3})

    def trunc(values: Mapping[str, Any], *_args: Any, **_kwargs: Any) -> Any:
        if values == {"b": 2}:
            return SimpleNamespace(
                truncated_value={"b": "trunc"},
                offload=WorkflowNodeExecutionOffload(type_=ExecutionOffLoadType.OUTPUTS, file_id="f2"),
            )
        if values == {"c": 3}:
            return SimpleNamespace(
                truncated_value={"c": "trunc"},
                offload=WorkflowNodeExecutionOffload(type_=ExecutionOffLoadType.PROCESS_DATA, file_id="f3"),
            )
        return None

    monkeypatch.setattr(repo, "_truncate_and_upload", trunc)
    monkeypatch.setattr(repo, "_json_encode", lambda values: json.dumps(values, sort_keys=True))

    repo.save_execution_data(execution)
    db_model = session.merge.call_args.args[0]
    assert json.loads(db_model.outputs) == {"b": "trunc"}
    assert json.loads(db_model.process_data) == {"c": "trunc"}
    assert execution.get_truncated_outputs() == {"b": "trunc"}
    assert execution.get_truncated_process_data() == {"c": "trunc"}


def test_save_execution_data_handles_missing_db_model(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "core.repositories.sqlalchemy_workflow_node_execution_repository.FileService",
        lambda *_: SimpleNamespace(upload_file=Mock()),
    )
    session = MagicMock()
    session.execute.return_value.scalars.return_value.first.return_value = None
    session.merge = Mock()
    session.flush = Mock()
    session.begin.return_value.__enter__ = Mock(return_value=session)
    session.begin.return_value.__exit__ = Mock(return_value=None)

    repo = SQLAlchemyWorkflowNodeExecutionRepository(
        session_factory=_session_factory(session),
        user=_mock_account(),
        app_id=None,
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    )

    execution = _execution(inputs={"a": 1})
    fake_db_model = SimpleNamespace(id=execution.id, offload_data=[], inputs=None, outputs=None, process_data=None)
    monkeypatch.setattr(repo, "_to_db_model", lambda *_: fake_db_model)
    monkeypatch.setattr(repo, "_truncate_and_upload", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(repo, "_json_encode", lambda values: json.dumps(values))

    repo.save_execution_data(execution)
    merged = session.merge.call_args.args[0]
    assert merged.inputs == '{"a": 1}'


def test_save_retries_duplicate_and_logs_non_duplicate(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(
        "core.repositories.sqlalchemy_workflow_node_execution_repository.FileService",
        lambda *_: SimpleNamespace(upload_file=Mock()),
    )
    repo = SQLAlchemyWorkflowNodeExecutionRepository(
        session_factory=Mock(spec=sessionmaker),
        user=_mock_account(),
        app_id=None,
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    )

    execution = _execution(execution_id="id")
    unique = Mock(spec=psycopg2.errors.UniqueViolation)
    duplicate_error = IntegrityError("dup", params=None, orig=unique)
    other_error = IntegrityError("other", params=None, orig=None)

    calls = {"n": 0}

    def persist(_db_model: Any) -> None:
        calls["n"] += 1
        if calls["n"] == 1:
            raise duplicate_error

    monkeypatch.setattr(repo, "_persist_to_database", persist)
    monkeypatch.setattr("core.repositories.sqlalchemy_workflow_node_execution_repository.uuidv7", lambda: "new-id")
    repo.save(execution)
    assert execution.id == "new-id"
    assert repo._node_execution_cache[execution.node_execution_id] is not None

    caplog.set_level(logging.ERROR)
    monkeypatch.setattr(repo, "_persist_to_database", lambda _db: (_ for _ in ()).throw(other_error))
    with pytest.raises(IntegrityError):
        repo.save(_execution(execution_id="id2", node_execution_id="node2"))
    assert any("Non-duplicate key integrity error" in r.message for r in caplog.records)


def test_save_logs_and_reraises_on_unexpected_error(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(
        "core.repositories.sqlalchemy_workflow_node_execution_repository.FileService",
        lambda *_: SimpleNamespace(upload_file=Mock()),
    )
    repo = SQLAlchemyWorkflowNodeExecutionRepository(
        session_factory=Mock(spec=sessionmaker),
        user=_mock_account(),
        app_id=None,
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    )
    caplog.set_level(logging.ERROR)
    monkeypatch.setattr(repo, "_persist_to_database", lambda _db: (_ for _ in ()).throw(RuntimeError("boom")))
    with pytest.raises(RuntimeError, match="boom"):
        repo.save(_execution(execution_id="id3", node_execution_id="node3"))
    assert any("Failed to save workflow node execution" in r.message for r in caplog.records)


def test_get_db_models_by_workflow_run_orders_and_caches(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "core.repositories.sqlalchemy_workflow_node_execution_repository.FileService",
        lambda *_: SimpleNamespace(upload_file=Mock()),
    )

    class FakeStmt:
        def __init__(self) -> None:
            self.where_calls = 0
            self.order_by_args: tuple[Any, ...] | None = None

        def where(self, *_args: Any) -> FakeStmt:
            self.where_calls += 1
            return self

        def order_by(self, *args: Any) -> FakeStmt:
            self.order_by_args = args
            return self

    stmt = FakeStmt()
    monkeypatch.setattr(
        "core.repositories.sqlalchemy_workflow_node_execution_repository.WorkflowNodeExecutionModel.preload_offload_data_and_files",
        lambda _q: stmt,
    )
    monkeypatch.setattr("core.repositories.sqlalchemy_workflow_node_execution_repository.select", lambda *_: "select")

    model1 = SimpleNamespace(node_execution_id="n1")
    model2 = SimpleNamespace(node_execution_id=None)
    session = MagicMock()
    session.scalars.return_value.all.return_value = [model1, model2]

    repo = SQLAlchemyWorkflowNodeExecutionRepository(
        session_factory=_session_factory(session),
        user=_mock_account(),
        app_id="app",
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    )

    order = OrderConfig(order_by=["index", "missing"], order_direction="desc")
    db_models = repo.get_db_models_by_workflow_run("run", order)
    assert db_models == [model1, model2]
    assert repo._node_execution_cache["n1"] is model1
    assert stmt.order_by_args is not None


def test_get_db_models_by_workflow_run_uses_asc_order(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "core.repositories.sqlalchemy_workflow_node_execution_repository.FileService",
        lambda *_: SimpleNamespace(upload_file=Mock()),
    )

    class FakeStmt:
        def where(self, *_args: Any) -> FakeStmt:
            return self

        def order_by(self, *args: Any) -> FakeStmt:
            self.args = args  # type: ignore[attr-defined]
            return self

    stmt = FakeStmt()
    monkeypatch.setattr(
        "core.repositories.sqlalchemy_workflow_node_execution_repository.WorkflowNodeExecutionModel.preload_offload_data_and_files",
        lambda _q: stmt,
    )
    monkeypatch.setattr("core.repositories.sqlalchemy_workflow_node_execution_repository.select", lambda *_: "select")

    session = MagicMock()
    session.scalars.return_value.all.return_value = []
    repo = SQLAlchemyWorkflowNodeExecutionRepository(
        session_factory=_session_factory(session),
        user=_mock_account(),
        app_id=None,
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    )
    repo.get_db_models_by_workflow_run("run", OrderConfig(order_by=["index"], order_direction="asc"))


def test_get_by_workflow_run_maps_to_domain(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "core.repositories.sqlalchemy_workflow_node_execution_repository.FileService",
        lambda *_: SimpleNamespace(upload_file=Mock()),
    )

    repo = SQLAlchemyWorkflowNodeExecutionRepository(
        session_factory=Mock(spec=sessionmaker),
        user=_mock_account(),
        app_id=None,
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    )

    db_models = [SimpleNamespace(id="db1"), SimpleNamespace(id="db2")]
    monkeypatch.setattr(repo, "get_db_models_by_workflow_run", lambda *_args, **_kwargs: db_models)
    monkeypatch.setattr(repo, "_to_domain_model", lambda m: f"domain:{m.id}")

    class FakeExecutor:
        def __enter__(self) -> FakeExecutor:
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def map(self, func, items, timeout: int):  # type: ignore[no-untyped-def]
            assert timeout == 30
            return list(map(func, items))

    monkeypatch.setattr(
        "core.repositories.sqlalchemy_workflow_node_execution_repository.ThreadPoolExecutor",
        lambda max_workers: FakeExecutor(),
    )

    result = repo.get_by_workflow_run("run", order_config=None)
    assert result == ["domain:db1", "domain:db2"]
