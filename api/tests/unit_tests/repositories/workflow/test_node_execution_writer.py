"""SQLite-backed tests for the workflow node execution repository."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Generator, Mapping
from contextlib import contextmanager
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlalchemy import Engine, event, select
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.app.workflow.persistence_ports import OrderConfig
from extensions.application_services.workflow_writers import build_workflow_offload_uploader
from graphon.entities import WorkflowNodeExecution
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from models import Account, EndUser
from models.enums import CreatorUserRole, ExecutionOffLoadType
from models.model import UploadFile
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionOffload, WorkflowNodeExecutionTriggeredFrom
from repositories.workflow.node_execution_writer import (
    SQLAlchemyWorkflowNodeExecutionRepository,
    _deterministic_json_dump,
    _filter_by_offload_type,
    _find_first,
)
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.model_factories import make_account, make_tenant, make_upload_file


def _account(*, tenant_id: str = "tenant-1", user_id: str = "user-1") -> Account:
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


def _execution(
    *,
    execution_id: str = "execution-1",
    node_execution_id: str = "node-execution-1",
    run_id: str = "run-1",
    index: int = 1,
    status: WorkflowNodeExecutionStatus = WorkflowNodeExecutionStatus.SUCCEEDED,
    inputs: Mapping[str, object] | None = None,
    outputs: Mapping[str, object] | None = None,
    process_data: Mapping[str, object] | None = None,
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
    factory: sessionmaker[Session] | Engine,
    *,
    tenant_id: str = "tenant-1",
    app_id: str | None = "app-1",
    user: Account | EndUser | None = None,
    triggered_from: WorkflowNodeExecutionTriggeredFrom | None = WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
) -> SQLAlchemyWorkflowNodeExecutionRepository:
    return SQLAlchemyWorkflowNodeExecutionRepository(
        session_factory=factory,
        tenant_id=tenant_id,
        user=user or _account(tenant_id=tenant_id),
        app_id=app_id,
        triggered_from=triggered_from,
        upload_file=build_workflow_offload_uploader(
            session_factory=factory, tenant_id=tenant_id, user=user or _account(tenant_id=tenant_id)
        ),
    )


@contextmanager
def _raise_on_execution_insert(engine: Engine) -> Generator[None]:
    def raise_error(
        _conn: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: object,
    ) -> None:
        if statement.lstrip().upper().startswith("INSERT") and "workflow_node_executions" in statement:
            raise RuntimeError("forced execution INSERT")

    event.listen(engine, "before_cursor_execute", raise_error)
    try:
        yield
    finally:
        event.remove(engine, "before_cursor_execute", raise_error)


def test_init_accepts_real_engine_and_sessionmaker_and_sets_role(
    sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session]
) -> None:
    engine_repo = _repository(sqlite_engine)
    assert isinstance(engine_repo._session_factory, sessionmaker)
    end_user_repo = _repository(sqlite_session_factory, user=_end_user())
    assert end_user_repo._creator_user_role.value == "end_user"


def test_init_rejects_invalid_factory_and_missing_tenant() -> None:
    with pytest.raises(ValueError, match="Invalid session_factory type"):
        SQLAlchemyWorkflowNodeExecutionRepository(
            session_factory=object(),  # type: ignore[arg-type]
            tenant_id="tenant-1",
            user=_account(),
            app_id=None,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
            upload_file=Mock(),
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
            upload_file=Mock(),
        )


def test_init_uses_resource_tenant_when_account_has_no_current_tenant(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    user = _account()
    user._current_tenant = None

    repo = _repository(
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
    inputs = _offload(ExecutionOffLoadType.INPUTS)
    outputs = _offload(ExecutionOffLoadType.OUTPUTS)
    assert _find_first([inputs, outputs], _filter_by_offload_type(ExecutionOffLoadType.OUTPUTS)) is outputs

    created: dict[str, int] = {}

    class Truncator:
        def __init__(self, *, max_size_bytes: int, array_element_limit: int, string_length_limit: int) -> None:
            created.update(
                max_size_bytes=max_size_bytes,
                array_element_limit=array_element_limit,
                string_length_limit=string_length_limit,
            )

    monkeypatch.setattr("repositories.workflow.node_execution_writer.VariableTruncator", Truncator)
    _repository(sqlite_session_factory)._create_truncator()
    assert created["max_size_bytes"] == dify_config.WORKFLOW_VARIABLE_TRUNCATION_MAX_SIZE


def test_to_db_model_uses_context_and_deterministic_json(sqlite_session_factory: sessionmaker[Session]) -> None:
    repo = _repository(sqlite_session_factory)
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
    assert db_model.execution_metadata_dict == {"total_tokens": 1}
    assert db_model.agent_workspace_binding_id is None
    assert _repository(sqlite_session_factory, app_id=None)._to_db_model(_execution()).app_id is None
    repo._triggered_from = None
    with pytest.raises(ValueError, match="triggered_from is required"):
        repo._to_db_model(_execution())


def test_to_db_model_requires_creator_context(
    monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    repo = _repository(sqlite_session_factory)
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
        def to_json_encodable(self, values: Mapping[str, object]) -> Mapping[str, object]:
            return {"wrapped": values["value"]}

    monkeypatch.setattr(
        "repositories.workflow.node_execution_writer.WorkflowRuntimeTypeConverter",
        Converter,
    )

    assert SQLAlchemyWorkflowNodeExecutionRepository._json_encode({"value": 1}) == '{"wrapped": 1}'


def test_save_inserts_and_updates_persisted_execution(sqlite_session_factory: sessionmaker[Session]) -> None:
    repo = _repository(sqlite_session_factory)
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


def test_save_owned_session_rolls_back_failed_insert(
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repo = _repository(sqlite_session_factory)
    with _raise_on_execution_insert(sqlite_engine), pytest.raises(RuntimeError, match="forced execution INSERT"):
        repo.save(_execution())
    with sqlite_session_factory() as session:
        assert session.scalar(select(WorkflowNodeExecutionModel)) is None


def test_save_execution_data_updates_existing_and_creates_missing(
    monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    repo = _repository(sqlite_session_factory)
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


@pytest.mark.parametrize("payload_changes", [False, True])
def test_offload_keeps_state_and_payload_written_during_upload(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    payload_changes: bool,
) -> None:
    apply_config_overrides(
        monkeypatch, WORKFLOW_VARIABLE_TRUNCATION_MAX_SIZE=128, WORKFLOW_VARIABLE_TRUNCATION_STRING_LENGTH=16
    )
    repo = _repository(sqlite_session_factory)
    execution = _execution(status=WorkflowNodeExecutionStatus.RUNNING, outputs={"large": "x" * 1024})
    repo.save(execution)
    completed = execution.model_copy(
        update={
            "status": WorkflowNodeExecutionStatus.SUCCEEDED,
            "finished_at": datetime.now(UTC),
            "elapsed_time": 10.0,
            "outputs": {"new": "result"} if payload_changes else execution.outputs,
        }
    )
    blobs: dict[str, bytes] = {}

    def upload(key: str, value: bytes) -> None:
        blobs[key] = value
        # Another writer commits while the original call waits for object storage.
        _repository(sqlite_session_factory).save(completed)

    monkeypatch.setattr("extensions.ext_storage.storage.save", upload)
    monkeypatch.setattr("extensions.ext_storage.storage.load", lambda key: blobs[key])
    repo.save_execution_data(execution)

    actual = _repository(sqlite_session_factory).get_by_workflow_execution("run-1")[0]
    assert actual.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert actual.elapsed_time == 10.0
    assert actual.finished_at == completed.finished_at.replace(tzinfo=None)
    assert actual.outputs == completed.outputs
    assert actual.outputs_truncated is (not payload_changes)


def test_replacing_offloaded_data_updates_and_then_removes_the_file_reference(
    monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    apply_config_overrides(
        monkeypatch, WORKFLOW_VARIABLE_TRUNCATION_MAX_SIZE=128, WORKFLOW_VARIABLE_TRUNCATION_STRING_LENGTH=16
    )
    blobs: dict[str, bytes] = {}
    monkeypatch.setattr("extensions.ext_storage.storage.save", lambda key, value: blobs.__setitem__(key, value))
    monkeypatch.setattr("extensions.ext_storage.storage.load", lambda key: blobs[key])
    repo = _repository(sqlite_session_factory)
    execution = _execution(outputs={"large": "x" * 1024})
    repo.save(execution)
    for outputs in ({"large": "x" * 1024}, {"large": "y" * 1024}, {"small": "value"}):
        repo.save_execution_data(execution.model_copy(update={"outputs": outputs}))
        actual = _repository(sqlite_session_factory).get_by_workflow_execution("run-1")[0]
        assert actual.outputs == outputs
        assert actual.outputs_truncated is ("large" in outputs)


def test_overlapping_offloads_keep_the_newer_file_when_previews_match(
    monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    apply_config_overrides(
        monkeypatch, WORKFLOW_VARIABLE_TRUNCATION_MAX_SIZE=128, WORKFLOW_VARIABLE_TRUNCATION_STRING_LENGTH=16
    )
    blobs: dict[str, bytes] = {}
    monkeypatch.setattr("extensions.ext_storage.storage.save", lambda key, value: blobs.__setitem__(key, value))
    monkeypatch.setattr("extensions.ext_storage.storage.load", lambda key: blobs[key])
    repo = _repository(sqlite_session_factory)
    execution = _execution(outputs={"large": "x" * 1024 + "initial"})
    repo.save_execution_data(execution)
    newer = execution.model_copy(update={"outputs": {"large": "x" * 1024 + "newer"}})
    nested = False

    def upload(key: str, value: bytes) -> None:
        nonlocal nested
        blobs[key] = value
        if not nested:
            nested = True
            _repository(sqlite_session_factory).save_execution_data(newer)

    monkeypatch.setattr("extensions.ext_storage.storage.save", upload)
    repo.save_execution_data(execution.model_copy(update={"outputs": {"large": "x" * 1024 + "older"}}))
    actual = _repository(sqlite_session_factory).get_by_workflow_execution("run-1")[0]
    assert actual.outputs == newer.outputs


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
    read_persisted: Callable[[WorkflowNodeExecutionModel], Mapping[str, object] | None],
    read_truncated: Callable[[WorkflowNodeExecution], Mapping[str, object] | None],
) -> None:
    repo = _repository(sqlite_session_factory)
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
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repo = _repository(sqlite_session_factory)
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
    _repository(sqlite_session_factory, tenant_id="tenant-2").save(
        _execution(execution_id="foreign-tenant", node_execution_id="foreign-tenant")
    )
    _repository(sqlite_session_factory, app_id="app-2").save(
        _execution(execution_id="foreign-app", node_execution_id="foreign-app")
    )
    _repository(
        sqlite_session_factory,
        triggered_from=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP,
    ).save(_execution(execution_id="single-step", node_execution_id="single-step"))

    models = repo.get_db_models_by_workflow_run(
        "run-1",
        OrderConfig(order_by=["missing", "index"], order_direction="desc"),
    )
    assert [model.id for model in models] == ["two", "one"]
    assert repo.get_db_models_by_workflow_run("missing-run") == []
    no_app_repo = _repository(sqlite_session_factory, app_id=None)
    assert (
        no_app_repo.get_db_models_by_workflow_run(
            "missing-run",
            OrderConfig(order_by=["missing"], order_direction="asc"),
        )
        == []
    )


def test_get_by_workflow_execution_maps_real_rows_to_domain(sqlite_session_factory: sessionmaker[Session]) -> None:
    repo = _repository(sqlite_session_factory)
    repo.save(_execution(inputs={"input": 1}, outputs={"output": 2}))
    domains = repo.get_by_workflow_execution("run-1", OrderConfig(order_by=["index"], order_direction="asc"))
    assert len(domains) == 1
    assert domains[0].inputs == {"input": 1}
    assert domains[0].outputs == {"output": 2}


def test_to_domain_model_loads_offloaded_storage(
    monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    repo = _repository(sqlite_session_factory)
    db_model = repo._to_db_model(
        _execution(
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
        "repositories.workflow.node_execution_writer.storage.load",
        lambda key: json.dumps({"full": key}).encode(),
    )
    domain = repo._to_domain_model(db_model)
    assert domain.inputs == {"full": "inputs"}
    assert domain.outputs == {"full": "outputs"}
    assert domain.process_data == {"full": "process_data"}
    assert domain.get_truncated_inputs() == {"truncated": "inputs"}
    assert domain.get_truncated_outputs() == {"truncated": "outputs"}
    assert domain.get_truncated_process_data() == {"truncated": "process_data"}


def test_truncate_and_upload_returns_none_for_missing_or_small_values(
    monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    repo = _repository(sqlite_session_factory)
    assert repo._truncate_and_upload(None, "execution-1", ExecutionOffLoadType.INPUTS) is None

    class Truncator:
        def truncate_variable_mapping(self, value: Mapping[str, object]) -> tuple[Mapping[str, object], bool]:
            return value, False

    monkeypatch.setattr(repo, "_create_truncator", lambda: Truncator())
    assert repo._truncate_and_upload({"value": 1}, "execution-1", ExecutionOffLoadType.INPUTS) is None


@pytest.mark.parametrize("creator_role", [CreatorUserRole.ACCOUNT, CreatorUserRole.END_USER])
def test_offload_round_trip_retains_full_payload_and_admitted_owner(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    creator_role: CreatorUserRole,
) -> None:
    apply_config_overrides(
        monkeypatch,
        WORKFLOW_VARIABLE_TRUNCATION_MAX_SIZE=100,
        WORKFLOW_VARIABLE_TRUNCATION_STRING_LENGTH=20,
    )
    blobs: dict[str, bytes] = {}
    monkeypatch.setattr("repositories.workflow.node_execution_writer.storage.save", blobs.__setitem__)
    monkeypatch.setattr("repositories.workflow.node_execution_writer.storage.load", blobs.__getitem__)
    user = _account(tenant_id="different-tenant") if creator_role == CreatorUserRole.ACCOUNT else _end_user()
    repo = _repository(sqlite_session_factory, user=user)
    payload = {"value": "完整 payload " * 100}
    execution = _execution(inputs=payload, outputs=payload, process_data=payload)

    repo.save(execution)
    repo.save_execution_data(execution)

    with sqlite_session_factory() as session:
        offloads = session.scalars(select(WorkflowNodeExecutionOffload)).all()
        assert {offload.type_ for offload in offloads} == set(ExecutionOffLoadType)
        for offload in offloads:
            assert (offload.tenant_id, offload.app_id, offload.node_execution_id) == ("tenant-1", "app-1", execution.id)
            file = session.get(UploadFile, offload.file_id)
            assert file is not None
            assert (file.tenant_id, file.created_by, file.created_by_role) == ("tenant-1", user.id, creator_role)
            assert file.key.startswith("upload_files/tenant-1/")
            assert file.mime_type == "application/json"
            assert file.size == len(blobs[file.key])
            assert file.hash == hashlib.sha3_256(blobs[file.key]).hexdigest()
            assert json.loads(blobs[file.key]) == payload

    reloaded = repo.get_by_workflow_execution(execution.workflow_execution_id)[0]
    assert reloaded is not None
    assert reloaded.inputs == reloaded.outputs == reloaded.process_data == payload
    assert reloaded.get_truncated_inputs() != payload
    assert reloaded.get_truncated_outputs() != payload
    assert reloaded.get_truncated_process_data() != payload


@pytest.mark.parametrize("reject_extension", [False, True])
def test_offload_rejects_disallowed_files_before_storage_or_sql(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    reject_extension: bool,
) -> None:
    apply_config_overrides(
        monkeypatch,
        inner_UPLOAD_FILE_EXTENSION_BLACKLIST="json" if reject_extension else "",
        UPLOAD_FILE_SIZE_LIMIT=15 if reject_extension else 0,
        WORKFLOW_VARIABLE_TRUNCATION_MAX_SIZE=1,
    )
    save = Mock()
    monkeypatch.setattr("repositories.workflow.node_execution_writer.storage.save", save)
    repo = _repository(sqlite_session_factory)
    from services.errors.file import BlockedFileExtensionError, FileTooLargeError

    with pytest.raises(BlockedFileExtensionError if reject_extension else FileTooLargeError):
        repo._truncate_and_upload({"value": "payload"}, "execution-1", ExecutionOffLoadType.OUTPUTS)
    save.assert_not_called()
    with sqlite_session_factory() as session:
        assert session.scalar(select(UploadFile.id)) is None
