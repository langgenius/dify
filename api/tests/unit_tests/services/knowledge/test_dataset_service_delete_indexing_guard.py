"""Unit tests for the delete-while-indexing guard in DatasetService.delete_dataset (#38518)."""

import pytest
from sqlalchemy.orm import Session

from core.rag.index_processor.constant.index_type import IndexStructureType
from models.dataset import Dataset, Document
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus
from services.errors.dataset import DatasetIndexingInProgressError
from services.knowledge import dataset_service as module
from services.knowledge.dataset_service import DatasetService


def _persist_dataset(session: Session, dataset_id: str = "dataset", tenant_id: str = "target") -> Dataset:
    dataset = Dataset(id=dataset_id, tenant_id=tenant_id, name="Dataset", created_by="owner")
    session.add(dataset)
    session.commit()
    return dataset


def _persist_document(
    session: Session,
    *,
    dataset_id: str,
    indexing_status: IndexingStatus,
    is_paused: bool = False,
) -> Document:
    document = Document(
        id=f"doc-{indexing_status}-{is_paused}-{dataset_id}",
        tenant_id="target",
        dataset_id=dataset_id,
        position=1,
        data_source_type=DataSourceType.LOCAL_FILE,
        batch="batch",
        name="Document",
        created_from=DocumentCreatedFrom.API,
        created_by="owner",
        indexing_status=indexing_status,
        is_paused=is_paused,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    session.add(document)
    session.commit()
    return document


class _SignalRecorder:
    """Stand-in for the real dataset deletion signal that only records dispatches."""

    def __init__(self) -> None:
        self.sent: list[tuple[object, ...]] = []

    def send(self, *args: object) -> None:
        self.sent.append(args)


class _NoopDatasetApiKeyBindings:
    """Stand-in for the API-key binding repository that performs no deletion."""

    @staticmethod
    def delete_keys_scoped_only_to(session: Session, dataset_id: str) -> None:
        pass


class _NoopResourceAccessTokenCleanupService:
    """Stand-in for the resource access token cleanup service."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def delete_resource_relations(self, **kwargs: object) -> None:
        pass


@pytest.fixture
def _patched_side_effects(monkeypatch: pytest.MonkeyPatch) -> None:
    """Neutralize permission checks and external side effects; the guard is what we test."""
    monkeypatch.setattr(DatasetService, "check_dataset_permission", staticmethod(lambda *_args, **_kwargs: None))
    monkeypatch.setattr(module, "dataset_was_deleted", _SignalRecorder())
    monkeypatch.setattr(module, "dataset_api_key_bindings", _NoopDatasetApiKeyBindings())
    monkeypatch.setattr(module, "build_resource_access_token_cleanup_service", _NoopResourceAccessTokenCleanupService)


@pytest.mark.usefixtures("_patched_side_effects")
@pytest.mark.parametrize(
    ("indexing_status", "is_paused"),
    [
        (IndexingStatus.WAITING, False),
        (IndexingStatus.PARSING, False),
        (IndexingStatus.CLEANING, False),
        (IndexingStatus.SPLITTING, False),
        (IndexingStatus.INDEXING, False),
        (IndexingStatus.INDEXING, True),  # paused docs are only a display alias; still mid-pipeline
    ],
)
def test_delete_dataset_is_refused_while_a_document_is_indexing(
    sqlite_session: Session,
    indexing_status: IndexingStatus,
    is_paused: bool,
) -> None:
    dataset = _persist_dataset(sqlite_session)
    _persist_document(sqlite_session, dataset_id=dataset.id, indexing_status=indexing_status, is_paused=is_paused)

    with pytest.raises(DatasetIndexingInProgressError):
        DatasetService.delete_dataset(dataset.id, object(), sqlite_session)

    # nothing must have been committed
    sqlite_session.expire_all()
    assert sqlite_session.get(Dataset, dataset.id) is not None


@pytest.mark.usefixtures("_patched_side_effects")
def test_delete_dataset_succeeds_when_documents_are_not_indexing(sqlite_session: Session) -> None:
    dataset = _persist_dataset(sqlite_session)
    _persist_document(sqlite_session, dataset_id=dataset.id, indexing_status=IndexingStatus.COMPLETED)
    _persist_document(sqlite_session, dataset_id=dataset.id, indexing_status=IndexingStatus.ERROR)

    assert DatasetService.delete_dataset(dataset.id, object(), sqlite_session) is True

    sqlite_session.expire_all()
    assert sqlite_session.get(Dataset, dataset.id) is None


@pytest.mark.usefixtures("_patched_side_effects")
def test_delete_dataset_guard_is_dataset_scoped(sqlite_session: Session) -> None:
    _persist_dataset(sqlite_session, dataset_id="target", tenant_id="target")
    _persist_dataset(sqlite_session, dataset_id="other", tenant_id="target")
    _persist_document(sqlite_session, dataset_id="other", indexing_status=IndexingStatus.INDEXING)

    assert DatasetService.delete_dataset("target", object(), sqlite_session) is True

    sqlite_session.expire_all()
    assert sqlite_session.get(Dataset, "target") is None
    assert sqlite_session.get(Dataset, "other") is not None
