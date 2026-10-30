"""Coordinate UploadFile locking with owner-domain reference checks."""

import logging
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Protocol, cast

from psycopg2.errors import LockNotAvailable
from pymysql.err import OperationalError as PyMySQLOperationalError
from sqlalchemy import event
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker

from repositories.file.upload_file_repository import UploadFileRepository
from services.entities.upload_file import UploadFileReferenceCandidate

_MYSQL_LOCK_NOWAIT_ERROR = 3572
_PENDING_DELETIONS = "upload_file_blob_deletions"
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class _PendingBlobDeletion:
    transaction: SessionTransaction
    files: tuple[UploadFileReferenceCandidate, ...]
    delete_blob: Callable[[str], None]


def _delete_committed_blobs(session: Session) -> None:
    # A released savepoint also emits after_commit. Its outer transaction can
    # still roll back, so only the outermost commit may publish this effect.
    if session.in_nested_transaction():
        return
    pending = cast(list[_PendingBlobDeletion], session.info.pop(_PENDING_DELETIONS, []))
    for deletion in pending:
        for file in deletion.files:
            try:
                deletion.delete_blob(file.key)
            except FileNotFoundError:
                pass
            except Exception:
                # Metadata is already committed. Retaining an unowned blob is
                # safe; the existing orphan-storage maintenance command can
                # discover it by its storage key, including after a crash here.
                logger.exception(
                    "Committed upload deletion left an orphaned blob, file_id=%s key=%s", file.id, file.key
                )


def _discard_rolled_back_blobs(session: Session, rolled_back: SessionTransaction) -> None:
    pending = cast(list[_PendingBlobDeletion], session.info.get(_PENDING_DELETIONS, []))
    retained = []
    for deletion in pending:
        transaction: SessionTransaction | None = deletion.transaction
        while transaction is not None and transaction is not rolled_back:
            transaction = transaction.parent
        if transaction is None:
            retained.append(deletion)
    session.info[_PENDING_DELETIONS] = retained


def _discard_finished_transaction_blobs(session: Session, transaction: SessionTransaction) -> None:
    # close() can roll back without after_soft_rollback. A reused Session must
    # never execute effects from the transaction it previously abandoned.
    if transaction.parent is None:
        session.info.pop(_PENDING_DELETIONS, None)


def _delete_blobs_after_commit(
    session: Session,
    files: tuple[UploadFileReferenceCandidate, ...],
    delete_blob: Callable[[str], None],
) -> None:
    if not files:
        return
    transaction = session.get_nested_transaction() or session.get_transaction()
    assert transaction is not None
    if not event.contains(session, "after_commit", _delete_committed_blobs):
        event.listen(session, "after_commit", _delete_committed_blobs)
        event.listen(session, "after_soft_rollback", _discard_rolled_back_blobs)
        event.listen(session, "after_transaction_end", _discard_finished_transaction_blobs)
    pending = cast(list[_PendingBlobDeletion], session.info.setdefault(_PENDING_DELETIONS, []))
    pending.append(_PendingBlobDeletion(transaction, files, delete_blob))


def _is_owner_lock_not_available(error: OperationalError) -> bool:
    original = error.orig
    if isinstance(original, LockNotAvailable):
        return True
    return bool(
        isinstance(original, PyMySQLOperationalError) and original.args and original.args[0] == _MYSQL_LOCK_NOWAIT_ERROR
    )


class UploadFileReferenceQuery(Protocol):
    """Return candidate ids referenced by one owning domain."""

    def __call__(
        self,
        session: Session,
        *,
        tenant_id: str,
        candidates: Sequence[UploadFileReferenceCandidate],
    ) -> set[str]: ...


def find_referenced_upload_file_ids_in_session(
    session: Session,
    *,
    tenant_id: str,
    candidates: Sequence[UploadFileReferenceCandidate],
    reference_queries: Sequence[UploadFileReferenceQuery],
    retry_on_contention: bool,
) -> set[str]:
    """Return live candidates using the same owner registry as reclamation."""

    referenced_ids: set[str] = set()
    remaining = tuple(candidates)
    for query in reference_queries:
        try:
            with session.begin_nested():
                newly_referenced = query(session, tenant_id=tenant_id, candidates=remaining)
        except OperationalError as error:
            if not _is_owner_lock_not_available(error):
                raise
            if retry_on_contention:
                raise
            # An owner row is changing while maintenance is checking candidates.
            # Without a trustworthy current read, retain every remaining file.
            referenced_ids.update(candidate.id for candidate in remaining)
            break
        referenced_ids.update(newly_referenced)
        remaining = tuple(candidate for candidate in remaining if candidate.id not in newly_referenced)
        if not remaining:
            break
    return referenced_ids


class SQLAlchemyUploadFileReclaimer:
    """Reclaim candidate files only after every owning domain releases them."""

    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        files: UploadFileRepository,
        reference_queries: Sequence[UploadFileReferenceQuery],
    ) -> None:
        self._session_factory = session_factory
        self._files = files
        self._reference_queries = tuple(reference_queries)

    def delete_unreferenced_files(
        self,
        *,
        tenant_id: str,
        file_ids: Sequence[str],
        delete_blob: Callable[[str], None],
        retry_on_contention: bool = True,
    ) -> tuple[str, ...]:
        """Commit unreferenced metadata removal before deleting its blobs.

        A database rollback retains the blob. Storage failures after commit
        retain unowned objects for the existing orphan-storage maintenance command.
        Owner-lock contention raises by default so a caller-owned deletion
        transaction rolls back with its durable candidate evidence intact.
        """

        with self._session_factory.begin() as session:
            return self.delete_unreferenced_files_in_session(
                session,
                tenant_id=tenant_id,
                file_ids=file_ids,
                delete_blob=delete_blob,
                retry_on_contention=retry_on_contention,
            )

    def delete_unreferenced_files_in_session(
        self,
        session: Session,
        *,
        tenant_id: str,
        file_ids: Sequence[str],
        delete_blob: Callable[[str], None],
        retry_on_contention: bool = True,
    ) -> tuple[str, ...]:
        """Stage metadata removal under file locks and delete blobs after commit."""

        files = self._files.lock_reclamation_candidates_in_session(
            session,
            tenant_id=tenant_id,
            file_ids=file_ids,
        )
        candidates = tuple(UploadFileReferenceCandidate(id=file.id, key=file.key) for file in files)
        referenced_ids = find_referenced_upload_file_ids_in_session(
            session,
            tenant_id=tenant_id,
            candidates=candidates,
            reference_queries=self._reference_queries,
            retry_on_contention=retry_on_contention,
        )

        deleted_ids: list[str] = []
        deleted_files: list[UploadFileReferenceCandidate] = []
        for file in files:
            if file.id in referenced_ids:
                continue
            self._files.delete_in_session(session, file)
            deleted_ids.append(file.id)
            deleted_files.append(UploadFileReferenceCandidate(file.id, file.key))
        _delete_blobs_after_commit(session, tuple(deleted_files), delete_blob)
        return tuple(deleted_ids)
