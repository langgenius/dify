from __future__ import annotations

from dataclasses import dataclass
from itertools import product
from typing import Literal
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.rag.index_processor.constant.index_type import IndexStructureType
from enums.knowledge import DocumentIndexRetryAction
from models.dataset import Document
from models.document_indexing_state import resolve_document_indexing_state
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus
from models.knowledge_task import KnowledgeTaskOutbox
from repositories.knowledge.document_query_repository import (
    apply_document_display_status_filter,
    get_effective_document_indexing_states,
)
from repositories.knowledge.task_state_repository import get_current_document_index_state_rows
from services.knowledge.task_outbox.contracts import KnowledgeTaskKind

_TENANT_ID = "00000000-0000-0000-0000-000000000001"
_DATASET_ID = "00000000-0000-0000-0000-000000000002"
_DISPLAY_STATUSES = ("queuing", "indexing", "paused", "error", "available", "disabled", "archived")


@dataclass(frozen=True)
class _StateCase:
    name: str
    raw_status: IndexingStatus
    expected_indexing_status: str
    expected_display_status: str
    expected_indexing_state: Literal["pending", "completed", "failed"] | None = None
    expected_retry_action: DocumentIndexRetryAction | None = None
    expected_error: str | None = None
    enabled: bool = True
    archived: bool = False
    paused: bool = False
    task_status: str | None = None
    task_action: str | None = None


_STATE_CASES = (
    _StateCase("raw-completed", IndexingStatus.COMPLETED, "completed", "available"),
    _StateCase("raw-waiting", IndexingStatus.WAITING, "waiting", "queuing"),
    _StateCase("raw-parsing", IndexingStatus.PARSING, "parsing", "indexing"),
    _StateCase("raw-paused", IndexingStatus.PARSING, "paused", "paused", paused=True),
    _StateCase(
        "raw-error-active",
        IndexingStatus.ERROR,
        "error",
        "error",
        expected_retry_action="retry",
        expected_error="body failed",
    ),
    _StateCase(
        "raw-error-disabled",
        IndexingStatus.ERROR,
        "error",
        "error",
        expected_error="body failed",
        enabled=False,
    ),
    _StateCase(
        "raw-error-archived",
        IndexingStatus.ERROR,
        "error",
        "error",
        expected_error="body failed",
        archived=True,
    ),
    _StateCase(
        "failed-add-from-completed",
        IndexingStatus.COMPLETED,
        "error",
        "error",
        expected_indexing_state="failed",
        expected_retry_action="enable",
        expected_error="state failed",
        task_status="failed",
        task_action="add",
    ),
    _StateCase(
        "failed-add-from-processing",
        IndexingStatus.INDEXING,
        "error",
        "error",
        expected_indexing_state="failed",
        expected_retry_action="enable",
        expected_error="state failed",
        task_status="failed",
        task_action="add",
    ),
    _StateCase(
        "failed-remove-disabled",
        IndexingStatus.COMPLETED,
        "error",
        "error",
        expected_indexing_state="failed",
        expected_retry_action="disable",
        expected_error="state failed",
        enabled=False,
        task_status="failed",
        task_action="remove",
    ),
    _StateCase(
        "failed-remove-archived",
        IndexingStatus.PARSING,
        "error",
        "error",
        expected_indexing_state="failed",
        expected_retry_action="archive",
        expected_error="state failed",
        archived=True,
        task_status="failed",
        task_action="remove",
    ),
    _StateCase(
        "completed-state",
        IndexingStatus.COMPLETED,
        "completed",
        "available",
        expected_indexing_state="completed",
        task_status="completed",
        task_action="add",
    ),
    *(
        _StateCase(
            f"{task_status}-from-completed",
            IndexingStatus.COMPLETED,
            "indexing",
            "indexing",
            expected_indexing_state="pending",
            task_status=task_status,
            task_action="add",
        )
        for task_status in ("pending", "processing", "dispatched", "executing")
    ),
    _StateCase(
        "pending-hides-raw-error",
        IndexingStatus.ERROR,
        "indexing",
        "indexing",
        expected_indexing_state="pending",
        task_status="pending",
        task_action="add",
    ),
)


def _document(case: _StateCase) -> Document:
    document = Document(
        tenant_id=_TENANT_ID,
        dataset_id=_DATASET_ID,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        data_source_info="{}",
        batch=f"batch-{uuid4()}",
        name=case.name,
        created_from=DocumentCreatedFrom.WEB,
        created_by="00000000-0000-0000-0000-000000000003",
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    document.id = str(uuid4())
    document.indexing_generation = str(uuid4())
    document.indexing_status = case.raw_status
    document.enabled = case.enabled
    document.archived = case.archived
    document.is_paused = case.paused
    document.error = "body failed" if case.raw_status == IndexingStatus.ERROR else None
    return document


def _task(
    document: Document,
    *,
    status: str,
    action: str,
    tenant_id: str = _TENANT_ID,
    dataset_id: str = _DATASET_ID,
    generation: str | None = None,
    task_kind: str = KnowledgeTaskKind.DOCUMENT_INDEX_STATE,
    superseded: bool = False,
) -> KnowledgeTaskOutbox:
    return KnowledgeTaskOutbox(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=document.id,
        resource_id=document.id,
        task_kind=task_kind,
        payload={
            "document_id": document.id,
            "generation": generation or document.indexing_generation,
            "action": action,
            "superseded": superseded,
        },
        status=status,
        last_error="state failed" if status == "failed" else None,
    )


def _filtered_ids(session: Session, status: str) -> set[str]:
    statement = select(Document).where(Document.tenant_id == _TENANT_ID, Document.dataset_id == _DATASET_ID)
    return {document.id for document in session.scalars(apply_document_display_status_filter(statement, status))}


@pytest.mark.parametrize("case", _STATE_CASES, ids=lambda case: case.name)
def test_effective_projection_and_sql_display_filter_share_one_state_policy(
    sqlite_session: Session,
    case: _StateCase,
) -> None:
    document = _document(case)
    sqlite_session.add(document)
    if case.task_status is not None and case.task_action is not None:
        sqlite_session.add(_task(document, status=case.task_status, action=case.task_action))
    sqlite_session.commit()

    effective = get_effective_document_indexing_states(
        sqlite_session,
        tenant_id=_TENANT_ID,
        dataset_id=_DATASET_ID,
        documents=[document],
    )[document.id]

    assert effective.indexing_status == case.expected_indexing_status
    assert effective.display_status == case.expected_display_status
    assert effective.indexing_state == case.expected_indexing_state
    assert effective.indexing_retry_action == case.expected_retry_action
    assert effective.error == case.expected_error
    for display_status in _DISPLAY_STATUSES:
        assert (document.id in _filtered_ids(sqlite_session, display_status)) is (
            display_status == case.expected_display_status
        )


@dataclass(frozen=True)
class _IgnoredTaskCase:
    name: str
    tenant_id: str = _TENANT_ID
    dataset_id: str = _DATASET_ID
    generation: Literal["current", "old"] = "current"
    action: str = "add"
    status: str = "failed"
    task_kind: str = KnowledgeTaskKind.DOCUMENT_INDEX_STATE
    superseded: bool = False


_IGNORED_TASK_CASES = (
    _IgnoredTaskCase("old-generation", generation="old"),
    _IgnoredTaskCase("other-tenant", tenant_id="00000000-0000-0000-0000-000000000011"),
    _IgnoredTaskCase("other-dataset", dataset_id="00000000-0000-0000-0000-000000000012"),
    _IgnoredTaskCase("invalid-action", action="rebuild"),
    _IgnoredTaskCase("cancelled", status="cancelled"),
    _IgnoredTaskCase("superseded", superseded=True),
    _IgnoredTaskCase("other-task-kind", task_kind=KnowledgeTaskKind.DOCUMENT_INDEX_RETRY),
)


@pytest.mark.parametrize("case", _IGNORED_TASK_CASES, ids=lambda case: case.name)
def test_noncurrent_task_rows_do_not_pollute_projection_or_sql_filters(
    sqlite_session: Session,
    case: _IgnoredTaskCase,
) -> None:
    document = _document(_STATE_CASES[0])
    current_generation = document.indexing_generation
    assert current_generation is not None
    generation = current_generation if case.generation == "current" else str(uuid4())
    sqlite_session.add_all(
        [
            document,
            _task(
                document,
                status=case.status,
                action=case.action,
                tenant_id=case.tenant_id,
                dataset_id=case.dataset_id,
                generation=generation,
                task_kind=case.task_kind,
                superseded=case.superseded,
            ),
        ]
    )
    sqlite_session.commit()

    rows = get_current_document_index_state_rows(
        sqlite_session,
        tenant_id=_TENANT_ID,
        dataset_id=_DATASET_ID,
        document_generations={document.id: current_generation},
    )
    assert rows == {}
    effective = get_effective_document_indexing_states(
        sqlite_session,
        tenant_id=_TENANT_ID,
        dataset_id=_DATASET_ID,
        documents=[document],
    )[document.id]
    assert effective.display_status == "available"
    assert effective.indexing_state is None
    assert document.id in _filtered_ids(sqlite_session, "available")
    assert document.id not in _filtered_ids(sqlite_session, "error")
    assert document.id not in _filtered_ids(sqlite_session, "indexing")


def test_sql_display_predicates_match_pure_policy_for_every_state_combination(sqlite_session: Session) -> None:
    expected_ids: dict[str, set[str]] = {status: set() for status in _DISPLAY_STATUSES}
    raw_statuses = tuple(IndexingStatus)
    task_variants: tuple[tuple[str | None, str | None], ...] = (
        (None, None),
        *tuple(
            product(
                ("failed", "pending", "processing", "dispatched", "executing", "completed"),
                ("add", "remove"),
            )
        ),
    )
    for index, (raw_status, paused, enabled, archived, task_variant) in enumerate(
        product(raw_statuses, (False, True), (False, True), (False, True), task_variants),
        start=1,
    ):
        task_status, task_action = task_variant
        document = _document(
            _StateCase(
                name=f"matrix-{index}",
                raw_status=raw_status,
                expected_indexing_status="unused",
                expected_display_status="unused",
                enabled=enabled,
                archived=archived,
                paused=paused,
            )
        )
        document.position = index
        sqlite_session.add(document)
        if task_status is not None and task_action is not None:
            sqlite_session.add(_task(document, status=task_status, action=task_action))
        effective = resolve_document_indexing_state(
            raw_status=str(raw_status),
            is_paused=paused,
            enabled=enabled,
            archived=archived,
            task_status=task_status,
            task_action=task_action,
            raw_error=document.error,
            task_error="state failed" if task_status == "failed" else None,
        )
        if effective.display_status is not None:
            expected_ids[effective.display_status].add(document.id)
    sqlite_session.commit()

    for display_status in _DISPLAY_STATUSES:
        assert _filtered_ids(sqlite_session, display_status) == expected_ids[display_status]
