from concurrent.futures import ThreadPoolExecutor, TimeoutError
from threading import Event
from uuid import uuid4

import pytest
from sqlalchemy import delete, event, select
from sqlalchemy.orm import Session, sessionmaker

from enums.creator import CreatorUserRole
from models.dataset import Dataset, DatasetQuery
from models.enums import DatasetQuerySource
from repositories.knowledge.dataset_read_repository import stage_dataset_queries


def test_query_history_writers_share_parent_lock_and_block_dataset_deletion(mysql_session: Session) -> None:
    """Exercise InnoDB shared/exclusive parent locks with independent sessions."""

    engine = mysql_session.get_bind().execution_options(isolation_level="REPEATABLE READ")
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    actor_id = str(uuid4())
    with sessions.begin() as session:
        session.add(
            Dataset(
                id=dataset_id,
                tenant_id=tenant_id,
                name="Query lifecycle locking",
                created_by=actor_id,
            )
        )

    first_staged = Event()
    second_staged = Event()
    delete_lock_attempted = Event()
    release_writers = Event()

    def observe_delete_lock(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        normalized = " ".join(statement.lower().replace('"', "").replace("`", "").split())
        if " from datasets " in normalized and " for update" in normalized:
            delete_lock_attempted.set()

    def stage_query(staged: Event, content: str) -> None:
        with sessions.begin() as session:
            assert (
                stage_dataset_queries(
                    session,
                    tenant_id=tenant_id,
                    dataset_ids=(dataset_id,),
                    content=content,
                    source=DatasetQuerySource.APP,
                    source_app_id=None,
                    created_by_role=CreatorUserRole.ACCOUNT,
                    created_by=actor_id,
                )
                == 1
            )
            staged.set()
            assert release_writers.wait(timeout=10), "Timed out waiting to release query writers"

    def delete_dataset() -> None:
        with sessions.begin() as session:
            dataset = session.scalar(select(Dataset).where(Dataset.id == dataset_id).with_for_update())
            assert dataset is not None
            session.execute(delete(DatasetQuery).where(DatasetQuery.dataset_id == dataset_id))
            session.delete(dataset)

    event.listen(engine, "before_cursor_execute", observe_delete_lock)
    pool = ThreadPoolExecutor(max_workers=3)
    try:
        first = pool.submit(stage_query, first_staged, "first")
        assert first_staged.wait(timeout=5)
        second = pool.submit(stage_query, second_staged, "second")
        assert second_staged.wait(timeout=5), "Append-only query writers unexpectedly serialized"
        deletion = pool.submit(delete_dataset)
        assert delete_lock_attempted.wait(timeout=5)
        try:
            with pytest.raises(TimeoutError):
                deletion.result(timeout=0.5)
        finally:
            release_writers.set()
        first.result(timeout=5)
        second.result(timeout=5)
        deletion.result(timeout=5)

        with sessions() as session:
            assert session.get(Dataset, dataset_id) is None
            assert session.scalar(select(DatasetQuery).where(DatasetQuery.dataset_id == dataset_id)) is None
    finally:
        release_writers.set()
        pool.shutdown(wait=True, cancel_futures=True)
        event.remove(engine, "before_cursor_execute", observe_delete_lock)
        with sessions.begin() as session:
            session.execute(delete(DatasetQuery).where(DatasetQuery.dataset_id == dataset_id))
            session.execute(delete(Dataset).where(Dataset.id == dataset_id))
