"""Segment attachments are released per scope, under a lock, and stay retryable."""

from collections.abc import Callable
from datetime import UTC, datetime
from types import TracebackType
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from sqlalchemy import delete, select
from sqlalchemy.orm import Session, sessionmaker

from extensions.storage.storage_type import StorageType
from models.dataset import Dataset, SegmentAttachmentBinding
from models.enums import CreatorUserRole
from models.model import UploadFile
from services.knowledge.indexing.adapters import cleanup


def _dataset(session: Session, *, indexing_technique: str = "high_quality") -> Dataset:
    dataset = Dataset(
        id=str(uuid4()),
        tenant_id=str(uuid4()),
        name="Dataset",
        created_by="admin",
        indexing_technique=indexing_technique,
        index_struct='{"type":"pgvector"}',
    )
    session.add(dataset)
    session.commit()
    return dataset


def _attachment(session: Session, *, tenant_id: str, key: str) -> str:
    attachment = UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.LOCAL,
        key=key,
        name=key.rsplit("/", maxsplit=1)[-1],
        size=10,
        extension="png",
        mime_type="image/png",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="admin",
        created_at=datetime.now(UTC),
        used=True,
    )
    session.add(attachment)
    session.commit()
    return attachment.id


def _bind(session: Session, *, tenant_id: str, dataset_id: str, document_id: str, attachment_id: str) -> str:
    binding = SegmentAttachmentBinding(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=document_id,
        segment_id=str(uuid4()),
        attachment_id=attachment_id,
    )
    session.add(binding)
    session.commit()
    return binding.id


@pytest.fixture
def vector(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    backend = MagicMock()
    monkeypatch.setattr(cleanup, "Vector", MagicMock(return_value=backend))
    return backend


def _release(sqlite_session_factory: sessionmaker[Session], *, dataset_id: str, document_ids: list[str]) -> list[str]:
    """Run a release and return the storage keys it deleted, in order."""
    deleted: list[str] = []
    cleanup.release_document_attachments(
        dataset_id=dataset_id,
        document_ids=document_ids,
        new_session=sqlite_session_factory,
        delete_file=deleted.append,
    )
    return deleted


def test_orphan_attachment_releases_its_vector_binding_and_file(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session], vector: MagicMock
) -> None:
    dataset = _dataset(sqlite_session)
    document_id = str(uuid4())
    attachment_id = _attachment(sqlite_session, tenant_id=dataset.tenant_id, key="attachments/orphan.png")
    binding_id = _bind(
        sqlite_session,
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document_id,
        attachment_id=attachment_id,
    )

    keys = _release(sqlite_session_factory, dataset_id=dataset.id, document_ids=[document_id])

    # Attachment vectors are written under doc_id == UploadFile.id.
    vector.delete_by_ids.assert_called_once_with([attachment_id])
    assert keys == ["attachments/orphan.png"]
    sqlite_session.expire_all()
    assert sqlite_session.get(SegmentAttachmentBinding, binding_id) is None
    assert sqlite_session.get(UploadFile, attachment_id) is None


def test_attachment_bound_by_another_document_in_the_dataset_is_kept(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session], vector: MagicMock
) -> None:
    dataset = _dataset(sqlite_session)
    document_id, other_document_id = str(uuid4()), str(uuid4())
    attachment_id = _attachment(sqlite_session, tenant_id=dataset.tenant_id, key="attachments/shared.png")
    binding_id = _bind(
        sqlite_session,
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document_id,
        attachment_id=attachment_id,
    )
    other_binding_id = _bind(
        sqlite_session,
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=other_document_id,
        attachment_id=attachment_id,
    )

    keys = _release(sqlite_session_factory, dataset_id=dataset.id, document_ids=[document_id])

    vector.delete_by_ids.assert_not_called()
    assert keys == []
    sqlite_session.expire_all()
    assert sqlite_session.get(SegmentAttachmentBinding, binding_id) is None
    assert sqlite_session.get(SegmentAttachmentBinding, other_binding_id) is not None
    assert sqlite_session.get(UploadFile, attachment_id) is not None


def test_attachment_bound_only_in_another_dataset_drops_this_datasets_vector_but_keeps_the_file(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session], vector: MagicMock
) -> None:
    dataset = _dataset(sqlite_session)
    other_dataset_id = str(uuid4())
    document_id = str(uuid4())
    attachment_id = _attachment(sqlite_session, tenant_id=dataset.tenant_id, key="attachments/cross.png")
    _bind(
        sqlite_session,
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document_id,
        attachment_id=attachment_id,
    )
    other_binding_id = _bind(
        sqlite_session,
        tenant_id=dataset.tenant_id,
        dataset_id=other_dataset_id,
        document_id=str(uuid4()),
        attachment_id=attachment_id,
    )

    keys = _release(sqlite_session_factory, dataset_id=dataset.id, document_ids=[document_id])

    # The vector belongs to this dataset's collection and nothing here references it any more,
    # while the file itself is still in use by the other dataset.
    vector.delete_by_ids.assert_called_once_with([attachment_id])
    assert keys == []
    sqlite_session.expire_all()
    assert sqlite_session.get(UploadFile, attachment_id) is not None
    assert sqlite_session.get(SegmentAttachmentBinding, other_binding_id) is not None


def test_failed_vector_deletion_keeps_bindings_for_a_retry(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session], vector: MagicMock
) -> None:
    dataset = _dataset(sqlite_session)
    document_id = str(uuid4())
    attachment_id = _attachment(sqlite_session, tenant_id=dataset.tenant_id, key="attachments/retry.png")
    binding_id = _bind(
        sqlite_session,
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document_id,
        attachment_id=attachment_id,
    )
    vector.delete_by_ids.side_effect = RuntimeError("vector store unavailable")

    with pytest.raises(RuntimeError, match="vector store unavailable"):
        _release(sqlite_session_factory, dataset_id=dataset.id, document_ids=[document_id])

    sqlite_session.expire_all()
    assert sqlite_session.get(SegmentAttachmentBinding, binding_id) is not None
    assert sqlite_session.get(UploadFile, attachment_id) is not None

    vector.delete_by_ids.side_effect = None
    keys = _release(sqlite_session_factory, dataset_id=dataset.id, document_ids=[document_id])

    assert keys == ["attachments/retry.png"]
    sqlite_session.expire_all()
    assert sqlite_session.get(SegmentAttachmentBinding, binding_id) is None
    assert sqlite_session.get(UploadFile, attachment_id) is None


def test_references_are_counted_while_the_attachment_lock_is_held(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    vector: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A release that finishes while this one waits for the lock must be seen by the count.

    Documents A and B share one attachment. A discovers it, then waits for the lock while B's
    release commits. If A counted references before taking the lock, it would still see B's
    binding and keep the attachment, and both releases would leave it orphaned.
    """
    dataset = _dataset(sqlite_session)
    document_a, document_b = str(uuid4()), str(uuid4())
    attachment_id = _attachment(sqlite_session, tenant_id=dataset.tenant_id, key="attachments/raced.png")
    _bind(
        sqlite_session,
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document_a,
        attachment_id=attachment_id,
    )
    binding_b = _bind(
        sqlite_session,
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document_b,
        attachment_id=attachment_id,
    )

    def competing_release_commits() -> None:
        with sqlite_session_factory() as session, session.begin():
            session.execute(delete(SegmentAttachmentBinding).where(SegmentAttachmentBinding.id == binding_b))

    class LockAcquiredAfterCompetitor:
        def __enter__(self) -> None:
            competing_release_commits()

        def __exit__(
            self,
            exc_type: type[BaseException] | None,
            exc: BaseException | None,
            traceback: TracebackType | None,
        ) -> None:
            return None

    redis = MagicMock()
    redis.lock.return_value = LockAcquiredAfterCompetitor()
    monkeypatch.setattr(cleanup, "redis_client", redis)

    keys = _release(sqlite_session_factory, dataset_id=dataset.id, document_ids=[document_a])

    vector.delete_by_ids.assert_called_once_with([attachment_id])
    assert keys == ["attachments/raced.png"]
    sqlite_session.expire_all()
    assert sqlite_session.get(UploadFile, attachment_id) is None


@pytest.mark.usefixtures("vector")
def test_each_attachment_is_locked_in_sorted_order(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset = _dataset(sqlite_session)
    document_id = str(uuid4())
    attachment_ids = [
        _attachment(sqlite_session, tenant_id=dataset.tenant_id, key=f"attachments/{index}.png") for index in range(3)
    ]
    for attachment_id in attachment_ids:
        _bind(
            sqlite_session,
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
            document_id=document_id,
            attachment_id=attachment_id,
        )
    redis = MagicMock()
    monkeypatch.setattr(cleanup, "redis_client", redis)

    _release(sqlite_session_factory, dataset_id=dataset.id, document_ids=[document_id])

    # A fixed acquisition order is what keeps two releases sharing several attachments
    # from deadlocking on each other.
    assert [call.args[0] for call in redis.lock.call_args_list] == [
        f"segment_attachment_release_lock_{attachment_id}" for attachment_id in sorted(attachment_ids)
    ]


def test_economy_dataset_releases_bindings_and_files_without_touching_vectors(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session], vector: MagicMock
) -> None:
    dataset = _dataset(sqlite_session, indexing_technique="economy")
    document_id = str(uuid4())
    attachment_id = _attachment(sqlite_session, tenant_id=dataset.tenant_id, key="attachments/economy.png")
    _bind(
        sqlite_session,
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document_id,
        attachment_id=attachment_id,
    )

    keys = _release(sqlite_session_factory, dataset_id=dataset.id, document_ids=[document_id])

    vector.delete_by_ids.assert_not_called()
    assert keys == ["attachments/economy.png"]


@pytest.mark.parametrize(
    "build",
    [
        pytest.param(lambda dataset_id: (dataset_id, []), id="no-documents"),
        pytest.param(lambda _dataset_id: (str(uuid4()), [str(uuid4())]), id="missing-dataset"),
        pytest.param(lambda dataset_id: (dataset_id, [str(uuid4())]), id="no-bindings"),
    ],
)
def test_nothing_to_release_takes_no_lock_and_touches_nothing(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    vector: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
    build: Callable[[str], tuple[str, list[str]]],
) -> None:
    dataset = _dataset(sqlite_session)
    redis = MagicMock()
    monkeypatch.setattr(cleanup, "redis_client", redis)
    dataset_id, document_ids = build(dataset.id)

    assert _release(sqlite_session_factory, dataset_id=dataset_id, document_ids=document_ids) == []
    redis.lock.assert_not_called()
    vector.delete_by_ids.assert_not_called()
    assert sqlite_session.scalars(select(UploadFile)).all() == []


def _bound_attachments(session: Session, dataset: Dataset, document_id: str, count: int) -> dict[str, str]:
    """Bind ``count`` attachments to one document; return attachment id -> storage key."""
    keys: dict[str, str] = {}
    for index in range(count):
        key = f"attachments/{index}.png"
        attachment_id = _attachment(session, tenant_id=dataset.tenant_id, key=key)
        _bind(
            session,
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
            document_id=document_id,
            attachment_id=attachment_id,
        )
        keys[attachment_id] = key
    return keys


def test_committed_batches_delete_their_files_even_when_a_later_batch_fails(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    vector: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Once a batch commits, nothing can rediscover its blobs, so they cannot wait for later batches."""
    monkeypatch.setattr(cleanup, "ATTACHMENT_RELEASE_BATCH_SIZE", 1)
    dataset = _dataset(sqlite_session)
    document_id = str(uuid4())
    keys = _bound_attachments(sqlite_session, dataset, document_id, count=2)
    first_id, second_id = sorted(keys)
    vector.delete_by_ids.side_effect = [None, RuntimeError("vector store unavailable")]
    deleted: list[str] = []

    with pytest.raises(RuntimeError, match="vector store unavailable"):
        cleanup.release_document_attachments(
            dataset_id=dataset.id,
            document_ids=[document_id],
            new_session=sqlite_session_factory,
            delete_file=deleted.append,
        )

    assert deleted == [keys[first_id]]
    sqlite_session.expire_all()
    assert sqlite_session.get(UploadFile, first_id) is None
    # The failed batch keeps its row and binding for the next attempt.
    assert sqlite_session.get(UploadFile, second_id) is not None


@pytest.mark.usefixtures("vector")
def test_a_file_that_cannot_be_deleted_is_logged_and_the_rest_still_go(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    caplog: pytest.LogCaptureFixture,
) -> None:
    dataset = _dataset(sqlite_session)
    document_id = str(uuid4())
    keys = _bound_attachments(sqlite_session, dataset, document_id, count=2)
    first_key = keys[min(keys)]
    attempted: list[str] = []

    def delete_file(key: str) -> None:
        attempted.append(key)
        if key == first_key:
            raise OSError("storage unavailable")

    with caplog.at_level("ERROR"):
        cleanup.release_document_attachments(
            dataset_id=dataset.id,
            document_ids=[document_id],
            new_session=sqlite_session_factory,
            delete_file=delete_file,
        )

    assert sorted(attempted) == sorted(keys.values())
    assert f"Failed to delete segment attachment file, key: {first_key}" in caplog.text
