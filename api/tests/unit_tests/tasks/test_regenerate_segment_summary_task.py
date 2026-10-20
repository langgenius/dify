from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Literal

import pytest
from redis import Redis
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker
from typing_extensions import TypedDict

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from graphon.model_runtime.entities.llm_entities import LLMUsage
from models.dataset import Dataset, Document, DocumentSegment, DocumentSegmentSummary
from models.enums import DocumentCreatedFrom, SegmentStatus, SummaryStatus
from services.knowledge.resource_scope import DatasetRef, SegmentRef
from tasks import regenerate_segment_summary_task as task_module


class SummaryJob(TypedDict, closed=True):
    tenant_id: str
    dataset_id: str
    document_id: str
    segment_id: str
    expected_index_node_hash: str | None
    token: str


@dataclass
class SummaryQueue:
    ref: SegmentRef
    tokens: dict[str, str] = field(default_factory=dict)
    jobs: list[SummaryJob] = field(default_factory=list)
    countdowns: list[int] = field(default_factory=list)
    token_writes: list[tuple[str, int, str]] = field(default_factory=list)
    enqueue_error: Exception | None = None

    def enqueue(self, *, kwargs: SummaryJob, countdown: int) -> None:
        if self.enqueue_error is not None:
            raise self.enqueue_error
        self.jobs.append(kwargs)
        self.countdowns.append(countdown)

    def schedule(self, sessions: sessionmaker[Session], expected_hash: str = "hash-1") -> str | None:
        return task_module.schedule_segment_summary_regeneration(self.ref, expected_hash, new_session=sessions)

    def run(self, *, job: int = -1) -> None:
        task_module.regenerate_segment_summary_task.run(**self.jobs[job])


@pytest.fixture
def summary_queue(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> Iterator[SummaryQueue]:
    with sqlite_session_factory.begin() as session:
        session.add(
            Dataset(
                id="dataset-1",
                tenant_id="tenant-1",
                name="Dataset",
                description="",
                provider="vendor",
                permission="only_me",
                indexing_technique="high_quality",
                created_by="author",
                summary_index_setting={"enable": True, "model_name": "model", "model_provider_name": "provider"},
            )
        )
        session.add(
            Document(
                id="document-1",
                tenant_id="tenant-1",
                dataset_id="dataset-1",
                position=1,
                data_source_type="upload_file",
                batch="batch",
                name="Document",
                created_from=DocumentCreatedFrom.API,
                created_by="author",
                doc_form="text_model",
            )
        )
        segment = DocumentSegment(
            tenant_id="tenant-1",
            dataset_id="dataset-1",
            document_id="document-1",
            position=1,
            content="edited content",
            word_count=14,
            tokens=2,
            created_by="author",
            status=SegmentStatus.COMPLETED,
            enabled=True,
            index_node_hash="hash-1",
        )
        segment.id = "segment-1"
        session.add(segment)
        session.add(
            DocumentSegmentSummary(
                dataset_id="dataset-1",
                document_id="document-1",
                chunk_id="segment-1",
                summary_content="old summary",
                status=SummaryStatus.COMPLETED,
                enabled=True,
                summary_index_node_id="old-node",
                error="old error",
            )
        )
    queue = SummaryQueue(DatasetRef("tenant-1", "dataset-1").document("document-1").segment("segment-1"))

    def get_token(key: str) -> bytes | None:
        token = queue.tokens.get(key)
        return token.encode() if token is not None else None

    def set_token(key: str, ttl: int, token: str) -> None:
        queue.tokens[key] = token
        queue.token_writes.append((key, ttl, token))

    def evaluate(_script: str, _numkeys: int, key: str, token: str, *replacement: str) -> int:
        if queue.tokens.get(key) != token:
            return 0
        if replacement:
            queue.tokens[key] = replacement[0]
        else:
            queue.tokens.pop(key)
        return 1

    # Keep real SDK objects, patching only the external Redis/broker operations.
    # These sequential unit tests check the task's version policy, not Redis Lua or locking itself.
    with Redis() as redis:
        lock = redis.lock("summary-test")
        monkeypatch.setattr(lock, "acquire", lambda: True)
        monkeypatch.setattr(lock, "release", lambda: None)
        monkeypatch.setattr(redis, "lock", lambda *_args, **_kwargs: lock)
        monkeypatch.setattr(redis, "get", get_token)
        monkeypatch.setattr(redis, "setex", set_token)
        monkeypatch.setattr(redis, "delete", lambda key: queue.tokens.pop(key, None))
        monkeypatch.setattr(redis, "eval", evaluate)
        monkeypatch.setattr(task_module, "redis_client", redis)
        monkeypatch.setattr(task_module.regenerate_segment_summary_task, "apply_async", queue.enqueue)
        yield queue


def test_schedule_preserves_summary_and_uses_ten_minute_countdown(
    summary_queue: SummaryQueue, sqlite_session_factory: sessionmaker[Session]
) -> None:
    token = summary_queue.schedule(sqlite_session_factory)
    assert token is not None
    assert summary_queue.jobs == [
        {
            "tenant_id": "tenant-1",
            "dataset_id": "dataset-1",
            "document_id": "document-1",
            "segment_id": "segment-1",
            "expected_index_node_hash": "hash-1",
            "token": token,
        }
    ]
    assert summary_queue.countdowns == [600]
    assert summary_queue.token_writes == [("segment_summary_regeneration:segment-1", 3600, token)]
    with sqlite_session_factory() as session:
        summary = session.scalar(select(DocumentSegmentSummary))
        assert summary is not None
        assert summary.status == SummaryStatus.NOT_STARTED
        assert summary.error is None
        assert summary.summary_content == "old summary"
        assert summary.summary_index_node_id == "old-node"


def test_latest_edit_replaces_token_and_superseded_delivery_does_not_generate(
    summary_queue: SummaryQueue, sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    generations: list[str] = []
    updates: list[tuple[str, str, str]] = []

    def generate(segment: DocumentSegment, *_args: object, **_kwargs: object) -> tuple[str, LLMUsage]:
        generations.append(segment.content)
        return "latest summary", LLMUsage.empty_usage()

    def update(segment: DocumentSegment, dataset: Dataset, content: str, *, session: Session) -> None:
        assert isinstance(session, Session)
        updates.append((segment.id, dataset.id, content))

    monkeypatch.setattr(task_module.SummaryIndexAdapter, "generate_summary_for_segment", generate)
    monkeypatch.setattr(task_module.SummaryIndexAdapter, "update_summary_for_segment", update)
    summary_queue.schedule(sqlite_session_factory)
    summary_queue.schedule(sqlite_session_factory)
    summary_queue.run(job=0)
    assert generations == []
    summary_queue.run()
    assert generations == ["edited content"]
    assert updates == [("segment-1", "dataset-1", "latest summary")]
    assert not summary_queue.tokens
    summary_queue.run()
    assert generations == ["edited content"]


@pytest.mark.parametrize("change", ["new_edit", "manual_edit", "content_hash", "settings", "disabled", "deleted"])
def test_result_is_discarded_when_segment_changes_during_generation(
    summary_queue: SummaryQueue,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    change: str,
) -> None:
    summary_queue.schedule(sqlite_session_factory)

    def generate(*_args: object, session: Session, **_kwargs: object) -> tuple[str, LLMUsage]:
        session.commit()
        if change == "new_edit":
            summary_queue.schedule(sqlite_session_factory)
        elif change == "manual_edit":
            task_module.cancel_segment_summary_regeneration("segment-1")
            with sqlite_session_factory.begin() as writer:
                summary = writer.scalar(select(DocumentSegmentSummary))
                assert summary is not None
                summary.summary_content = "manual summary"
                summary.status = SummaryStatus.COMPLETED
        else:
            with sqlite_session_factory.begin() as writer:
                segment = writer.get(DocumentSegment, "segment-1")
                dataset = writer.get(Dataset, "dataset-1")
                assert segment is not None
                assert dataset is not None
                if change == "content_hash":
                    segment.index_node_hash = "hash-2"
                elif change == "settings":
                    dataset.summary_index_setting = {
                        "enable": True,
                        "model_name": "other",
                        "model_provider_name": "provider",
                    }
                elif change == "disabled":
                    segment.enabled = False
                else:
                    writer.delete(segment)
        return "obsolete summary", LLMUsage.empty_usage()

    monkeypatch.setattr(task_module.SummaryIndexAdapter, "generate_summary_for_segment", generate)
    updates: list[str] = []

    def update(_segment: DocumentSegment, _dataset: Dataset, content: str, *, session: Session) -> None:
        assert isinstance(session, Session)
        updates.append(content)

    monkeypatch.setattr(task_module.SummaryIndexAdapter, "update_summary_for_segment", update)
    summary_queue.run()
    assert updates == []
    with sqlite_session_factory() as session:
        summary = session.scalar(select(DocumentSegmentSummary))
        assert summary is not None
        assert summary.summary_content == ("manual summary" if change == "manual_edit" else "old summary")
    if change == "new_edit":
        assert summary_queue.tokens


@pytest.mark.parametrize("owner", ["tenant_id", "dataset_id", "document_id"])
def test_task_rejects_foreign_owner_chain(
    summary_queue: SummaryQueue,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    owner: Literal["tenant_id", "dataset_id", "document_id"],
) -> None:
    summary_queue.schedule(sqlite_session_factory)
    args = summary_queue.jobs[-1].copy()
    args[owner] = "foreign-owner"
    generations: list[str] = []

    def generate(segment: DocumentSegment, *_args: object, **_kwargs: object) -> tuple[str, LLMUsage]:
        generations.append(segment.id)
        return "unexpected summary", LLMUsage.empty_usage()

    monkeypatch.setattr(task_module.SummaryIndexAdapter, "generate_summary_for_segment", generate)
    task_module.regenerate_segment_summary_task.run(**args)
    assert generations == []
    assert not summary_queue.tokens


@pytest.mark.parametrize("reason", ["disabled_setting", "economy", "qa_model", "disabled_summary", "incomplete"])
def test_task_skips_ineligible_segment(
    summary_queue: SummaryQueue,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    reason: str,
) -> None:
    summary_queue.schedule(sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        dataset = session.get(Dataset, "dataset-1")
        document = session.get(Document, "document-1")
        segment = session.get(DocumentSegment, "segment-1")
        summary = session.scalar(select(DocumentSegmentSummary))
        assert dataset is not None
        assert document is not None
        assert segment is not None
        assert summary is not None
        if reason == "disabled_setting":
            dataset.summary_index_setting = {"enable": False}
        elif reason == "economy":
            dataset.indexing_technique = IndexTechniqueType.ECONOMY
        elif reason == "qa_model":
            document.doc_form = IndexStructureType.QA_INDEX
        elif reason == "disabled_summary":
            summary.enabled = False
        else:
            segment.status = SegmentStatus.WAITING
    generations: list[str] = []

    def generate(segment: DocumentSegment, *_args: object, **_kwargs: object) -> tuple[str, LLMUsage]:
        generations.append(segment.id)
        return "unexpected summary", LLMUsage.empty_usage()

    monkeypatch.setattr(task_module.SummaryIndexAdapter, "generate_summary_for_segment", generate)
    summary_queue.run()
    assert generations == []
    assert not summary_queue.tokens


@pytest.mark.parametrize("failure", ["broker", "model", "empty", "whitespace"])
def test_failure_preserves_existing_summary_and_records_error(
    summary_queue: SummaryQueue,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    failure: str,
) -> None:
    if failure == "broker":
        summary_queue.enqueue_error = ConnectionError("broker unavailable")
        assert summary_queue.schedule(sqlite_session_factory) is None
    else:
        summary_queue.schedule(sqlite_session_factory)

        def generate(*_args: object, **_kwargs: object) -> tuple[str, LLMUsage]:
            if failure == "model":
                raise ValueError("model unavailable")
            return "" if failure == "empty" else " \n\t ", LLMUsage.empty_usage()

        monkeypatch.setattr(task_module.SummaryIndexAdapter, "generate_summary_for_segment", generate)
        summary_queue.run()
    with sqlite_session_factory() as session:
        summary = session.scalar(select(DocumentSegmentSummary))
        segment = session.get(DocumentSegment, "segment-1")
        assert summary is not None
        assert segment is not None
        assert summary.status == SummaryStatus.ERROR
        assert summary.error
        assert summary.summary_content == "old summary"
        assert summary.summary_index_node_id == "old-node"
        assert segment.status == SegmentStatus.COMPLETED
    assert not summary_queue.tokens


def test_stale_generation_error_does_not_overwrite_later_manual_summary(
    summary_queue: SummaryQueue, sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    summary_queue.schedule(sqlite_session_factory)

    def generate(*_args: object, session: Session, **_kwargs: object) -> None:
        session.commit()
        task_module.cancel_segment_summary_regeneration("segment-1")
        with sqlite_session_factory.begin() as writer:
            summary = writer.scalar(select(DocumentSegmentSummary))
            assert summary is not None
            summary.summary_content = "manual summary"
            summary.status = SummaryStatus.COMPLETED
        raise ValueError("old model failed")

    monkeypatch.setattr(task_module.SummaryIndexAdapter, "generate_summary_for_segment", generate)
    summary_queue.run()
    with sqlite_session_factory() as session:
        summary = session.scalar(select(DocumentSegmentSummary))
        assert summary is not None
        assert summary.summary_content == "manual summary"
        assert summary.status == SummaryStatus.COMPLETED
        assert summary.error is None


@pytest.mark.parametrize("invalid_ref", ["hash", "tenant", "document", "missing_summary"])
def test_stale_or_foreign_schedule_does_not_replace_latest_token(
    summary_queue: SummaryQueue, sqlite_session_factory: sessionmaker[Session], invalid_ref: str
) -> None:
    summary_queue.schedule(sqlite_session_factory)
    previous_tokens = dict(summary_queue.tokens)
    if invalid_ref == "missing_summary":
        with sqlite_session_factory.begin() as session:
            summary = session.scalar(select(DocumentSegmentSummary))
            assert summary is not None
            session.delete(summary)
    elif invalid_ref == "tenant":
        summary_queue.ref = DatasetRef("foreign-owner", "dataset-1").document("document-1").segment("segment-1")
    elif invalid_ref == "document":
        summary_queue.ref = DatasetRef("tenant-1", "dataset-1").document("foreign-owner").segment("segment-1")
    assert summary_queue.schedule(sqlite_session_factory, "wrong-hash" if invalid_ref == "hash" else "hash-1") is None
    assert summary_queue.tokens == previous_tokens
    assert len(summary_queue.jobs) == 1
