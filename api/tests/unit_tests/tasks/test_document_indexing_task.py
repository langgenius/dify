"""Regression tests for legacy document indexing admission races."""

import uuid
from collections.abc import Sequence
from contextlib import nullcontext
from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session

import tasks.document_indexing_task as task_module
from models.dataset import Dataset, Document
from models.enums import IndexingStatus
from services.knowledge.resource_scope import DocumentRef
from tests.unit_tests.model_factories import make_dataset, make_document


@pytest.mark.parametrize("sqlite_session", [(Dataset, Document)], indirect=True)
def test_skips_indexing_when_dataset_is_deleted_before_locked_admission(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tenant_id = str(uuid.uuid4())
    dataset = make_dataset(dataset_id=str(uuid.uuid4()), tenant_id=tenant_id)
    document = make_document(dataset_id=dataset.id, tenant_id=tenant_id)
    document.indexing_status = IndexingStatus.WAITING
    sqlite_session.add_all([dataset, document])
    sqlite_session.commit()

    monkeypatch.setattr(
        task_module.session_factory,
        "create_session",
        lambda: Session(bind=sqlite_session.get_bind(), expire_on_commit=False),
    )
    monkeypatch.setattr(task_module, "dataset_operation_lock", lambda _dataset_id: nullcontext())
    monkeypatch.setattr(task_module, "lock_dataset_row", lambda _session, _dataset_id: None)

    with patch.object(task_module, "build_document_indexing_service") as indexing_builder:
        task_module._document_indexing(dataset.id, [document.id])

    indexing_builder.assert_not_called()
    sqlite_session.refresh(document)
    assert document.indexing_status == IndexingStatus.WAITING


@pytest.mark.parametrize("sqlite_session", [(Dataset, Document)], indirect=True)
def test_commits_parsing_status_before_starting_legacy_indexing(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tenant_id = str(uuid.uuid4())
    dataset = make_dataset(dataset_id=str(uuid.uuid4()), tenant_id=tenant_id)
    document = make_document(dataset_id=dataset.id, tenant_id=tenant_id)
    document.indexing_status = IndexingStatus.WAITING
    sqlite_session.add_all([dataset, document])
    sqlite_session.commit()
    bind = sqlite_session.get_bind()

    monkeypatch.setattr(
        task_module.session_factory,
        "create_session",
        lambda: Session(bind=bind, expire_on_commit=False),
    )
    monkeypatch.setattr(task_module, "dataset_operation_lock", lambda _dataset_id: nullcontext())

    def assert_status_committed(document_refs: Sequence[DocumentRef]) -> None:
        with Session(bind=bind) as observer:
            stored_document = observer.get(Document, document.id)
            assert stored_document is not None
            assert stored_document.indexing_status == IndexingStatus.PARSING
        assert len(document_refs) == 1

    with patch.object(task_module, "build_document_indexing_service") as runner:
        runner.return_value.run.side_effect = assert_status_committed
        task_module._document_indexing(dataset.id, [document.id])
        runner.return_value.run.assert_called_once()
