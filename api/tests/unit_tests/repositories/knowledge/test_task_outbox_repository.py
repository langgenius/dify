from datetime import datetime

import pytest
from sqlalchemy import event, update
from sqlalchemy.dialects import mysql
from sqlalchemy.orm import ORMExecuteState, Session
from sqlalchemy.sql import Select

from models.knowledge_task import KnowledgeTaskOutbox
from repositories.knowledge.task_outbox_repository import (
    get_current_dataset_vector_task_states,
    get_latest_document_index_state_tasks,
)
from services.knowledge.task_outbox.contracts import (
    DocumentIndexStateAction,
    KnowledgeTaskKind,
    KnowledgeTaskStatus,
)


def _intent(
    *,
    resource_id: str,
    kind: KnowledgeTaskKind = KnowledgeTaskKind.DOCUMENT_INDEX_STATE,
    tenant_id: str = "tenant-1",
    dataset_id: str = "dataset-1",
    generation: str = "generation-1",
    action: str = "add",
    status: str = "pending",
    created_at: datetime,
    error: str | None = None,
    intent_id: str | None = None,
) -> KnowledgeTaskOutbox:
    intent = KnowledgeTaskOutbox(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=resource_id,
        resource_id=resource_id,
        task_kind=kind.value,
        payload={"generation": generation, "action": action},
        status=status,
        last_error=error,
    )
    if intent_id is not None:
        intent.id = intent_id
    intent.created_at = created_at
    return intent


def test_document_projection_requires_latest_current_generation_and_known_action(sqlite_session: Session) -> None:
    now = datetime(2026, 10, 20, 12)
    sqlite_session.add_all(
        [
            _intent(
                resource_id="document-1",
                status="failed",
                error="provider unavailable",
                created_at=now,
                intent_id="ffffffff-ffff-ffff-ffff-ffffffffffff",
            ),
            _intent(
                resource_id="document-1",
                status="pending",
                created_at=now,
                intent_id="11111111-1111-1111-1111-111111111111",
            ),
            _intent(
                resource_id="document-1",
                generation="stale-generation",
                status="completed",
                created_at=now,
                intent_id="22222222-2222-2222-2222-222222222222",
            ),
            _intent(
                resource_id="document-1",
                tenant_id="tenant-2",
                status="failed",
                error="other tenant",
                created_at=now,
            ),
            _intent(
                resource_id="document-2",
                generation="old-generation",
                status="failed",
                created_at=now,
            ),
            _intent(
                resource_id="document-2",
                status="pending",
                created_at=now,
            ),
            _intent(
                resource_id="document-3",
                action="unexpected",
                status="failed",
                created_at=now,
            ),
            _intent(
                resource_id="document-4",
                action="remove",
                status="completed",
                created_at=now,
            ),
        ]
    )
    sqlite_session.commit()

    projections = get_latest_document_index_state_tasks(
        sqlite_session,
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        document_generations={
            "document-1": "generation-1",
            "document-2": "generation-1",
            "document-3": "generation-1",
            "document-4": "generation-1",
        },
    )

    assert set(projections) == {"document-1", "document-2", "document-4"}
    failed = projections["document-1"]
    assert failed.action is DocumentIndexStateAction.ADD
    assert failed.status is KnowledgeTaskStatus.FAILED
    assert failed.last_error == "provider unavailable"
    assert projections["document-2"].status is KnowledgeTaskStatus.PENDING
    completed = projections["document-4"]
    assert completed.action is DocumentIndexStateAction.REMOVE
    assert completed.status is KnowledgeTaskStatus.COMPLETED
    assert completed.last_error is None


def test_current_dataset_vector_marker_wins_without_timestamp_or_uuid_order(sqlite_session: Session) -> None:
    now = datetime(2026, 10, 20, 12)
    historical = _intent(
        resource_id="dataset-1",
        kind=KnowledgeTaskKind.DATASET_VECTOR_INDEX_UPDATE,
        dataset_id="dataset-1",
        status="failed",
        created_at=now,
        intent_id="ffffffff-ffff-ffff-ffff-ffffffffffff",
        error="historical failure",
    )
    historical.payload = {
        "expected_indexing_technique": "high_quality",
        "expected_embedding_model_provider": "provider",
        "expected_embedding_model": "model",
        "superseded": True,
    }
    current = _intent(
        resource_id="dataset-1",
        kind=KnowledgeTaskKind.DATASET_VECTOR_INDEX_UPDATE,
        dataset_id="dataset-1",
        status="executing",
        created_at=now,
        intent_id="11111111-1111-1111-1111-111111111111",
    )
    current.payload = {
        "expected_indexing_technique": "economy",
        "expected_embedding_model_provider": None,
        "expected_embedding_model": None,
        "superseded": False,
    }
    sqlite_session.add_all([historical, current])
    sqlite_session.commit()

    statements = 0

    def count_statement(*_args: object) -> None:
        nonlocal statements
        statements += 1

    event.listen(sqlite_session.bind, "before_cursor_execute", count_statement)
    try:
        states = get_current_dataset_vector_task_states(
            sqlite_session,
            tenant_id="tenant-1",
            expected_payload_by_resource={
                "dataset-1": {
                    "expected_indexing_technique": "economy",
                    "expected_embedding_model_provider": None,
                    "expected_embedding_model": None,
                }
            },
        )
    finally:
        event.remove(sqlite_session.bind, "before_cursor_execute", count_statement)

    assert states["dataset-1"].status is KnowledgeTaskStatus.EXECUTING
    assert states["dataset-1"].id == current.id
    assert states["dataset-1"].payload["superseded"] is False
    assert statements == 1


def test_current_dataset_vector_batch_enforces_tenant_and_dataset_identity(sqlite_session: Session) -> None:
    now = datetime(2026, 10, 20, 12)
    dataset_1 = _intent(
        resource_id="dataset-1",
        kind=KnowledgeTaskKind.DATASET_VECTOR_INDEX_UPDATE,
        dataset_id="dataset-1",
        status="completed",
        created_at=now,
    )
    dataset_1.payload = {"superseded": False}
    dataset_2 = _intent(
        resource_id="dataset-2",
        kind=KnowledgeTaskKind.DATASET_VECTOR_INDEX_UPDATE,
        dataset_id="dataset-2",
        status="executing",
        created_at=now,
    )
    dataset_2.payload = {"superseded": False}
    other_tenant = _intent(
        resource_id="dataset-1",
        kind=KnowledgeTaskKind.DATASET_VECTOR_INDEX_UPDATE,
        tenant_id="tenant-2",
        dataset_id="dataset-1",
        status="failed",
        created_at=now,
    )
    other_tenant.payload = {"superseded": False}
    mismatched_owner = _intent(
        resource_id="dataset-2",
        kind=KnowledgeTaskKind.DATASET_VECTOR_INDEX_UPDATE,
        dataset_id="other-dataset",
        status="failed",
        created_at=now,
    )
    mismatched_owner.payload = {"superseded": False}
    sqlite_session.add_all([dataset_1, dataset_2, other_tenant, mismatched_owner])
    sqlite_session.commit()

    states = get_current_dataset_vector_task_states(
        sqlite_session,
        tenant_id="tenant-1",
        expected_payload_by_resource={"dataset-1": {}, "dataset-2": {}},
    )

    assert set(states) == {"dataset-1", "dataset-2"}
    assert states["dataset-1"].status is KnowledgeTaskStatus.COMPLETED
    assert states["dataset-2"].status is KnowledgeTaskStatus.EXECUTING


def test_unmarked_dataset_vector_state_is_not_treated_as_current(sqlite_session: Session) -> None:
    now = datetime(2026, 10, 20, 12)
    rows = [
        _intent(
            resource_id="dataset-1",
            kind=KnowledgeTaskKind.DATASET_VECTOR_INDEX_UPDATE,
            dataset_id="dataset-1",
            status=status,
            created_at=now,
            error=error,
        )
        for status, error in (("completed", None), ("executing", None), ("failed", "unmarked failure"))
    ]
    for row in rows:
        row.payload = {
            "expected_indexing_technique": "high_quality",
            "expected_embedding_model_provider": "provider",
            "expected_embedding_model": "model",
        }
    mismatched = _intent(
        resource_id="dataset-2",
        kind=KnowledgeTaskKind.DATASET_VECTOR_INDEX_UPDATE,
        dataset_id="dataset-2",
        status="failed",
        created_at=now,
        error="obsolete failure",
    )
    mismatched.payload = {
        "expected_indexing_technique": "economy",
        "expected_embedding_model_provider": None,
        "expected_embedding_model": None,
    }
    sqlite_session.add_all([*rows, mismatched])
    sqlite_session.commit()

    states = get_current_dataset_vector_task_states(
        sqlite_session,
        tenant_id="tenant-1",
        expected_payload_by_resource={
            "dataset-1": {
                "expected_indexing_technique": "high_quality",
                "expected_embedding_model_provider": "provider",
                "expected_embedding_model": "model",
            },
            "dataset-2": {
                "expected_indexing_technique": "high_quality",
                "expected_embedding_model_provider": "provider",
                "expected_embedding_model": "model",
            },
        },
    )

    assert states == {}


def test_multiple_current_dataset_vector_markers_are_rejected(sqlite_session: Session) -> None:
    now = datetime(2026, 10, 20, 12)
    rows = [
        _intent(
            resource_id="dataset-1",
            kind=KnowledgeTaskKind.DATASET_VECTOR_INDEX_UPDATE,
            dataset_id="dataset-1",
            status="pending",
            created_at=now,
        )
        for _ in range(2)
    ]
    for row in rows:
        row.payload = {"superseded": False}
    sqlite_session.add_all(rows)
    sqlite_session.commit()

    with pytest.raises(RuntimeError, match="Multiple current dataset vector intents"):
        get_current_dataset_vector_task_states(
            sqlite_session,
            tenant_id="tenant-1",
            expected_payload_by_resource={"dataset-1": {}},
        )


def test_mismatched_current_marker_does_not_fall_back_to_unmarked_history(sqlite_session: Session) -> None:
    now = datetime(2026, 10, 20, 12)
    current = _intent(
        resource_id="dataset-1",
        kind=KnowledgeTaskKind.DATASET_VECTOR_INDEX_UPDATE,
        dataset_id="dataset-1",
        status="completed",
        created_at=now,
    )
    current.payload = {"expected_indexing_technique": "economy", "superseded": False}
    unmarked = _intent(
        resource_id="dataset-1",
        kind=KnowledgeTaskKind.DATASET_VECTOR_INDEX_UPDATE,
        dataset_id="dataset-1",
        status="failed",
        created_at=now,
        error="old target failure",
    )
    unmarked.payload = {"expected_indexing_technique": "high_quality"}
    sqlite_session.add_all([current, unmarked])
    sqlite_session.commit()

    states = get_current_dataset_vector_task_states(
        sqlite_session,
        tenant_id="tenant-1",
        expected_payload_by_resource={"dataset-1": {"expected_indexing_technique": "high_quality"}},
    )

    assert states == {}


def test_dataset_vector_current_read_locks_only_the_current_marker_query(sqlite_session: Session) -> None:
    statements: list[str] = []
    populate_existing: list[bool] = []

    def capture_statement(execute_state: ORMExecuteState) -> None:
        statement = execute_state.statement
        assert isinstance(statement, Select)
        statements.append(str(statement.compile(dialect=mysql.dialect())))
        populate_existing.append(execute_state.execution_options.get("populate_existing") is True)

    event.listen(sqlite_session, "do_orm_execute", capture_statement)
    try:
        states = get_current_dataset_vector_task_states(
            sqlite_session,
            tenant_id="tenant-1",
            expected_payload_by_resource={"dataset-1": {}},
            for_update=True,
        )
    finally:
        event.remove(sqlite_session, "do_orm_execute", capture_statement)

    assert states == {}
    assert len(statements) == 1
    assert all(statement.rstrip().endswith("FOR UPDATE") for statement in statements)
    assert populate_existing == [True]


def test_dataset_vector_current_read_refreshes_loaded_intent(sqlite_session: Session) -> None:
    row = _intent(
        resource_id="dataset-1",
        kind=KnowledgeTaskKind.DATASET_VECTOR_INDEX_UPDATE,
        dataset_id="dataset-1",
        status="pending",
        created_at=datetime(2026, 10, 20, 12),
    )
    row.payload = {"superseded": False}
    sqlite_session.add(row)
    sqlite_session.commit()
    assert row.status == "pending"
    sqlite_session.execute(
        update(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.id == row.id).values(status="failed"),
        execution_options={"synchronize_session": False},
    )
    assert row.status == "pending"

    states = get_current_dataset_vector_task_states(
        sqlite_session,
        tenant_id="tenant-1",
        expected_payload_by_resource={"dataset-1": {}},
        for_update=True,
    )

    assert states["dataset-1"].status is KnowledgeTaskStatus.FAILED
    assert row.status == "failed"


def test_empty_dataset_vector_batch_does_not_query(sqlite_session: Session) -> None:
    statements = 0

    def count_statement(*_args: object) -> None:
        nonlocal statements
        statements += 1

    event.listen(sqlite_session.bind, "before_cursor_execute", count_statement)
    try:
        states = get_current_dataset_vector_task_states(
            sqlite_session,
            tenant_id="tenant-1",
            expected_payload_by_resource={},
        )
    finally:
        event.remove(sqlite_session.bind, "before_cursor_execute", count_statement)

    assert states == {}
    assert statements == 0
