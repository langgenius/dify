from datetime import datetime
from typing import cast
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy import Table
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from graphon.enums import WorkflowExecutionStatus
from models.dataset import Document
from models.enums import IndexingStatus
from models.workflow import WorkflowRun
from models.workflow_handoff import (
    RagPipelineHandoffGroupIdentity,
    RagPipelineQueueKind,
    WorkflowHandoffResumeRoute,
    WorkflowHandoffState,
    WorkflowRunHandoff,
)
from repositories.rag_pipeline_handoff_group_repository import SQLAlchemyRagPipelineHandoffGroupRepository

NOW = datetime(2026, 7, 28, 15, 0, 0)
WORKFLOW_RUN_TABLE = cast(Table, WorkflowRun.__table__)
WORKFLOW_RUN_HANDOFF_TABLE = cast(Table, WorkflowRunHandoff.__table__)
DOCUMENT_TABLE = cast(Table, Document.__table__)


def _workflow_run(run_id: str, tenant_id: str, status: WorkflowExecutionStatus) -> dict[str, object]:
    return {
        "id": run_id,
        "tenant_id": tenant_id,
        "app_id": str(uuid4()),
        "workflow_id": str(uuid4()),
        "type": "rag-pipeline",
        "triggered_from": "rag-pipeline-run",
        "version": "1",
        "status": status,
        "created_by_role": "account",
        "created_by": str(uuid4()),
    }


def _handoff(
    run_id: str,
    identity: RagPipelineHandoffGroupIdentity,
    *,
    isolated: bool | None = True,
) -> dict[str, object]:
    return {
        "workflow_run_id": run_id,
        "generation": 1,
        "task_id": f"task-{run_id}",
        "snapshot_object_key": f"snapshot-{run_id}",
        "snapshot_schema_version": "v1",
        "snapshot_checksum": "checksum",
        "snapshot_size_bytes": 1,
        "resume_route": WorkflowHandoffResumeRoute.RAG_PIPELINE,
        "source_worker_id": "worker-old",
        "state": WorkflowHandoffState.RESUMED,
        "resumed_at": NOW,
        "rag_source_batch_id": identity.source_batch_id,
        "rag_tenant_id": identity.tenant_id,
        "rag_queue_kind": identity.queue_kind,
        "rag_dataset_id": identity.tenant_id,
        "rag_tenant_isolated": isolated,
        "rag_group_sealed_at": None,
    }


def test_group_release_requires_seal_and_all_workflow_runs_terminal_and_is_cas_once() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    WORKFLOW_RUN_TABLE.create(engine)
    WORKFLOW_RUN_HANDOFF_TABLE.create(engine)
    tenant_id = str(uuid4())
    run_ids = [str(uuid4()), str(uuid4())]
    identity = RagPipelineHandoffGroupIdentity(
        source_batch_id="source-file-1",
        tenant_id=tenant_id,
        queue_kind=RagPipelineQueueKind.REGULAR,
    )
    with engine.begin() as connection:
        connection.execute(
            WORKFLOW_RUN_TABLE.insert(),
            [
                _workflow_run(run_ids[0], tenant_id, WorkflowExecutionStatus.RUNNING),
                _workflow_run(run_ids[1], tenant_id, WorkflowExecutionStatus.SUCCEEDED),
            ],
        )
        connection.execute(
            WORKFLOW_RUN_HANDOFF_TABLE.insert(),
            [_handoff(run_id, identity) for run_id in run_ids],
        )
    session_factory = sessionmaker(bind=engine, class_=Session, expire_on_commit=False)
    repository = SQLAlchemyRagPipelineHandoffGroupRepository(session_factory)

    assert not repository.mark_released_once(identity=identity, released_at=NOW)
    assert repository.seal_group(identity=identity, sealed_at=NOW) == 2
    snapshot = repository.get_group(identity)
    assert snapshot is not None
    assert snapshot.sealed_at == NOW
    assert snapshot.has_running_workflow_runs
    assert not repository.mark_released_once(identity=identity, released_at=NOW)

    with session_factory.begin() as session:
        partially_unsealed = session.scalar(
            sa.select(WorkflowRunHandoff).where(WorkflowRunHandoff.workflow_run_id == run_ids[1])
        )
        assert partially_unsealed is not None
        partially_unsealed.rag_group_sealed_at = None
    partially_sealed_snapshot = repository.get_group(identity)
    assert partially_sealed_snapshot is not None
    assert partially_sealed_snapshot.sealed_at is None
    assert not repository.mark_released_once(identity=identity, released_at=NOW)
    assert repository.seal_group(identity=identity, sealed_at=NOW) == 2

    with session_factory.begin() as session:
        running = session.get(WorkflowRun, run_ids[0])
        assert running is not None
        running.status = WorkflowExecutionStatus.STOPPED

    assert repository.mark_released_once(identity=identity, released_at=NOW)
    assert not repository.mark_released_once(identity=identity, released_at=NOW)
    released = repository.get_group(identity)
    assert released is not None
    assert released.released_at == NOW


def test_scanner_lists_sealed_and_unsealed_groups_for_heartbeat_compensation() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    WORKFLOW_RUN_TABLE.create(engine)
    WORKFLOW_RUN_HANDOFF_TABLE.create(engine)
    tenant_id = str(uuid4())
    run_id = str(uuid4())
    identity = RagPipelineHandoffGroupIdentity(
        source_batch_id=str(uuid4()),
        tenant_id=tenant_id,
        queue_kind=RagPipelineQueueKind.PRIORITY,
    )
    unsealed_run_id = str(uuid4())
    unsealed_identity = RagPipelineHandoffGroupIdentity(
        source_batch_id=str(uuid4()),
        tenant_id=tenant_id,
        queue_kind=RagPipelineQueueKind.REGULAR,
    )
    row = _handoff(run_id, identity)
    row["rag_group_sealed_at"] = NOW
    with engine.begin() as connection:
        connection.execute(
            WORKFLOW_RUN_TABLE.insert(),
            [
                _workflow_run(run_id, tenant_id, WorkflowExecutionStatus.STOPPED),
                _workflow_run(unsealed_run_id, tenant_id, WorkflowExecutionStatus.STOPPED),
            ],
        )
        connection.execute(
            WORKFLOW_RUN_HANDOFF_TABLE.insert(),
            [row, _handoff(unsealed_run_id, unsealed_identity)],
        )
    repository = SQLAlchemyRagPipelineHandoffGroupRepository(
        sessionmaker(bind=engine, class_=Session, expire_on_commit=False)
    )

    assert set(repository.list_reconcilable_groups(limit=10)) == {identity, unsealed_identity}


def test_group_with_missing_isolation_ownership_is_rejected_by_schema() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    WORKFLOW_RUN_TABLE.create(engine)
    WORKFLOW_RUN_HANDOFF_TABLE.create(engine)
    tenant_id = str(uuid4())
    run_id = str(uuid4())
    identity = RagPipelineHandoffGroupIdentity(
        source_batch_id="source-file-missing-ownership",
        tenant_id=tenant_id,
        queue_kind=RagPipelineQueueKind.REGULAR,
    )
    with engine.begin() as connection:
        connection.execute(
            WORKFLOW_RUN_TABLE.insert(),
            _workflow_run(run_id, tenant_id, WorkflowExecutionStatus.STOPPED),
        )
    with engine.begin() as connection, pytest.raises(IntegrityError):
        connection.execute(WORKFLOW_RUN_HANDOFF_TABLE.insert(), _handoff(run_id, identity, isolated=None))


def test_permanently_failed_latest_handoff_marks_owned_document_error_once() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    WORKFLOW_RUN_TABLE.create(engine)
    WORKFLOW_RUN_HANDOFF_TABLE.create(engine)
    DOCUMENT_TABLE.create(engine)
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    document_id = str(uuid4())
    completed_document_id = str(uuid4())
    run_id = str(uuid4())
    completed_run_id = str(uuid4())
    identity = RagPipelineHandoffGroupIdentity(
        source_batch_id="source-file-3",
        tenant_id=tenant_id,
        queue_kind=RagPipelineQueueKind.PRIORITY,
    )
    row = _handoff(run_id, identity)
    row.update(
        state=WorkflowHandoffState.FAILED,
        resumed_at=None,
        failed_at=NOW,
        last_error="resume attempts exhausted",
        rag_dataset_id=dataset_id,
        rag_document_id=document_id,
        rag_group_sealed_at=NOW,
    )
    completed_row = _handoff(completed_run_id, identity)
    completed_row.update(
        state=WorkflowHandoffState.FAILED,
        resumed_at=None,
        failed_at=NOW,
        last_error="stale resume failure",
        rag_dataset_id=dataset_id,
        rag_document_id=completed_document_id,
        rag_group_sealed_at=NOW,
    )
    with engine.begin() as connection:
        connection.execute(
            WORKFLOW_RUN_TABLE.insert(),
            [
                _workflow_run(run_id, tenant_id, WorkflowExecutionStatus.STOPPED),
                _workflow_run(completed_run_id, tenant_id, WorkflowExecutionStatus.SUCCEEDED),
            ],
        )
        connection.execute(
            DOCUMENT_TABLE.insert(),
            [
                {
                    "id": document_id,
                    "tenant_id": tenant_id,
                    "dataset_id": dataset_id,
                    "position": 1,
                    "data_source_type": "upload_file",
                    "data_source_info": "{}",
                    "batch": "batch",
                    "name": "source.txt",
                    "created_from": "rag-pipeline",
                    "created_by": str(uuid4()),
                    "doc_form": "text_model",
                    "indexing_status": IndexingStatus.WAITING,
                    "completed_at": None,
                },
                {
                    "id": completed_document_id,
                    "tenant_id": tenant_id,
                    "dataset_id": dataset_id,
                    "position": 2,
                    "data_source_type": "upload_file",
                    "data_source_info": "{}",
                    "batch": "batch",
                    "name": "already-completed.txt",
                    "created_from": "rag-pipeline",
                    "created_by": str(uuid4()),
                    "doc_form": "text_model",
                    "indexing_status": IndexingStatus.COMPLETED,
                    "completed_at": NOW,
                },
            ],
        )
        connection.execute(WORKFLOW_RUN_HANDOFF_TABLE.insert(), [row, completed_row])
    session_factory = sessionmaker(bind=engine, class_=Session, expire_on_commit=False)
    repository = SQLAlchemyRagPipelineHandoffGroupRepository(session_factory)

    assert repository.mark_failed_documents(identity=identity, marked_at=NOW) == 2
    assert repository.mark_failed_documents(identity=identity, marked_at=NOW) == 0
    with session_factory() as session:
        document = session.get(Document, document_id)
        completed_document = session.get(Document, completed_document_id)
        handoff = session.scalar(sa.select(WorkflowRunHandoff).where(WorkflowRunHandoff.workflow_run_id == run_id))
        assert document is not None
        assert document.indexing_status == "error"
        assert document.error == "resume attempts exhausted"
        assert document.stopped_at == NOW
        assert handoff is not None
        assert handoff.rag_document_error_marked_at == NOW
        assert completed_document is not None
        assert completed_document.indexing_status == IndexingStatus.COMPLETED
        assert completed_document.error is None
        assert completed_document.stopped_at is None
