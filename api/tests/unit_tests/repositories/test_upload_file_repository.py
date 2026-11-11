import base64
import json
from collections.abc import Generator, Sequence

import pytest
from pymysql.err import OperationalError as PyMySQLOperationalError
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom, WorkflowAppGenerateEntity
from core.app.layers.pause_state_persist_layer import WorkflowResumptionContext, _WorkflowGenerateEntityWrapper
from core.workflow.file_reference import build_file_reference
from enums.creator import CreatorUserRole
from factories.variable_factory import build_segment
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus
from graphon.variables import SegmentType
from graphon.variables.utils import dumps_with_segments
from models import WorkflowType
from models.enums import ExecutionOffLoadType, WorkflowRunTriggeredFrom
from models.model import AppMode, IconType, UploadFile
from models.workflow import (
    WorkflowDraftVariable,
    WorkflowDraftVariableFile,
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionOffload,
    WorkflowNodeExecutionTriggeredFrom,
    WorkflowPause,
    WorkflowRun,
)
from repositories.app.upload_file_references import get_referenced_upload_file_ids as get_app_file_references
from repositories.file.reference_queries import payload_reference_predicate
from repositories.file.upload_file_reclamation import SQLAlchemyUploadFileReclaimer
from repositories.file.upload_file_repository import (
    UploadFileRepository,
    lock_and_validate_owned_upload_files_in_session,
)
from repositories.workflow import upload_file_references as workflow_upload_file_references
from repositories.workflow.upload_file_references import get_referenced_upload_file_ids
from services.entities.upload_file import UploadFileReferenceCandidate
from services.errors.file import UploadFileReferenceNotFoundError
from services.file_adapters import build_upload_file_reclaimer
from tests.helpers.unit.model_factories import make_app, make_upload_file


def _workflow_execution(*, inputs: str = "{}") -> WorkflowNodeExecutionModel:
    return WorkflowNodeExecutionModel(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        workflow_run_id="run-1",
        index=1,
        predecessor_node_id=None,
        node_execution_id="node-execution-1",
        node_id="node-1",
        node_type="code",
        title="Code",
        inputs=inputs,
        process_data=None,
        outputs=None,
        status=WorkflowNodeExecutionStatus.SUCCEEDED,
        error=None,
        elapsed_time=0,
        execution_metadata=None,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
        finished_at=None,
    )


def _serialized_pause_state(reference: str) -> bytes:
    context = WorkflowResumptionContext(
        generate_entity=_WorkflowGenerateEntityWrapper(
            entity=WorkflowAppGenerateEntity(
                task_id="task-1",
                app_config=WorkflowUIBasedAppConfig(
                    tenant_id="tenant-1",
                    app_id="app-1",
                    app_mode=AppMode.WORKFLOW,
                    workflow_id="workflow-1",
                ),
                inputs={},
                files=[],
                user_id="account-1",
                user_from=UserFrom.ACCOUNT,
                stream=False,
                invoke_from=InvokeFrom.DEBUGGER,
                workflow_execution_id="run-1",
            )
        ),
        serialized_graph_runtime_state=json.dumps({"file": {"reference": reference}}),
    )
    return context.dumps().encode()


def _stream_bytes(payload: bytes) -> Generator[bytes]:
    yield payload


def _add_execution_offload(session: Session, *, suffix: str, tenant_id: str = "tenant-1") -> str:
    offload_upload = make_upload_file(
        file_id=f"offload-{tenant_id}-{suffix}",
        tenant_id=tenant_id,
        key=f"uploads/{tenant_id}/offload-{suffix}.json",
    )
    execution = _workflow_execution()
    execution.id = f"execution-{tenant_id}-{suffix}"
    execution.tenant_id = tenant_id
    execution.app_id = f"app-{tenant_id}"
    execution.workflow_id = f"workflow-{tenant_id}"
    execution.workflow_run_id = f"run-{tenant_id}-{suffix}"
    execution.node_execution_id = f"node-execution-{tenant_id}-{suffix}"
    session.add_all([offload_upload, execution])
    session.flush()
    session.add(
        WorkflowNodeExecutionOffload(
            tenant_id=tenant_id,
            app_id=execution.app_id,
            node_execution_id=execution.id,
            type_=ExecutionOffLoadType.INPUTS,
            file_id=offload_upload.id,
        )
    )
    session.flush()
    return offload_upload.key


def _add_active_pause(session: Session, *, suffix: str, tenant_id: str = "tenant-1") -> str:
    state_object_key = f"workflow-state-{tenant_id}-{suffix}.json"
    run = WorkflowRun(
        id=f"run-{tenant_id}-{suffix}",
        tenant_id=tenant_id,
        app_id=f"app-{tenant_id}",
        workflow_id=f"workflow-{tenant_id}",
        type=WorkflowType.WORKFLOW,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="1",
        status=WorkflowExecutionStatus.PAUSED,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
    )
    session.add_all(
        [
            run,
            WorkflowPause(
                workflow_id=run.workflow_id,
                workflow_run_id=run.id,
                state_object_key=state_object_key,
            ),
        ]
    )
    session.flush()
    return state_object_key


def test_reference_lock_rejects_an_empty_file_id(sqlite_session: Session) -> None:
    with pytest.raises(UploadFileReferenceNotFoundError) as error:
        lock_and_validate_owned_upload_files_in_session(
            sqlite_session,
            tenant_id="tenant-1",
            upload_file_ids=("",),
        )

    assert error.value.missing_file_ids == ("",)
    assert (
        lock_and_validate_owned_upload_files_in_session(
            sqlite_session,
            tenant_id="tenant-1",
            upload_file_ids=(),
        )
        == {}
    )


def test_orphaned_offload_and_unbound_draft_file_do_not_retain_candidate(sqlite_session: Session) -> None:
    candidate = make_upload_file(file_id="candidate", key="uploads/candidate.txt")
    unrelated = make_upload_file(file_id="unrelated", key="uploads/unrelated.txt")
    sqlite_session.add_all([candidate, unrelated])
    sqlite_session.add(
        WorkflowNodeExecutionOffload(
            tenant_id="tenant-1",
            app_id="app-1",
            node_execution_id=None,
            type_=ExecutionOffLoadType.OUTPUTS,
            file_id=unrelated.id,
        )
    )
    sqlite_session.add(
        WorkflowDraftVariableFile(
            tenant_id="tenant-1",
            app_id="app-1",
            user_id="account-1",
            upload_file_id=unrelated.id,
            size=2,
            length=None,
            value_type=SegmentType.STRING,
        )
    )
    sqlite_session.flush()

    assert (
        get_referenced_upload_file_ids(
            sqlite_session,
            tenant_id="tenant-1",
            candidates=(UploadFileReferenceCandidate(id=candidate.id, key=candidate.key),),
        )
        == set()
    )


def test_offload_and_draft_file_retain_only_their_uploads(sqlite_session: Session) -> None:
    offload_upload = make_upload_file(file_id="offload", key="uploads/offload.json")
    draft_upload = make_upload_file(file_id="draft", key="uploads/draft.json")
    unreferenced = make_upload_file(file_id="unreferenced", key="uploads/unreferenced.txt")
    sqlite_session.add_all([offload_upload, draft_upload, unreferenced])
    sqlite_session.add(
        WorkflowNodeExecutionOffload(
            tenant_id="tenant-1",
            app_id="app-1",
            node_execution_id=None,
            type_=ExecutionOffLoadType.OUTPUTS,
            file_id=offload_upload.id,
        )
    )
    sqlite_session.add(
        WorkflowDraftVariableFile(
            tenant_id="tenant-1",
            app_id="app-1",
            user_id="account-1",
            upload_file_id=draft_upload.id,
            size=2,
            length=None,
            value_type=SegmentType.STRING,
        )
    )
    sqlite_session.flush()

    assert get_referenced_upload_file_ids(
        sqlite_session,
        tenant_id="tenant-1",
        candidates=(
            UploadFileReferenceCandidate(id=offload_upload.id, key=offload_upload.key),
            UploadFileReferenceCandidate(id=draft_upload.id, key=draft_upload.key),
            UploadFileReferenceCandidate(id=unreferenced.id, key=unreferenced.key),
        ),
    ) == {offload_upload.id, draft_upload.id}


def test_canonical_workflow_payload_reference_retains_candidate(sqlite_session: Session) -> None:
    candidate = make_upload_file(file_id="candidate", key="uploads/candidate.txt")
    reference = build_file_reference(record_id=candidate.id)
    assert candidate.id not in reference
    sqlite_session.add_all(
        [
            candidate,
            _workflow_execution(inputs=json.dumps({"file": {"reference": reference}})),
        ]
    )
    sqlite_session.flush()

    assert get_referenced_upload_file_ids(
        sqlite_session,
        tenant_id="tenant-1",
        candidates=(UploadFileReferenceCandidate(id=candidate.id, key=candidate.key),),
    ) == {candidate.id}


def test_payload_prefilter_targets_candidate_canonical_reference() -> None:
    candidate = UploadFileReferenceCandidate(id="candidate", key="uploads/candidate.txt")
    predicate = payload_reference_predicate((WorkflowNodeExecutionModel.inputs,), (candidate,))
    parameters = tuple(str(value) for value in predicate.compile().params.values())
    candidate_reference = build_file_reference(record_id=candidate.id, storage_key="legacy/key")
    unrelated_reference = build_file_reference(record_id="unrelated", storage_key="legacy/key")
    canonical_tokens = tuple(
        value.strip("%") for value in parameters if candidate.id not in value and candidate.key not in value
    )

    assert "%dify-file-ref:%" not in parameters
    assert len(canonical_tokens) == 3
    assert any(token in candidate_reference for token in canonical_tokens)
    assert all(token not in unrelated_reference for token in canonical_tokens)


def test_noncompact_canonical_workflow_reference_retains_candidate(sqlite_session: Session) -> None:
    candidate = make_upload_file(file_id="candidate", key="uploads/candidate.txt")
    encoded = base64.urlsafe_b64encode(
        json.dumps(
            {"storage_key": "legacy/key", "record_id": candidate.id},
            indent=2,
        ).encode()
    ).decode()
    reference = f"dify-file-ref:{encoded}"
    assert candidate.id not in reference
    sqlite_session.add_all(
        [
            candidate,
            _workflow_execution(inputs=json.dumps({"file": {"reference": reference}})),
        ]
    )
    sqlite_session.flush()

    assert get_referenced_upload_file_ids(
        sqlite_session,
        tenant_id="tenant-1",
        candidates=(UploadFileReferenceCandidate(id=candidate.id, key=candidate.key),),
    ) == {candidate.id}


def test_malformed_canonical_workflow_reference_does_not_abort_liveness_check(sqlite_session: Session) -> None:
    candidate = make_upload_file(file_id="candidate", key="uploads/candidate.txt")
    sqlite_session.add_all(
        [
            candidate,
            _workflow_execution(inputs=json.dumps({"file": {"reference": "dify-file-ref:W10="}})),
        ]
    )
    sqlite_session.flush()

    assert (
        get_referenced_upload_file_ids(
            sqlite_session,
            tenant_id="tenant-1",
            candidates=(UploadFileReferenceCandidate(id=candidate.id, key=candidate.key),),
        )
        == set()
    )


def test_live_execution_offload_retains_referenced_candidate(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    candidate = make_upload_file(file_id="candidate", key="uploads/candidate.txt")
    offload_upload = make_upload_file(file_id="offload", key="uploads/offload.json")
    execution = _workflow_execution()
    sqlite_session.add_all([candidate, offload_upload, execution])
    sqlite_session.flush()
    sqlite_session.add(
        WorkflowNodeExecutionOffload(
            tenant_id="tenant-1",
            app_id="app-1",
            node_execution_id=execution.id,
            type_=ExecutionOffLoadType.INPUTS,
            file_id=offload_upload.id,
        )
    )
    sqlite_session.flush()
    monkeypatch.setattr(
        "repositories.workflow.upload_file_references.storage.load_stream",
        lambda _key: _stream_bytes(
            json.dumps({"file": {"reference": build_file_reference(record_id=candidate.id)}}).encode()
        ),
    )

    assert get_referenced_upload_file_ids(
        sqlite_session,
        tenant_id="tenant-1",
        candidates=(UploadFileReferenceCandidate(id=candidate.id, key=candidate.key),),
    ) == {candidate.id}


def test_unrelated_execution_offload_does_not_retain_candidate(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    candidate = make_upload_file(
        file_id="candidate",
        key="uploads/candidate.txt",
    )
    offload_upload = make_upload_file(
        file_id="offload",
        key="uploads/offload.json",
    )
    execution = _workflow_execution()
    sqlite_session.add_all([candidate, offload_upload, execution])
    sqlite_session.flush()
    sqlite_session.add(
        WorkflowNodeExecutionOffload(
            tenant_id="tenant-1",
            app_id="app-1",
            node_execution_id=execution.id,
            type_=ExecutionOffLoadType.INPUTS,
            file_id=offload_upload.id,
        )
    )
    sqlite_session.flush()
    monkeypatch.setattr(
        "repositories.workflow.upload_file_references.storage.load_stream",
        lambda _key: _stream_bytes(
            json.dumps({"file": {"reference": build_file_reference(record_id="unrelated")}}).encode()
        ),
    )

    assert (
        get_referenced_upload_file_ids(
            sqlite_session,
            tenant_id="tenant-1",
            candidates=(
                UploadFileReferenceCandidate(
                    id=candidate.id,
                    key=candidate.key,
                ),
            ),
        )
        == set()
    )


def test_bound_draft_offload_retains_referenced_candidate(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    candidate = make_upload_file(file_id="candidate", key="uploads/candidate.txt")
    offload_upload = make_upload_file(file_id="draft", key="uploads/draft.json")
    app = make_app(app_id="app-1", tenant_id="tenant-1")
    draft_file = WorkflowDraftVariableFile(
        tenant_id="tenant-1",
        app_id=app.id,
        user_id="account-1",
        upload_file_id=offload_upload.id,
        size=2,
        length=None,
        value_type=SegmentType.STRING,
    )
    sqlite_session.add_all([candidate, offload_upload, app, draft_file])
    sqlite_session.flush()
    variable = WorkflowDraftVariable.new_node_variable(
        app_id=app.id,
        user_id="account-1",
        node_id="node-1",
        name="value",
        value=build_segment("truncated"),
        node_execution_id="node-execution-1",
    )
    variable.file_id = draft_file.id
    sqlite_session.add(variable)
    sqlite_session.flush()
    monkeypatch.setattr(
        "repositories.workflow.upload_file_references.storage.load_stream",
        lambda _key: _stream_bytes(
            dumps_with_segments({"file": {"reference": build_file_reference(record_id=candidate.id)}}).encode()
        ),
    )

    assert get_referenced_upload_file_ids(
        sqlite_session,
        tenant_id="tenant-1",
        candidates=(UploadFileReferenceCandidate(id=candidate.id, key=candidate.key),),
    ) == {candidate.id}


def test_active_pause_retains_referenced_candidate(sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    candidate = make_upload_file(file_id="candidate", key="uploads/candidate.txt")
    run = WorkflowRun(
        id="run-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        type=WorkflowType.WORKFLOW,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version="1",
        status=WorkflowExecutionStatus.PAUSED,
        created_by_role=candidate.created_by_role,
        created_by="account-1",
    )
    sqlite_session.add_all(
        [
            candidate,
            run,
            WorkflowPause(
                workflow_id=run.workflow_id,
                workflow_run_id=run.id,
                state_object_key="workflow-state.json",
            ),
        ]
    )
    sqlite_session.flush()
    monkeypatch.setattr(
        "repositories.workflow.upload_file_references.storage.load_stream",
        lambda _key: _stream_bytes(_serialized_pause_state(build_file_reference(record_id=candidate.id))),
    )

    assert get_referenced_upload_file_ids(
        sqlite_session,
        tenant_id="tenant-1",
        candidates=(UploadFileReferenceCandidate(id=candidate.id, key=candidate.key),),
    ) == {candidate.id}


def test_opaque_payload_scan_at_row_limit_is_complete_and_uses_sql_limits(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(workflow_upload_file_references, "_OPAQUE_PAYLOAD_ROW_LIMIT", 2)
    candidate = make_upload_file(file_id="row-boundary-candidate", key="uploads/row-boundary.txt")
    execution_key = _add_execution_offload(sqlite_session, suffix="row-boundary")
    pause_key = _add_active_pause(sqlite_session, suffix="row-boundary-pause")
    sqlite_session.add(candidate)
    sqlite_session.flush()

    loaded_keys: list[str] = []

    def load_stream(key: str) -> Generator[bytes]:
        loaded_keys.append(key)
        return _stream_bytes(b"{}")

    monkeypatch.setattr(workflow_upload_file_references.storage, "load_stream", load_stream)
    engine = sqlite_session.get_bind()
    opaque_selects: list[str] = []

    def capture_opaque_selects(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        normalized = statement.lower()
        selects_key = "select upload_files" in normalized and " join workflow_" in normalized
        selects_pause_state = "select workflow_pauses.state_object_key" in normalized
        if selects_key or selects_pause_state:
            opaque_selects.append(normalized)

    event.listen(engine, "before_cursor_execute", capture_opaque_selects)
    try:
        referenced = get_referenced_upload_file_ids(
            sqlite_session,
            tenant_id="tenant-1",
            candidates=(UploadFileReferenceCandidate(id=candidate.id, key=candidate.key),),
        )
    finally:
        event.remove(engine, "before_cursor_execute", capture_opaque_selects)

    assert referenced == set()
    assert loaded_keys == [execution_key, pause_key]
    assert len(opaque_selects) == 3
    assert all(" limit " in statement for statement in opaque_selects)


def test_cross_source_row_overflow_retains_all_candidates_without_blob_deletion(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setattr(workflow_upload_file_references, "_OPAQUE_PAYLOAD_ROW_LIMIT", 2)
    candidates = (
        make_upload_file(file_id="row-overflow-a", key="uploads/row-overflow-a.txt"),
        make_upload_file(file_id="row-overflow-b", key="uploads/row-overflow-b.txt"),
    )
    with sqlite_session_factory.begin() as session:
        session.add_all(candidates)
        _add_execution_offload(session, suffix="row-overflow")

        app = make_app(app_id="row-overflow-app", tenant_id="tenant-1")
        draft_upload = make_upload_file(file_id="row-overflow-draft", key="uploads/row-overflow-draft.json")
        draft_file = WorkflowDraftVariableFile(
            tenant_id="tenant-1",
            app_id=app.id,
            user_id="account-1",
            upload_file_id=draft_upload.id,
            size=2,
            length=None,
            value_type=SegmentType.STRING,
        )
        session.add_all([app, draft_upload, draft_file])
        session.flush()
        variable = WorkflowDraftVariable.new_node_variable(
            app_id=app.id,
            user_id="account-1",
            node_id="row-overflow-node",
            name="value",
            value=build_segment("truncated"),
            node_execution_id="row-overflow-node-execution",
        )
        variable.file_id = draft_file.id
        session.add(variable)
        _add_active_pause(session, suffix="row-overflow-pause")

    def unexpected_load(_key: str) -> Generator[bytes]:
        pytest.fail("row-overflow detection must happen before object storage reads")

    def unexpected_candidate_batches(
        _candidates: Sequence[UploadFileReferenceCandidate],
    ) -> tuple[tuple[UploadFileReferenceCandidate, ...], ...]:
        pytest.fail("retaining every candidate must skip subsequent workflow SQL")

    monkeypatch.setattr(workflow_upload_file_references.storage, "load_stream", unexpected_load)
    monkeypatch.setattr(workflow_upload_file_references, "candidate_batches", unexpected_candidate_batches)
    deleted_blob_keys: list[str] = []
    files = UploadFileRepository(session_factory=sqlite_session_factory)

    deleted_ids = build_upload_file_reclaimer(
        session_factory=sqlite_session_factory,
        files=files,
    ).delete_unreferenced_files(
        tenant_id="tenant-1",
        file_ids=tuple(candidate.id for candidate in candidates),
        delete_blob=deleted_blob_keys.append,
    )

    assert deleted_ids == ()
    assert deleted_blob_keys == []
    assert "exceeded the row limit" in caplog.text
    with sqlite_session_factory() as session:
        assert all(session.get(UploadFile, candidate.id) is not None for candidate in candidates)


def test_opaque_payload_row_budget_excludes_other_tenants(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(workflow_upload_file_references, "_OPAQUE_PAYLOAD_ROW_LIMIT", 2)
    candidate = make_upload_file(file_id="tenant-candidate", tenant_id="tenant-1", key="uploads/tenant.txt")
    sqlite_session.add(candidate)
    for index in range(3):
        _add_execution_offload(sqlite_session, suffix=f"other-tenant-{index}", tenant_id="tenant-2")
    sqlite_session.flush()

    def unexpected_load(_key: str) -> Generator[bytes]:
        pytest.fail("another tenant's opaque payload must not be loaded")

    monkeypatch.setattr(workflow_upload_file_references.storage, "load_stream", unexpected_load)

    assert (
        get_referenced_upload_file_ids(
            sqlite_session,
            tenant_id="tenant-1",
            candidates=(UploadFileReferenceCandidate(id=candidate.id, key=candidate.key),),
        )
        == set()
    )


def test_opaque_payload_byte_overflow_closes_stream_and_skips_later_payloads(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setattr(workflow_upload_file_references, "_OPAQUE_PAYLOAD_BYTE_LIMIT", 4)
    candidate = make_upload_file(file_id="byte-overflow-candidate", key="uploads/byte-overflow.txt")
    first_key = _add_execution_offload(sqlite_session, suffix="byte-overflow")
    _add_active_pause(sqlite_session, suffix="byte-overflow-pause")
    sqlite_session.add(candidate)
    sqlite_session.flush()

    loaded_keys: list[str] = []
    stream_closed = False

    def oversized_stream() -> Generator[bytes]:
        nonlocal stream_closed
        try:
            yield b"12345"
        finally:
            stream_closed = True

    def load_stream(key: str) -> Generator[bytes]:
        loaded_keys.append(key)
        if key != first_key:
            pytest.fail("byte-overflow must prevent reading subsequent payloads")
        return oversized_stream()

    def unexpected_candidate_batches(
        _candidates: Sequence[UploadFileReferenceCandidate],
    ) -> tuple[tuple[UploadFileReferenceCandidate, ...], ...]:
        pytest.fail("byte-overflow retention must skip subsequent workflow SQL")

    monkeypatch.setattr(workflow_upload_file_references.storage, "load_stream", load_stream)
    monkeypatch.setattr(workflow_upload_file_references, "candidate_batches", unexpected_candidate_batches)

    assert get_referenced_upload_file_ids(
        sqlite_session,
        tenant_id="tenant-1",
        candidates=(UploadFileReferenceCandidate(id=candidate.id, key=candidate.key),),
    ) == {candidate.id}
    assert loaded_keys == [first_key]
    assert stream_closed
    assert "exceeded the repository byte-buffer limit" in caplog.text


def test_opaque_payload_byte_budget_accumulates_across_payloads(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setattr(workflow_upload_file_references, "_OPAQUE_PAYLOAD_BYTE_LIMIT", 10)
    candidate = make_upload_file(file_id="cumulative-byte-candidate", key="uploads/cumulative-byte.txt")
    _add_execution_offload(sqlite_session, suffix="cumulative-byte-first")
    _add_execution_offload(sqlite_session, suffix="cumulative-byte-second")
    _add_active_pause(sqlite_session, suffix="cumulative-byte-third")
    sqlite_session.add(candidate)
    sqlite_session.flush()

    loaded_keys: list[str] = []
    closed_streams: list[int] = []

    def payload_stream(stream_index: int) -> Generator[bytes]:
        try:
            yield b'{"a":1}'
        finally:
            closed_streams.append(stream_index)

    def load_stream(key: str) -> Generator[bytes]:
        stream_index = len(loaded_keys)
        loaded_keys.append(key)
        if stream_index >= 2:
            pytest.fail("cumulative byte overflow must prevent reading the third payload")
        return payload_stream(stream_index)

    def unexpected_candidate_batches(
        _candidates: Sequence[UploadFileReferenceCandidate],
    ) -> tuple[tuple[UploadFileReferenceCandidate, ...], ...]:
        pytest.fail("cumulative byte-overflow retention must skip subsequent workflow SQL")

    monkeypatch.setattr(workflow_upload_file_references.storage, "load_stream", load_stream)
    monkeypatch.setattr(workflow_upload_file_references, "candidate_batches", unexpected_candidate_batches)

    assert get_referenced_upload_file_ids(
        sqlite_session,
        tenant_id="tenant-1",
        candidates=(UploadFileReferenceCandidate(id=candidate.id, key=candidate.key),),
    ) == {candidate.id}
    assert len(loaded_keys) == 2
    assert closed_streams == [0, 1]
    assert "exceeded the repository byte-buffer limit" in caplog.text


def _reclaim_and_count_selects(
    sessions: sessionmaker[Session],
    *,
    candidates: Sequence[tuple[str, str]],
) -> int:
    with sessions.begin() as session:
        session.add_all(make_upload_file(file_id=file_id, tenant_id="tenant-1", key=key) for file_id, key in candidates)

    engine = sessions.kw["bind"]
    assert isinstance(engine, Engine)
    select_count = 0

    def count_selects(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        nonlocal select_count
        if statement.lstrip().upper().startswith("SELECT"):
            select_count += 1

    event.listen(engine, "before_cursor_execute", count_selects)
    try:
        files = UploadFileRepository(session_factory=sessions)
        build_upload_file_reclaimer(session_factory=sessions, files=files).delete_unreferenced_files(
            tenant_id="tenant-1",
            file_ids=tuple(file_id for file_id, _key in candidates),
            delete_blob=lambda _key: None,
        )
    finally:
        event.remove(engine, "before_cursor_execute", count_selects)
    return select_count


def test_reference_queries_are_batched_across_candidates(sqlite_session_factory: sessionmaker[Session]) -> None:
    one_candidate_selects = _reclaim_and_count_selects(
        sqlite_session_factory,
        candidates=(("single-candidate", "uploads/single.txt"),),
    )
    multiple_candidate_selects = _reclaim_and_count_selects(
        sqlite_session_factory,
        candidates=tuple((f"batch-candidate-{index}", f"uploads/batch-{index}.txt") for index in range(3)),
    )

    assert multiple_candidate_selects <= one_candidate_selects + 2


def test_owner_lock_conflict_aborts_reclamation(sqlite_session_factory: sessionmaker[Session]) -> None:
    candidate = make_upload_file(file_id="lock-conflict", tenant_id="tenant-1", key="uploads/locked.txt")
    owner = make_app(app_id="lock-conflict-owner", tenant_id=candidate.tenant_id)
    with sqlite_session_factory.begin() as session:
        session.add_all((candidate, owner))

    def owner_query(
        session: Session,
        *,
        tenant_id: str,
        candidates: Sequence[UploadFileReferenceCandidate],
    ) -> set[str]:
        del session
        assert tenant_id == "tenant-1"
        assert tuple(stored.id for stored in candidates) == (candidate.id,)
        raise OperationalError(
            "SELECT owner",
            {},
            PyMySQLOperationalError(3572, "Statement aborted because lock(s) could not be acquired immediately"),
        )

    deleted_blob_keys: list[str] = []
    files = UploadFileRepository(session_factory=sqlite_session_factory)
    reclaimer = SQLAlchemyUploadFileReclaimer(
        session_factory=sqlite_session_factory,
        files=files,
        reference_queries=(owner_query,),
    )

    def delete_owner_and_reclaim() -> None:
        with sqlite_session_factory.begin() as session:
            session.delete(session.get_one(type(owner), owner.id))
            session.flush()
            reclaimer.delete_unreferenced_files_in_session(
                session,
                tenant_id="tenant-1",
                file_ids=(candidate.id,),
                delete_blob=deleted_blob_keys.append,
            )

    with pytest.raises(OperationalError):
        delete_owner_and_reclaim()

    assert deleted_blob_keys == []
    with sqlite_session_factory() as session:
        assert session.get(UploadFile, candidate.id) is not None
        assert session.get(type(owner), owner.id) is not None


def test_non_lock_owner_query_error_aborts_reclamation(sqlite_session_factory: sessionmaker[Session]) -> None:
    candidate = make_upload_file(file_id="query-failure", tenant_id="tenant-1", key="uploads/query-failure.txt")
    with sqlite_session_factory.begin() as session:
        session.add(candidate)

    database_error = OperationalError(
        "SELECT owner",
        {},
        PyMySQLOperationalError(2006, "MySQL server has gone away"),
    )

    def owner_query(
        session: Session,
        *,
        tenant_id: str,
        candidates: Sequence[UploadFileReferenceCandidate],
    ) -> set[str]:
        del session
        assert tenant_id == "tenant-1"
        assert tuple(stored.id for stored in candidates) == (candidate.id,)
        raise database_error

    deleted_blob_keys: list[str] = []
    files = UploadFileRepository(session_factory=sqlite_session_factory)
    reclaimer = SQLAlchemyUploadFileReclaimer(
        session_factory=sqlite_session_factory,
        files=files,
        reference_queries=(owner_query,),
    )

    with pytest.raises(OperationalError) as error:
        reclaimer.delete_unreferenced_files(
            tenant_id="tenant-1",
            file_ids=(candidate.id,),
            delete_blob=deleted_blob_keys.append,
        )

    assert error.value is database_error
    assert deleted_blob_keys == []
    with sqlite_session_factory() as session:
        assert session.get(UploadFile, candidate.id) is not None


def _standalone_reclaimer(sessions: sessionmaker[Session]) -> SQLAlchemyUploadFileReclaimer:
    return SQLAlchemyUploadFileReclaimer(
        session_factory=sessions,
        files=UploadFileRepository(session_factory=sessions),
        reference_queries=(get_app_file_references,),
    )


def test_blob_deletion_follows_owner_and_file_commit(sqlite_session_factory: sessionmaker[Session]) -> None:
    upload = make_upload_file(file_id="commit-file", key="uploads/commit.txt")
    app = make_app(app_id="commit-app", tenant_id=upload.tenant_id)
    app.icon = upload.id
    app.icon_type = IconType.IMAGE
    with sqlite_session_factory.begin() as session:
        session.add_all([upload, app])

    deleted: list[str] = []

    def delete_blob(key: str) -> None:
        with sqlite_session_factory() as reader:
            assert reader.get(type(app), app.id) is None
            assert reader.get(UploadFile, upload.id) is None
        deleted.append(key)

    with sqlite_session_factory.begin() as session:
        session.delete(session.get_one(type(app), app.id))
        session.flush()
        _standalone_reclaimer(sqlite_session_factory).delete_unreferenced_files_in_session(
            session, tenant_id=upload.tenant_id, file_ids=(upload.id,), delete_blob=delete_blob
        )
        assert deleted == []
    assert deleted == [upload.key]


def test_commit_failure_restores_owner_without_deleting_blob(sqlite_session_factory: sessionmaker[Session]) -> None:
    upload = make_upload_file(file_id="rollback-file", key="uploads/rollback.txt")
    app = make_app(app_id="rollback-app", tenant_id=upload.tenant_id)
    app.icon = upload.id
    app.icon_type = IconType.IMAGE
    with sqlite_session_factory.begin() as session:
        session.add_all([upload, app])
    deleted: list[str] = []

    def fail_commit(_session: Session) -> None:
        raise ConnectionError("commit rejected")

    with sqlite_session_factory() as session:
        session.delete(session.get_one(type(app), app.id))
        session.flush()
        _standalone_reclaimer(sqlite_session_factory).delete_unreferenced_files_in_session(
            session, tenant_id=upload.tenant_id, file_ids=(upload.id,), delete_blob=deleted.append
        )
        event.listen(session, "before_commit", fail_commit)
        with pytest.raises(ConnectionError, match="commit rejected"):
            session.commit()
        session.rollback()

    assert deleted == []
    with sqlite_session_factory() as reader:
        assert reader.get(UploadFile, upload.id) is not None
        assert reader.get_one(type(app), app.id).icon == upload.id


def test_savepoint_commit_does_not_delete_blobs_before_outer_commit(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    upload = make_upload_file(file_id="savepoint-file", key="uploads/savepoint.txt")
    with sqlite_session_factory.begin() as session:
        session.add(upload)
    deleted: list[str] = []
    with sqlite_session_factory.begin() as session:
        _standalone_reclaimer(sqlite_session_factory).delete_unreferenced_files_in_session(
            session, tenant_id=upload.tenant_id, file_ids=(upload.id,), delete_blob=deleted.append
        )
        with session.begin_nested():
            pass
        assert deleted == []
    assert deleted == [upload.key]


def test_savepoint_rollback_discards_only_its_blob_deletions(sqlite_session_factory: sessionmaker[Session]) -> None:
    uploads = [make_upload_file(file_id=f"nested-{index}", key=f"uploads/nested-{index}.txt") for index in range(2)]
    with sqlite_session_factory.begin() as session:
        session.add_all(uploads)
    deleted: list[str] = []
    reclaimer = _standalone_reclaimer(sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        reclaimer.delete_unreferenced_files_in_session(
            session, tenant_id=uploads[0].tenant_id, file_ids=(uploads[0].id,), delete_blob=deleted.append
        )
        savepoint = session.begin_nested()
        reclaimer.delete_unreferenced_files_in_session(
            session, tenant_id=uploads[1].tenant_id, file_ids=(uploads[1].id,), delete_blob=deleted.append
        )
        savepoint.rollback()
        assert deleted == []
    assert deleted == [uploads[0].key]
    with sqlite_session_factory() as reader:
        assert reader.get(UploadFile, uploads[1].id) is not None


def test_closing_and_reusing_session_cannot_publish_abandoned_blob_deletions(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    upload = make_upload_file(file_id="abandoned-file", key="uploads/abandoned.txt")
    with sqlite_session_factory.begin() as session:
        session.add(upload)
    deleted: list[str] = []
    session = sqlite_session_factory()
    _standalone_reclaimer(sqlite_session_factory).delete_unreferenced_files_in_session(
        session, tenant_id=upload.tenant_id, file_ids=(upload.id,), delete_blob=deleted.append
    )
    session.close()
    with session.begin():
        pass
    session.close()
    assert deleted == []
    with sqlite_session_factory() as reader:
        assert reader.get(UploadFile, upload.id) is not None


def test_post_commit_storage_failure_keeps_discoverable_blob(
    sqlite_session_factory: sessionmaker[Session], caplog: pytest.LogCaptureFixture
) -> None:
    upload = make_upload_file(file_id="orphan-file", key="upload_files/tenant-1/orphan.txt")
    with sqlite_session_factory.begin() as session:
        session.add(upload)
    blobs = {upload.key}

    def delete_blob(_key: str) -> None:
        raise OSError("storage unavailable")

    _standalone_reclaimer(sqlite_session_factory).delete_unreferenced_files(
        tenant_id=upload.tenant_id, file_ids=(upload.id,), delete_blob=delete_blob
    )
    with sqlite_session_factory() as reader:
        assert reader.get(UploadFile, upload.id) is None
    assert blobs == {upload.key}
    assert upload.key in caplog.text
