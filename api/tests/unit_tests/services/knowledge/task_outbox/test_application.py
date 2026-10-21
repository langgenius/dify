from datetime import datetime, timedelta

from sqlalchemy.orm import Session, sessionmaker

from models.knowledge_task import KnowledgeTaskOutbox
from repositories.knowledge.task_outbox_repository import (
    SQLAlchemyKnowledgeTaskStore,
    enqueue_knowledge_task,
)
from services.knowledge.task_outbox.application import KnowledgeTaskOutboxDispatcher
from services.knowledge.task_outbox.contracts import KnowledgeTaskIntent, KnowledgeTaskKind


class MutableClock:
    def __init__(self, value: datetime) -> None:
        self.value = value

    def __call__(self) -> datetime:
        return self.value


class RecordingPublisher:
    def __init__(self) -> None:
        self.fail = True
        self.calls: list[str] = []

    def publish(self, intent: KnowledgeTaskIntent) -> None:
        self.calls.append(intent.id)
        if self.fail:
            raise RuntimeError("broker unavailable")


def test_broker_failure_keeps_intent_and_retry_publishes_it_once(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    now = datetime(2026, 10, 19, 12, 0)
    intent_id = enqueue_knowledge_task(
        sqlite_session,
        kind=KnowledgeTaskKind.DOCUMENT_CLEANUP,
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        document_id="document-1",
        resource_id="document-1",
        payload={
            "tenant_id": "tenant-1",
            "dataset_id": "dataset-1",
            "document_id": "document-1",
            "doc_form": "text_model",
            "file_id": None,
        },
    )
    intent = sqlite_session.get(KnowledgeTaskOutbox, intent_id)
    assert intent is not None
    intent.available_at = now
    sqlite_session.commit()
    clock = MutableClock(now)
    publisher = RecordingPublisher()
    dispatcher = KnowledgeTaskOutboxDispatcher(
        store=SQLAlchemyKnowledgeTaskStore(session_factory=sqlite_session_factory),
        publisher=publisher,
        clock=clock,
    )

    failed = dispatcher.dispatch_pending(limit=10)

    sqlite_session.expire_all()
    intent = sqlite_session.get(KnowledgeTaskOutbox, intent_id)
    assert failed.deferred == 1
    assert intent is not None
    assert intent.status == "pending"
    assert intent.attempts == 1
    assert intent.last_error == "broker unavailable"

    publisher.fail = False
    clock.value += timedelta(seconds=3)
    recovered = dispatcher.dispatch_pending(limit=10)
    empty = dispatcher.dispatch_pending(limit=10)

    sqlite_session.expire_all()
    intent = sqlite_session.get(KnowledgeTaskOutbox, intent_id)
    assert recovered.dispatched == 1
    assert empty.claimed == 0
    assert intent is not None
    assert intent.status == "dispatched"
    assert publisher.calls == [intent_id, intent_id]


def test_expired_claim_is_recovered_after_dispatcher_crash(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    now = datetime(2026, 10, 19, 12, 0)
    intent_id = enqueue_knowledge_task(
        sqlite_session,
        kind=KnowledgeTaskKind.DATASET_VECTOR_INDEX_UPDATE,
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        resource_id="dataset-1",
        payload={"dataset_id": "dataset-1", "action": "update"},
    )
    row = sqlite_session.get(KnowledgeTaskOutbox, intent_id)
    assert row is not None
    row.available_at = now
    sqlite_session.commit()
    store = SQLAlchemyKnowledgeTaskStore(session_factory=sqlite_session_factory)

    abandoned = store.claim_pending(
        now=now,
        lease_expired_before=now - timedelta(minutes=5),
        dispatched_expired_before=now - timedelta(hours=1),
        limit=1,
    )
    recovered = store.claim_pending(
        now=now + timedelta(minutes=6),
        lease_expired_before=now + timedelta(minutes=1),
        dispatched_expired_before=now - timedelta(minutes=54),
        limit=1,
    )

    assert len(abandoned) == 1
    assert len(recovered) == 1
    assert recovered[0].id == intent_id
    assert recovered[0].claim_id != abandoned[0].claim_id
    assert not store.mark_dispatched(
        intent_id=intent_id,
        claim_id=abandoned[0].claim_id,
        dispatched_at=now + timedelta(minutes=6),
    )


def test_stale_dispatched_tasks_are_recovered_but_completed_tasks_are_not(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    now = datetime(2026, 10, 19, 12, 0)
    cleanup_id = enqueue_knowledge_task(
        sqlite_session,
        kind=KnowledgeTaskKind.DATASET_CLEANUP,
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        payload={"dataset_id": "dataset-1", "manifest": {}},
    )
    completed_id = enqueue_knowledge_task(
        sqlite_session,
        kind=KnowledgeTaskKind.DOCUMENT_CLEANUP,
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        document_id="document-1",
        payload={"document_id": "document-1"},
    )
    vector_update_id = enqueue_knowledge_task(
        sqlite_session,
        kind=KnowledgeTaskKind.DATASET_VECTOR_INDEX_UPDATE,
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        payload={"dataset_id": "dataset-1", "action": "update"},
    )
    fresh_id = enqueue_knowledge_task(
        sqlite_session,
        kind=KnowledgeTaskKind.DATASET_SUMMARY_INDEX_REGENERATE,
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        payload={"dataset_id": "dataset-1"},
    )
    for intent_id, status in (
        (cleanup_id, "dispatched"),
        (completed_id, "completed"),
        (vector_update_id, "dispatched"),
    ):
        row = sqlite_session.get(KnowledgeTaskOutbox, intent_id)
        assert row is not None
        row.status = status
        row.dispatched_at = now - timedelta(hours=2)
    fresh = sqlite_session.get(KnowledgeTaskOutbox, fresh_id)
    assert fresh is not None
    fresh.status = "dispatched"
    fresh.dispatched_at = now - timedelta(seconds=899)
    sqlite_session.commit()
    store = SQLAlchemyKnowledgeTaskStore(session_factory=sqlite_session_factory)
    publisher = RecordingPublisher()
    publisher.fail = False
    dispatcher = KnowledgeTaskOutboxDispatcher(store=store, publisher=publisher, clock=MutableClock(now))

    recovered = dispatcher.dispatch_pending(limit=10)

    assert recovered.claimed == 2
    assert recovered.dispatched == 2
    assert set(publisher.calls) == {cleanup_id, vector_update_id}
    assert completed_id not in publisher.calls
    assert fresh_id not in publisher.calls
