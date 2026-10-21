"""Real repositories/domain/guard, explicit in-memory SQL and storage ports only."""

from __future__ import annotations

from collections import UserList
from collections.abc import Callable, Iterator, Mapping
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime
from typing import NoReturn, Protocol, Self, cast

import pytest
from sqlalchemy import Select
from sqlalchemy.orm import Session, sessionmaker

from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
from core.repositories.sqlalchemy_workflow_node_execution_repository import SQLAlchemyWorkflowNodeExecutionRepository
from graphon.entities import WorkflowExecution, WorkflowNodeExecution
from graphon.enums import (
    WorkflowExecutionStatus,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
    WorkflowType,
)
from models import Account, WorkflowNodeExecutionTriggeredFrom, WorkflowRun
from models.enums import CreatorUserRole, ExecutionOffLoadType, WorkflowRunTriggeredFrom
from models.model import UploadFile
from models.workflow import WorkflowNodeExecutionModel
from repositories.entities.workflow_execution import WorkflowExecution as TimedWorkflowExecution
from runtime_contracts.builder.native.runtime_contracts import ResolvedNativeTestContext
from services.dify_builder.native_testing.http_binding import build_native_http_profile
from services.dify_builder.native_testing.observation_adapters import NativeObservationError, NativeObservationGuard
from services.dify_builder.native_testing.observation_privacy import NativeHttpObservationPolicy
from services.dify_builder.native_testing.observation_repository import bind_native_repository_observation
from tests.unit_tests.services.dify_builder.native_testing.test_observation_privacy import SENTINEL, context, graph_data

NOW = datetime(2026, 10, 16)


type StoredRow = WorkflowRun | WorkflowNodeExecutionModel


class NativeRepositoryRows(UserList[WorkflowNodeExecutionModel]):
    def all(self) -> list[WorkflowNodeExecutionModel]:
        return list(self)

    def first(self) -> WorkflowNodeExecutionModel | None:
        return next(iter(self), None)

    def scalars(self) -> Self:
        return self


class SQLPort:
    """Owner query/write boundary; no SQL engine, collection or query emulation."""

    def __init__(self) -> None:
        self.rows: dict[tuple[type[StoredRow], str], StoredRow] = {}
        self.selected: list[WorkflowNodeExecutionModel] = []
        self.commits = 0
        self.fail = False
        self.writing = False

    def __call__(self, **_kwargs: object) -> Self:
        return self

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *args: object) -> bool:
        self.writing = False
        return False

    def begin(self) -> Self:
        self.writing = True
        return self

    def get[T: StoredRow](self, model: type[T], key: str, **kwargs: object) -> T | None:
        if self.fail:
            raise RuntimeError(SENTINEL)
        if kwargs.get("with_for_update"):
            self.writing = True
        result = self.rows.get((model, key))
        assert result is None or isinstance(result, model)
        return result

    def scalars(self, _statement: Select[tuple[object, ...]]) -> NativeRepositoryRows:
        if self.fail:
            raise RuntimeError(SENTINEL)
        return NativeRepositoryRows(self.selected)

    def execute(self, _statement: Select[tuple[object, ...]]) -> NativeRepositoryRows:
        return NativeRepositoryRows(self.selected)

    def merge[T: StoredRow](self, row: T) -> T:
        self.rows[type(row), row.id] = row
        return row

    def add(self, row: StoredRow) -> None:
        self.rows[type(row), row.id] = row

    def required[T: StoredRow](self, key: tuple[type[T], str]) -> T:
        result = self.rows[key]
        assert isinstance(result, key[0])
        return result

    def flush(self) -> None:
        pass

    def commit(self) -> None:
        if self.fail:
            raise RuntimeError(SENTINEL)
        self.commits += 1


@dataclass
class RepositoryCase:
    context: ResolvedNativeTestContext
    guard: NativeObservationGuard
    sql: SQLPort
    runs: SQLAlchemyWorkflowExecutionRepository
    nodes: SQLAlchemyWorkflowNodeExecutionRepository
    user: Account


@pytest.fixture
def case() -> RepositoryCase:
    ctx = context()
    user = Account(name=SENTINEL, email=SENTINEL)
    user.id = ctx.actor_id
    guard = NativeObservationGuard(
        policy=NativeHttpObservationPolicy.qualify(context=ctx, profile=build_native_http_profile()),
        on_failure=lambda: None,
    )
    sql = SQLPort()
    runs = SQLAlchemyWorkflowExecutionRepository(
        sessionmaker(), ctx.tenant_id, user, ctx.app_id, WorkflowRunTriggeredFrom.DEBUGGING
    )
    nodes = SQLAlchemyWorkflowNodeExecutionRepository(
        sessionmaker(), ctx.tenant_id, user, ctx.app_id, WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN
    )
    runs._session_factory = nodes._session_factory = cast(sessionmaker[Session], sql)
    return RepositoryCase(context=ctx, guard=guard, sql=sql, runs=runs, nodes=nodes, user=user)


def bind(c: RepositoryCase) -> None:
    assert hasattr(c.runs, "bind_native_observation"), "actual Run repository native binding is missing"
    assert hasattr(c.nodes, "bind_native_observation"), "actual node repository native binding is missing"
    bind_native_repository_observation(repository=c.runs, context=c.context, guard=c.guard)
    bind_native_repository_observation(repository=c.nodes, context=c.context, guard=c.guard)
    c.sql.rows[WorkflowRun, required_run_id(c.context)] = c.runs._to_db_model(run(c))


def run(c: RepositoryCase) -> WorkflowExecution:
    return WorkflowExecution(
        id_=required_run_id(c.context),
        workflow_id=c.context.workflow_id,
        workflow_type=WorkflowType.WORKFLOW,
        workflow_version="draft",
        graph=deepcopy(c.context.graph),
        inputs={SENTINEL: SENTINEL},
        outputs={SENTINEL: SENTINEL},
        status=WorkflowExecutionStatus.SUCCEEDED,
        error_message=SENTINEL,
        total_tokens=3,
        total_steps=2,
        exceptions_count=1,
        started_at=NOW,
        finished_at=NOW,
    )


def node(c: RepositoryCase, **updates: object) -> WorkflowNodeExecution:
    fields = {
        "id": "row",
        "node_execution_id": "execution",
        "workflow_id": c.context.workflow_id,
        "workflow_execution_id": required_run_id(c.context),
        "index": 1,
        "predecessor_node_id": "start",
        "node_id": "http",
        "node_type": "http-request",
        "title": SENTINEL,
        "inputs": {SENTINEL: SENTINEL},
        "process_data": {SENTINEL: SENTINEL},
        "outputs": {SENTINEL: SENTINEL},
        "status": WorkflowNodeExecutionStatus.SUCCEEDED,
        "error": SENTINEL,
        "elapsed_time": 0.2,
        "metadata": dict[str, object](),
        "created_at": NOW,
        "finished_at": NOW,
    }
    return WorkflowNodeExecution.model_validate({**fields, **updates})


def safe_row(c: RepositoryCase) -> WorkflowNodeExecutionModel:
    return c.nodes._to_db_model(node(c))


def test_actual_repositories_project_before_serializers_and_do_not_mutate_domain(case: RepositoryCase) -> None:
    c = case
    bind(c)
    original_run = run(c)
    original_node = node(c)
    db_run = c.runs._to_db_model(original_run)
    db_node = c.nodes._to_db_model(original_node)
    for value in [
        db_run.graph,
        db_run.inputs,
        db_run.outputs,
        db_run.error,
        db_node.title,
        db_node.inputs,
        db_node.process_data,
        db_node.outputs,
        db_node.error,
    ]:
        assert SENTINEL not in (value or "")
    assert original_node.outputs == {SENTINEL: SENTINEL}
    assert original_run.inputs == {SENTINEL: SENTINEL}
    assert db_node.node_id == "http"
    assert db_run.id == required_run_id(c.context)


def test_binding_idempotence_and_nested_original_context_drift(case: RepositoryCase) -> None:
    c = case
    bind(c)
    bind_native_repository_observation(repository=c.runs, context=deepcopy(c.context), guard=c.guard)
    graph_data(c.context)["nodes"][0]["data"]["title"] = "changed"
    with pytest.raises(NativeObservationError):
        c.runs._to_db_model(run(c))
    assert c.guard.failed


@pytest.mark.parametrize("field", ["_tenant_id", "_app_id", "_creator_user_id", "_creator_user_role"])
def test_binding_rejects_real_repository_owner_mismatch(case: RepositoryCase, field: str) -> None:
    c = case
    setattr(c.nodes, field, CreatorUserRole.END_USER if field == "_creator_user_role" else "foreign")
    with pytest.raises(NativeObservationError):
        bind(c)
    assert c.guard.failed
    assert not c.nodes._node_execution_cache


def test_binding_refuses_after_cache_or_io_even_when_cache_empty(case: RepositoryCase) -> None:
    c = case
    c.nodes.get_db_models_by_workflow_run(required_run_id(c.context))
    with pytest.raises(NativeObservationError):
        bind(c)


@pytest.mark.parametrize(
    "field",
    ["tenant_id", "app_id", "created_by", "workflow_id", "workflow_run_id", "node_id", "node_type", "title", "error"],
)
def test_retained_history_rejects_foreign_or_raw_rows_before_cache(case: RepositoryCase, field: str) -> None:
    c = case
    bind(c)
    row = safe_row(c)
    setattr(row, field, SENTINEL)
    row.offload_data = []
    c.sql.selected = [row]
    with pytest.raises(NativeObservationError):
        c.nodes.get_by_workflow_execution(required_run_id(c.context))
    assert not c.nodes._node_execution_cache


def test_all_rows_validated_before_cache_and_no_partial_exposure(case: RepositoryCase) -> None:
    c = case
    bind(c)
    first = safe_row(c)
    first.offload_data = []
    late = safe_row(c)
    late.id = "late"
    late.node_execution_id = "late"
    late.outputs = '{"raw":"' + SENTINEL + '"}'
    late.offload_data = []
    c.sql.selected = [first, late]
    with pytest.raises(NativeObservationError):
        c.nodes.get_db_models_by_workflow_run(required_run_id(c.context))
    assert c.nodes._node_execution_cache == {}


def test_safe_nonempty_history_roundtrip_uses_fresh_copies(case: RepositoryCase) -> None:
    c = case
    bind(c)
    row = safe_row(c)
    row.offload_data = []
    c.sql.selected = [row]
    result = c.nodes.get_by_workflow_execution(required_run_id(c.context))
    assert len(result) == 1
    assert result[0].outputs is not None
    assert result[0].outputs["redacted"] is True
    assert result[0].node_id == "http"
    assert result[0].elapsed_time == 0.2
    assert c.nodes._node_execution_cache["execution"] is not row
    assert SENTINEL not in str(result[0].outputs)


def test_raw_existing_process_data_cannot_resurrect_agent_binding(case: RepositoryCase) -> None:
    c = case
    bind(c)
    row = safe_row(c)
    row.process_data = '{"workflow_agent_binding_id":"' + SENTINEL + '"}'
    row.offload_data = []
    c.sql.rows[WorkflowNodeExecutionModel, row.id] = row
    with pytest.raises(NativeObservationError):
        c.nodes.save(node(c))
    assert c.sql.commits == 0
    assert not c.nodes._node_execution_cache


def test_sql_failure_latches_only_fixed_error(case: RepositoryCase) -> None:
    c = case
    bind(c)
    c.sql.fail = True
    with pytest.raises(NativeObservationError, match="native_observation_failed"):
        c.runs.save(run(c))
    assert c.guard.failed
    assert not c.runs._execution_cache


def test_native_save_execution_data_does_not_mutate_operational_domain(
    case: RepositoryCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    c = case
    bind(c)
    raw = node(c)
    monkeypatch.setattr(c.nodes, "_truncate_and_upload", lambda *_args: None)
    c.nodes.save_execution_data(raw)
    assert raw.outputs == {SENTINEL: SENTINEL}
    saved = c.sql.required((WorkflowNodeExecutionModel, "row"))
    assert saved.outputs is not None
    assert SENTINEL not in saved.outputs
    assert c.sql.commits == 1


def storage_chunks(content: bytes) -> Iterator[bytes]:
    yield content


class WrappedTelemetryFixture(Protocol):
    @property
    def __wrapped__(self) -> Callable[[], Iterator[None]]: ...


@pytest.fixture(autouse=True)
def telemetry() -> Iterator[None]:
    """Initialize/restore real test-owned sinks and routes, never mock readiness."""
    import logging

    from libs.sensitive_http_telemetry import _HTTP_LOGGERS, SensitiveHttpLogFilter
    from services.dify_builder.native_testing.observation_repository import _EMITTERS

    root = logging.getLogger()
    original_handlers = root.handlers
    emitters = _HTTP_LOGGERS + _EMITTERS
    routes = [
        logger
        for name, logger in logging.Logger.manager.loggerDict.copy().items()
        if isinstance(logger, logging.Logger)
        and any(
            name == emitter or name.startswith(emitter + ".") or emitter.startswith(name + ".") for emitter in emitters
        )
    ]
    propagation = {logger: logger.propagate for logger in routes}
    handlers = {handler for logger in [root, *routes] for handler in logger.handlers}
    filters = {handler: handler.filters[:] for handler in handlers}
    owned_handler = None
    if not original_handlers:
        owned_handler = logging.NullHandler()
        root.handlers = [owned_handler]
        handlers.add(owned_handler)
    filtering = SensitiveHttpLogFilter()
    for handler in handlers:
        handler.addFilter(filtering)
    for logger in routes:
        logger.propagate = True
    try:
        yield
    finally:
        for logger, original in propagation.items():
            logger.propagate = original
        for handler, original in filters.items():
            handler.filters = original
        root.handlers = original_handlers
        if owned_handler is not None:
            owned_handler.close()


def offloaded(c: RepositoryCase, row: WorkflowNodeExecutionModel, *, value: object = None) -> tuple[UploadFile, bytes]:
    import hashlib
    import json
    from uuid import uuid4

    from configs import dify_config
    from extensions.storage.storage_type import StorageType
    from models.enums import ExecutionOffLoadType
    from models.workflow import WorkflowNodeExecutionOffload
    from tests.unit_tests.model_factories import make_upload_file

    content = json.dumps(value if value is not None else c.guard.values({"private": SENTINEL})).encode()
    file = make_upload_file(
        storage_type=StorageType(dify_config.STORAGE_TYPE),
        tenant_id=c.context.tenant_id,
        key=f"upload_files/{c.context.tenant_id}/{uuid4()}.json",
        name=f"node_execution_{row.id}_outputs.json",
        size=len(content),
        extension="json",
        mime_type="application/json",
        created_by=c.context.actor_id,
    )
    file.hash = hashlib.sha3_256(content).hexdigest()
    link = WorkflowNodeExecutionOffload(
        tenant_id=c.context.tenant_id,
        app_id=c.context.app_id,
        node_execution_id=row.id,
        type_=ExecutionOffLoadType.OUTPUTS,
        file_id=file.id,
    )
    link.file = file
    row.offload_data = [link]
    return file, content


def test_real_offload_relation_decode_precedes_cache_and_only_loads_once(
    case: RepositoryCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    c = case
    bind(c)
    row = safe_row(c)
    file, content = offloaded(c, row)
    c.sql.selected = [row]

    storage_calls = []

    def load(key: str, *, stream: bool) -> Iterator[bytes]:
        storage_calls.append(key)
        assert stream is True
        assert not c.sql.writing
        assert not c.nodes._node_execution_cache
        assert key == file.key
        return storage_chunks(content)

    monkeypatch.setattr("extensions.ext_storage.storage.load", load)
    result = c.nodes.get_by_workflow_execution(required_run_id(c.context))
    assert result[0].outputs is not None
    assert result[0].outputs["redacted"] is True
    assert result[0].outputs is not None
    assert result[0].outputs["shape"]["fields"] == 1
    assert len(storage_calls) == 1
    cached = c.nodes._node_execution_cache["execution"]
    again = c.nodes._to_domain_model(cached)
    assert again.outputs == result[0].outputs
    assert len(storage_calls) == 1
    assert row.offload_data[0].file is file


@pytest.mark.parametrize("fault", ["tenant", "actor", "relation", "type", "hash", "raw", "late_error"])
def test_bad_offload_or_late_content_never_enters_cache(
    case: RepositoryCase, monkeypatch: pytest.MonkeyPatch, fault: str
) -> None:
    c = case
    bind(c)
    first = safe_row(c)
    first.offload_data = []
    row = safe_row(c)
    row.node_execution_id = "late"
    file, content = offloaded(c, row, value={"private": SENTINEL} if fault == "raw" else None)
    if fault == "tenant":
        file.tenant_id = "foreign"
    if fault == "actor":
        file.created_by = "foreign"
    if fault == "relation":
        row.offload_data[0].node_execution_id = "foreign"
    if fault == "type":
        row.offload_data[0].type_ = cast(ExecutionOffLoadType, "foreign")
    if fault == "hash":
        file.hash = "0" * 64
    c.sql.selected = [first, row]
    storage_calls = []

    def storage(key: str, **_kwargs: object) -> Iterator[bytes]:
        storage_calls.append(key)
        if fault == "late_error":
            raise RuntimeError(SENTINEL)
        return storage_chunks(content)

    monkeypatch.setattr("extensions.ext_storage.storage.load", storage)
    with pytest.raises(NativeObservationError, match="native_observation_failed"):
        c.nodes.get_db_models_by_workflow_run(required_run_id(c.context))
    assert c.nodes._node_execution_cache == {}
    assert c.guard.failed
    if fault in {"tenant", "actor", "relation", "type"}:
        assert storage_calls == []


def test_safe_retry_history_is_retained_and_foreign_metadata_refuses(case: RepositoryCase) -> None:
    c = case
    bind(c)
    history = {
        "retry_index": 1,
        "inputs": {"x": SENTINEL},
        "process_data": dict[str, object](),
        "outputs": {"x": SENTINEL},
        "error": SENTINEL,
        "elapsed_time": 0.2,
        "execution_metadata": {"total_tokens": 1},
        "created_at": 1,
        "finished_at": 2,
    }
    row = c.nodes._to_db_model(node(c, process_data={"__dify_retry_history": [history]}))
    row.offload_data = []
    c.sql.selected = [row]
    result = c.nodes.get_by_workflow_execution(required_run_id(c.context))
    assert result[0].process_data is not None
    assert result[0].process_data["__dify_retry_history"][0]["retry_index"] == 1
    assert SENTINEL not in str(result[0].process_data)
    row.execution_metadata = '{"unknown":"' + SENTINEL + '"}'
    before = dict(c.nodes._node_execution_cache)
    with pytest.raises(NativeObservationError):
        c.nodes.get_db_models_by_workflow_run(required_run_id(c.context))
    assert c.nodes._node_execution_cache == before


def test_bound_run_history_refuses_raw_graph_values_and_owner(case: RepositoryCase) -> None:
    c = case
    bind(c)
    row = c.runs._to_db_model(run(c))
    row.outputs = '{"raw":"' + SENTINEL + '"}'
    with pytest.raises(NativeObservationError):
        c.runs._to_domain_model(row)
    assert not c.runs._execution_cache


def test_node_history_checks_actual_run_owner_even_when_node_fields_match(case: RepositoryCase) -> None:
    c = case
    bind(c)
    row = safe_row(c)
    row.offload_data = []
    c.sql.selected = [row]
    c.sql.required((WorkflowRun, required_run_id(c.context))).app_id = "foreign"
    with pytest.raises(NativeObservationError):
        c.nodes.get_db_models_by_workflow_run(required_run_id(c.context))
    assert not c.nodes._node_execution_cache


def test_native_actual_truncation_uploads_only_safe_data_then_cache_has_no_second_io(
    case: RepositoryCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    import hashlib
    from uuid import uuid4

    from services.variable_truncator import VariableTruncator
    from tests.unit_tests.model_factories import make_upload_file

    c = case
    bind(c)
    files: dict[str, UploadFile] = {}
    bodies = {}
    monkeypatch.setattr(
        c.nodes,
        "_create_truncator",
        lambda: VariableTruncator(max_size_bytes=48, string_length_limit=8, array_element_limit=2),
    )

    def upload(*, filename: str, content: bytes, mimetype: str, user: Account, tenant_id: str) -> UploadFile:
        assert not c.sql.writing
        assert SENTINEL.encode() not in content
        from configs import dify_config
        from extensions.storage.storage_type import StorageType

        file = make_upload_file(
            storage_type=StorageType(dify_config.STORAGE_TYPE),
            tenant_id=tenant_id,
            key=f"upload_files/{tenant_id}/{uuid4()}.json",
            name=filename,
            size=len(content),
            extension="json",
            mime_type=mimetype,
            created_by=user.id,
        )
        file.hash = hashlib.sha3_256(content).hexdigest()
        files[file.id] = file
        bodies[file.key] = content
        return file

    monkeypatch.setattr(c.nodes._file_service, "upload_file", upload)
    raw = node(c)
    c.nodes.save_execution_data(raw)
    assert len(files) == 3
    assert raw.outputs == {SENTINEL: SENTINEL}
    stored = c.sql.required((WorkflowNodeExecutionModel, "row"))
    assert len(stored.offload_data) == 3
    storage_calls: list[tuple[tuple[object, ...], dict[str, object]]] = []

    def storage(*args: object, **kwargs: object) -> NoReturn:
        storage_calls.append((args, kwargs))
        raise AssertionError("cached validated data loaded storage again")

    monkeypatch.setattr("extensions.ext_storage.storage.load", storage)
    cached = c.nodes._to_domain_model(c.nodes._node_execution_cache["execution"])
    assert cached.outputs is not None
    assert cached.outputs["redacted"] is True
    assert storage_calls == []
    # The SQL port explicitly resolves real offload→UploadFile relationships for a fresh query.
    for link in stored.offload_data:
        link.file = files[link.file_id]
    c.sql.selected = [stored]
    read_keys = []

    def reads(key: str, **_kwargs: object) -> Iterator[bytes]:
        read_keys.append(key)
        return storage_chunks(bodies[key])

    monkeypatch.setattr("extensions.ext_storage.storage.load", reads)
    history = c.nodes.get_by_workflow_execution(required_run_id(c.context))
    assert history[0].outputs == cached.outputs
    assert len(read_keys) == 3


def test_empty_success_error_remains_empty(case: RepositoryCase) -> None:
    c = case
    bind(c)
    row = c.nodes._to_db_model(node(c, error=""))
    assert row.error == ""
    assert row.status is WorkflowNodeExecutionStatus.SUCCEEDED


def test_history_owner_objects_cannot_spoof_equality_or_get_rendered(case: RepositoryCase) -> None:
    c = case
    bind(c)
    calls: list[str] = []

    class Spoof:
        def __eq__(self, other: object) -> bool:
            calls.append("eq")
            return True

        def __ne__(self, other: object) -> bool:
            calls.append("ne")
            return False

        def __repr__(self) -> str:
            calls.append("repr")
            return SENTINEL

    row = safe_row(c)
    row.tenant_id = cast(str, Spoof())
    row.offload_data = []
    c.sql.selected = [row]
    with pytest.raises(NativeObservationError):
        c.nodes.get_db_models_by_workflow_run(required_run_id(c.context))
    assert calls == []
    assert c.nodes._node_execution_cache == {}


def test_foreign_storage_type_refuses_before_load(case: RepositoryCase, monkeypatch: pytest.MonkeyPatch) -> None:
    from extensions.storage.storage_type import StorageType

    c = case
    bind(c)
    row = safe_row(c)
    file, content = offloaded(c, row)
    c.sql.selected = [row]
    file.storage_type = next(item for item in StorageType if item != file.storage_type)
    load_calls: list[tuple[tuple[object, ...], dict[str, object]]] = []

    def load(*args: object, **kwargs: object) -> bytes:
        load_calls.append((args, kwargs))
        return content

    monkeypatch.setattr("extensions.ext_storage.storage.load", load)
    with pytest.raises(NativeObservationError):
        c.nodes.get_db_models_by_workflow_run(required_run_id(c.context))
    assert load_calls == []


def test_context_drift_during_offload_refuses_before_cache(
    case: RepositoryCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    c = case
    bind(c)
    row = safe_row(c)
    file, content = offloaded(c, row)
    c.sql.selected = [row]

    def load(_: str, *, stream: bool) -> Iterator[bytes]:
        assert stream is True
        graph_data(c.context)["nodes"][0]["data"]["title"] = "drift"
        return storage_chunks(content)

    monkeypatch.setattr("extensions.ext_storage.storage.load", load)
    with pytest.raises(NativeObservationError):
        c.nodes.get_db_models_by_workflow_run(required_run_id(c.context))
    assert c.nodes._node_execution_cache == {}


def test_writer_recheck_failure_notifies_guard_only_after_writer_exit(
    case: RepositoryCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    c = case
    notifications: list[bool] = []
    c.guard = NativeObservationGuard(policy=c.guard._policy, on_failure=lambda: notifications.append(c.sql.writing))
    bind(c)
    row = safe_row(c)
    row.offload_data = []
    c.sql.rows[WorkflowNodeExecutionModel, row.id] = row
    original = c.sql.get

    def get[T: StoredRow](model: type[T], key: str, **kwargs: object) -> T | None:
        result = original(model, key, **kwargs)
        if model is WorkflowNodeExecutionModel and kwargs.get("with_for_update"):
            assert result is not None
            cast(WorkflowNodeExecutionModel, result).outputs = '{"raw":"' + SENTINEL + '"}'
        return result

    monkeypatch.setattr(c.sql, "get", get)
    with pytest.raises(NativeObservationError):
        c.nodes.save(node(c))
    assert notifications == [False]
    assert c.sql.commits == 0
    assert c.nodes._node_execution_cache == {}


def test_bounded_offload_stream_closes_before_failure_notification(
    case: RepositoryCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    c = case
    events: list[str] = []
    c.guard = NativeObservationGuard(policy=c.guard._policy, on_failure=lambda: events.append("notified"))
    bind(c)
    row = safe_row(c)
    file, content = offloaded(c, row)
    c.sql.selected = [row]

    def chunks() -> Iterator[bytes]:
        try:
            yield content[:1]
            yield b"x" * file.size
            events.append("overread")
            yield content
        finally:
            events.append("closed")

    def load(key: str, **kwargs: object) -> Iterator[bytes]:
        assert key == file.key
        assert kwargs.get("stream") is True
        return chunks()

    monkeypatch.setattr("extensions.ext_storage.storage.load", load)
    with pytest.raises(NativeObservationError):
        c.nodes.get_db_models_by_workflow_run(required_run_id(c.context))
    assert events == ["closed", "notified"]
    assert c.nodes._node_execution_cache == {}


def test_public_native_run_read_returns_owned_detached_general_status(case: RepositoryCase) -> None:
    c = case
    bind(c)
    assert hasattr(c.runs, "get_native_observation_run"), "public owned Run history read is missing"
    row = c.sql.required((WorkflowRun, required_run_id(c.context)))
    restored = c.runs.get_native_observation_run(workflow_run_id=required_run_id(c.context))
    assert restored.id_ == required_run_id(c.context)
    assert restored.workflow_id == c.context.workflow_id
    assert restored.status is WorkflowExecutionStatus.SUCCEEDED
    assert restored.outputs != {SENTINEL: SENTINEL}
    assert c.runs._execution_cache[row.id] is not row
    assert isinstance(restored.outputs, dict)
    restored.outputs["changed"] = True
    assert "changed" not in c.runs._execution_cache[row.id].outputs_dict


def test_public_native_run_read_wrong_id_refuses_before_sql(
    case: RepositoryCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    c = case
    bind(c)
    assert hasattr(c.runs, "get_native_observation_run"), "public owned Run history read is missing"
    read_calls: list[tuple[tuple[object, ...], dict[str, object]]] = []

    def read(*args: object, **kwargs: object) -> NoReturn:
        read_calls.append((args, kwargs))
        raise AssertionError("unexpected SQL")

    monkeypatch.setattr(c.sql, "get", read)
    with pytest.raises(NativeObservationError):
        c.runs.get_native_observation_run(workflow_run_id="foreign-run")
    assert read_calls == []
    assert c.runs._execution_cache == {}


@pytest.mark.parametrize("configuration", ["empty-root", "unfiltered-named-route", "nonpropagating-named-route"])
def test_test_owned_telemetry_initializes_and_restores_actual_logging_routes(
    case: RepositoryCase, monkeypatch: pytest.MonkeyPatch, configuration: str
) -> None:
    import logging

    from libs.sensitive_http_telemetry import SensitiveHttpLogFilter

    root = logging.getLogger()
    route = logging.getLogger("sqlalchemy.engine")
    if configuration == "empty-root":
        monkeypatch.setattr(root, "handlers", [])
    else:
        handler = logging.NullHandler()
        if configuration == "nonpropagating-named-route":
            handler.addFilter(SensitiveHttpLogFilter())
        monkeypatch.setattr(route, "handlers", [handler])
        monkeypatch.setattr(route, "propagate", configuration != "nonpropagating-named-route")
    original_handlers = root.handlers
    original_route_handlers = route.handlers
    original_propagation = route.propagate
    filters = {handler: handler.filters[:] for handler in [*root.handlers, *route.handlers]}
    setup = cast(WrappedTelemetryFixture, telemetry).__wrapped__()
    next(setup)
    try:
        bind(case)
        assert root.handlers
        assert not case.guard.failed
    finally:
        next(setup, None)
    assert root.handlers is original_handlers
    assert route.handlers is original_route_handlers
    assert route.propagate is original_propagation
    assert all(handler.filters == expected for handler, expected in filters.items())


@pytest.mark.parametrize("elapsed_time", [None, 0.0, 7.25])
def test_timed_native_run_preserves_settled_duration_through_projection_and_owned_history(
    case: RepositoryCase, elapsed_time: None | float
) -> None:
    c = case
    bind(c)
    original = TimedWorkflowExecution.model_validate(
        {
            **run(c).model_dump(),
            "status": WorkflowExecutionStatus.PAUSED,
            "finished_at": None,
            "accumulated_elapsed_time": elapsed_time,
        }
    )
    c.runs.save(original)
    saved = c.sql.required((WorkflowRun, required_run_id(c.context)))
    expected = elapsed_time if elapsed_time is not None else 0.0
    assert saved.elapsed_time == expected
    assert saved.finished_at is None
    assert SENTINEL not in (saved.inputs or "")
    assert original.inputs == {SENTINEL: SENTINEL}
    restored = c.runs.get_native_observation_run(workflow_run_id=required_run_id(c.context))
    assert type(restored) is TimedWorkflowExecution
    assert restored.accumulated_elapsed_time == expected
    assert restored.elapsed_time == expected
    assert restored.status is WorkflowExecutionStatus.PAUSED
    assert not c.guard.failed


def test_unrecognized_timed_run_subclass_still_refuses_before_writes(case: RepositoryCase) -> None:
    class UntrustedRun(TimedWorkflowExecution):
        pass

    c = case
    bind(c)
    execution = UntrustedRun(**run(c).model_dump(), accumulated_elapsed_time=3.0)
    with pytest.raises(NativeObservationError):
        c.runs.save(execution)
    assert c.sql.commits == 0
    assert not c.runs._execution_cache
    assert c.guard.failed


@pytest.mark.parametrize("elapsed_time", [True, -1.0, float("nan"), float("inf")])
def test_mutated_timed_native_run_refuses_invalid_duration_before_writes(
    case: RepositoryCase, elapsed_time: object
) -> None:
    c = case
    bind(c)
    execution = TimedWorkflowExecution(**run(c).model_dump(), accumulated_elapsed_time=0.0)
    # The upstream DTO is mutable; the repository boundary must revalidate it.
    execution.accumulated_elapsed_time = cast(float | None, elapsed_time)
    with pytest.raises(NativeObservationError):
        c.runs.save(execution)
    assert c.sql.commits == 0
    assert not c.runs._execution_cache
    assert c.guard.failed


def test_native_history_adoption_restores_active_duration_after_entity_json_roundtrip(
    case: RepositoryCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Timing callback/repository unit test; C03/claim authority is not qualified here."""
    from core.app.app_config.entities import WorkflowUIBasedAppConfig
    from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
    from core.workflow.system_variables import build_system_variables
    from graphon.engine.command import InMemoryChannel
    from graphon.engine_events import GraphRunStartedEvent, GraphRunSucceededEvent
    from graphon.entities import WorkflowStartReason
    from graphon.runtime import ReadOnlyRuntimeStateWrapper, RuntimeState, VariablePool
    from models.model import AppMode
    from services.workflow_persistence import PersistenceWorkflowInfo, WorkflowPersistenceLayer

    c = case
    bind(c)
    clock = [100.0]
    monkeypatch.setattr("repositories.entities.workflow_execution.perf_counter", lambda: clock[0])
    monkeypatch.setattr("services.workflow_persistence._inspector_publish_workflow_completed", lambda **_: None)
    entity = WorkflowAppGenerateEntity(
        task_id="task",
        workflow_execution_id=required_run_id(c.context),
        app_config=WorkflowUIBasedAppConfig(
            tenant_id=c.context.tenant_id,
            app_id=c.context.app_id,
            workflow_id=c.context.workflow_id,
            app_mode=AppMode.WORKFLOW,
        ),
        inputs={SENTINEL: SENTINEL},
        files=[],
        user_id=c.context.actor_id,
        stream=True,
        invoke_from=InvokeFrom.DEBUGGER,
        native_test_required=True,
        native_test_ref=c.context.ref,
    )
    total = 0.0
    for index, duration in enumerate((2.0, 3.0, 4.0)):
        runtime = RuntimeState(
            workflow_id=c.context.workflow_id,
            variable_pool=VariablePool.from_bootstrap(
                system_variables=build_system_variables(workflow_execution_id=required_run_id(c.context))
            ),
            start_at=clock[0],
        )
        layer = WorkflowPersistenceLayer(
            application_generate_entity=entity,
            workflow_info=PersistenceWorkflowInfo(
                workflow_id=c.context.workflow_id,
                workflow_type=WorkflowType.WORKFLOW,
                version="draft",
                graph_data=c.context.graph,
            ),
            workflow_execution_repository=c.runs,
            workflow_node_execution_repository=c.nodes,
            native_observation=c.guard,
        )
        layer.initialize(ReadOnlyRuntimeStateWrapper(runtime), InMemoryChannel())
        layer.on_graph_start()
        if index == 0:
            layer.on_event(GraphRunStartedEvent())
        else:
            # Supply actual checked history at the internal timing-adoption
            # callback boundary. Public on_event still owns C03 host/claim checks.
            restored_run = c.runs.get_native_observation_run(workflow_run_id=required_run_id(c.context))
            assert isinstance(restored_run, TimedWorkflowExecution)
            layer._workflow_execution = restored_run
            layer._handle_graph_run_started(GraphRunStartedEvent(reason=WorkflowStartReason.RESUMPTION))
        row = c.sql.required((WorkflowRun, required_run_id(c.context)))
        assert row.status is WorkflowExecutionStatus.RUNNING
        assert row.elapsed_time == total
        clock[0] += duration
        total += duration
        paused = index < 2
        if paused:
            # Graphon 0.8's application aggregate owns durable pause. Exercise
            # its timing/SQL boundary here without claiming C03 admission.
            execution = layer.workflow_execution
            layer._populate_completion_statistics(execution)
            execution.status = WorkflowExecutionStatus.PAUSED
            c.runs.save_synchronously(execution)
        else:
            layer.on_event(GraphRunSucceededEvent())
        row = c.sql.required((WorkflowRun, required_run_id(c.context)))
        assert row.elapsed_time == total
        assert row.status is (WorkflowExecutionStatus.PAUSED if paused else WorkflowExecutionStatus.SUCCEEDED)
        clock[0] += 1000.0
        assert entity.workflow_execution_timing.finish() == total
        if paused:
            # Same serialization as NativeHostLaunch.snapshot_wait/restore_claimed_host.
            serialized = entity.model_dump_json()
            assert "workflow_execution_timing" not in serialized
            entity = WorkflowAppGenerateEntity.model_validate_json(serialized)
            assert entity.workflow_execution_timing.elapsed_time == 0.0
    assert c.sql.required((WorkflowRun, required_run_id(c.context))).elapsed_time == 9.0
    assert not c.guard.failed


@pytest.mark.parametrize("outputs", [None, {}])
def test_first_native_node_accepts_initial_run_after_output_insert_default(
    case: RepositoryCase, monkeypatch: pytest.MonkeyPatch, outputs: None | dict[str, object]
) -> None:
    """The first node reloads an initial Run whose absent outputs must stay absent."""
    import json

    c = case
    bind(c)
    c.sql.rows.clear()
    actual_merge = c.sql.merge
    column = WorkflowRun.__table__.c.outputs
    assert column.type.should_evaluate_none is False
    assert column.default.arg == "{}"

    def merge_with_output_default[T: StoredRow](row: T) -> T:
        # SQLAlchemy omits None-valued columns with should_evaluate_none=False.
        # Its actual declared insert default then materializes this value.
        if type(row) is WorkflowRun and row.outputs is None:
            row.outputs = column.default.arg
        return actual_merge(row)

    monkeypatch.setattr(c.sql, "merge", merge_with_output_default)
    initial = run(c)
    initial.status = WorkflowExecutionStatus.RUNNING
    initial.outputs = outputs
    initial.finished_at = None
    c.runs.save(initial)
    c.nodes.save(node(c))

    saved = c.sql.required((WorkflowRun, required_run_id(c.context)))
    assert saved.outputs is not None
    assert json.loads(saved.outputs) == (
        None
        if outputs is None
        else {
            "redacted": True,
            "shape": {"type": "object", "fields": 0, "values": []},
        }
    )
    assert (WorkflowNodeExecutionModel, "row") in c.sql.rows
    assert initial.outputs == outputs
    assert not c.guard.failed


def test_native_history_refuses_unmarked_empty_run_outputs(case: RepositoryCase) -> None:
    c = case
    bind(c)
    row = c.sql.required((WorkflowRun, required_run_id(c.context)))
    row.outputs = "{}"

    with pytest.raises(NativeObservationError):
        c.nodes.save(node(c))

    assert c.guard.failed
    assert not c.nodes._node_execution_cache


@pytest.mark.parametrize("metadata", [None, {}])
def test_native_node_absent_metadata_roundtrips_without_mutating_domain(
    case: RepositoryCase, metadata: None | dict[str, object]
) -> None:
    c = case
    bind(c)
    execution = node(c, metadata=metadata)

    c.nodes.save(execution)

    saved = c.sql.required((WorkflowNodeExecutionModel, "row"))
    restored = c.nodes._to_domain_model(saved)
    assert restored.metadata == {}
    assert execution.metadata == metadata
    assert not c.guard.failed


@pytest.mark.parametrize("metadata", [[], False, ""])
def test_native_node_non_none_malformed_metadata_refuses_before_write(case: RepositoryCase, metadata: object) -> None:
    c = case
    bind(c)
    execution = node(c)
    execution.metadata = cast(Mapping[WorkflowNodeExecutionMetadataKey, object], metadata)

    with pytest.raises(NativeObservationError):
        c.nodes.save(execution)

    assert c.guard.failed
    assert c.sql.commits == 0
    assert c.nodes._node_execution_cache == {}


@pytest.mark.parametrize("repository_name", ["runs", "nodes"])
def test_service_binding_requires_exact_guard_before_attaching_observer(
    case: RepositoryCase, repository_name: str
) -> None:
    repository = {"runs": case.runs, "nodes": case.nodes}[repository_name]
    with pytest.raises(NativeObservationError, match="^native_observation_failed$"):
        bind_native_repository_observation(
            repository=repository, context=case.context, guard=cast(NativeObservationGuard, object())
        )
    assert repository._native_observation is None
    assert not repository._native_observation_started


@pytest.mark.parametrize("repository_name", ["runs", "nodes"])
def test_repository_cannot_replace_retained_observer_even_with_same_guard(
    case: RepositoryCase, repository_name: str
) -> None:
    from services.dify_builder.native_testing.observation_repository import NativeRepositoryObservation

    bind(case)
    repository = {"runs": case.runs, "nodes": case.nodes}[repository_name]
    original = repository._native_observation
    replacement = NativeRepositoryObservation(repository=repository, context=case.context, guard=case.guard)
    with pytest.raises(NativeObservationError, match="^native_observation_failed$"):
        repository.bind_native_observation(observation=replacement)
    assert repository._native_observation is original
    assert case.guard.failed


def required_run_id(context: ResolvedNativeTestContext) -> str:
    assert context.native_run_id is not None
    return context.native_run_id
