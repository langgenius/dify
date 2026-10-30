from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from threading import Event, local
from uuid import uuid4

from sqlalchemy import delete, event, select
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexStructureType
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus
from repositories.knowledge.segment_repository import SQLAlchemySegmentRepository
from services.knowledge.entities.resource_scope import DatasetRef
from services.knowledge.segments.contracts import SegmentCreateRecord


class _WorkerState(local):
    def __init__(self) -> None:
        self.role: str | None = None


def test_concurrent_segment_creates_allocate_distinct_positions(mysql_session: Session) -> None:
    engine = mysql_session.get_bind().execution_options(isolation_level="REPEATABLE READ")
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    document_id = str(uuid4())
    actor_id = str(uuid4())
    with sessions.begin() as session:
        session.add(
            Dataset(
                id=dataset_id,
                tenant_id=tenant_id,
                name="Concurrent segment allocation",
                data_source_type=DataSourceType.UPLOAD_FILE,
                created_by=actor_id,
            )
        )
        session.add(
            Document(
                id=document_id,
                tenant_id=tenant_id,
                dataset_id=dataset_id,
                position=1,
                data_source_type=DataSourceType.UPLOAD_FILE,
                batch=str(uuid4()),
                name="segments.txt",
                created_from=DocumentCreatedFrom.WEB,
                created_by=actor_id,
                indexing_status=IndexingStatus.COMPLETED,
                doc_form=IndexStructureType.PARAGRAPH_INDEX,
                word_count=0,
            )
        )

    repository = SQLAlchemySegmentRepository(session_factory=sessions)
    document_ref = DatasetRef(tenant_id, dataset_id).document(document_id)
    first_locked = Event()
    second_dataset_lock_attempted = Event()
    release_first = Event()
    worker = _WorkerState()

    def is_document_lock(statement: str) -> bool:
        normalized = " ".join(statement.lower().split())
        return " from documents " in normalized and " for update" in normalized

    def is_dataset_lock(statement: str) -> bool:
        normalized = " ".join(statement.lower().split())
        return " from datasets " in normalized and any(
            lock_clause in normalized for lock_clause in (" for update", " for share", " lock in share mode")
        )

    def observe_attempt(_connection, _cursor, statement: str, _parameters, _context, _executemany) -> None:
        if is_dataset_lock(statement) and worker.role == "second":
            second_dataset_lock_attempted.set()

    def hold_first_lock(_connection, _cursor, statement: str, _parameters, _context, _executemany) -> None:
        if is_document_lock(statement) and worker.role == "first":
            first_locked.set()
            assert release_first.wait(timeout=10)

    def create(role: str, segment_id: str) -> None:
        worker.role = role
        now = datetime(2026, 1, 1)
        repository.create_segments(
            document_ref,
            (
                SegmentCreateRecord(
                    segment_id=segment_id,
                    content=role,
                    answer=None,
                    word_count=len(role),
                    tokens=0,
                    index_node_id=str(uuid4()),
                    index_node_hash=f"hash-{role}",
                    created_by=actor_id,
                    indexing_at=now,
                    completed_at=now,
                ),
            ),
        )

    event.listen(engine, "before_cursor_execute", observe_attempt)
    event.listen(engine, "after_cursor_execute", hold_first_lock)
    first_id = str(uuid4())
    second_id = str(uuid4())
    executor = ThreadPoolExecutor(max_workers=2)
    try:
        first = executor.submit(create, "first", first_id)
        assert first_locked.wait(timeout=10)
        second = executor.submit(create, "second", second_id)
        assert second_dataset_lock_attempted.wait(timeout=10)
        assert not second.done()
        release_first.set()
        first.result(timeout=10)
        second.result(timeout=10)

        with sessions() as session:
            rows = session.execute(
                select(DocumentSegment.id, DocumentSegment.position)
                .where(
                    DocumentSegment.tenant_id == tenant_id,
                    DocumentSegment.dataset_id == dataset_id,
                    DocumentSegment.document_id == document_id,
                )
                .order_by(DocumentSegment.position)
            ).all()
            assert rows == [(first_id, 1), (second_id, 2)]
    finally:
        release_first.set()
        executor.shutdown(wait=True, cancel_futures=True)
        event.remove(engine, "before_cursor_execute", observe_attempt)
        event.remove(engine, "after_cursor_execute", hold_first_lock)
        with sessions.begin() as session:
            session.execute(delete(DocumentSegment).where(DocumentSegment.document_id == document_id))
            session.execute(delete(Document).where(Document.id == document_id))
            session.execute(delete(Dataset).where(Dataset.id == dataset_id))
