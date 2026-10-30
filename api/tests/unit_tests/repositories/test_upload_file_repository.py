import base64
import json
from collections.abc import Sequence
from typing import cast

import pytest
from pymysql.err import OperationalError as PyMySQLOperationalError
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
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
from repositories.file.upload_file_reclamation import SQLAlchemyUploadFileReclaimer, UploadFileReferenceQuery
from repositories.file.upload_file_repository import (
    UploadFileRepository,
    lock_and_validate_owned_upload_files_in_session,
)
from repositories.workflow.upload_file_references import get_referenced_upload_file_ids
from services.entities.upload_file import UploadFileReferenceCandidate
from services.errors.file import UploadFileReferenceNotFoundError
from services.file_adapters import build_upload_file_reclaimer
from tests.unit_tests.model_factories import make_app, make_upload_file


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
                stream=False,
                invoke_from=InvokeFrom.DEBUGGER,
                workflow_execution_id="run-1",
            )
        ),
        serialized_graph_runtime_state=json.dumps({"file": {"reference": reference}}),
    )
    return context.dumps().encode()


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
        "repositories.workflow.upload_file_references.storage.load",
        lambda _key: json.dumps({"file": {"reference": build_file_reference(record_id=candidate.id)}}).encode(),
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
        "repositories.workflow.upload_file_references.storage.load",
        lambda _key: json.dumps({"file": {"reference": build_file_reference(record_id="unrelated")}}).encode(),
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
        "repositories.workflow.upload_file_references.storage.load",
        lambda _key: dumps_with_segments(
            {"file": {"reference": build_file_reference(record_id=candidate.id)}}
        ).encode(),
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
        "repositories.workflow.upload_file_references.storage.load",
        lambda _key: _serialized_pause_state(build_file_reference(record_id=candidate.id)),
    )

    assert get_referenced_upload_file_ids(
        sqlite_session,
        tenant_id="tenant-1",
        candidates=(UploadFileReferenceCandidate(id=candidate.id, key=candidate.key),),
    ) == {candidate.id}


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
        _session: Session,
        *,
        tenant_id: str,
        candidates: Sequence[UploadFileReferenceCandidate],
    ) -> set[str]:
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
        reference_queries=(cast(UploadFileReferenceQuery, owner_query),),
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
        _session: Session,
        *,
        tenant_id: str,
        candidates: Sequence[UploadFileReferenceCandidate],
    ) -> set[str]:
        assert tenant_id == "tenant-1"
        assert tuple(stored.id for stored in candidates) == (candidate.id,)
        raise database_error

    deleted_blob_keys: list[str] = []
    files = UploadFileRepository(session_factory=sqlite_session_factory)
    reclaimer = SQLAlchemyUploadFileReclaimer(
        session_factory=sqlite_session_factory,
        files=files,
        reference_queries=(cast(UploadFileReferenceQuery, owner_query),),
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
