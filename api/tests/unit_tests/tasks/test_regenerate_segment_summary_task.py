from dataclasses import dataclass
from unittest.mock import MagicMock

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from graphon.model_runtime.entities.llm_entities import LLMUsage
from models.dataset import Dataset, Document, DocumentSegment, DocumentSegmentSummary
from models.enums import DocumentCreatedFrom, SegmentStatus, SummaryStatus
from services.knowledge.resource_scope import DatasetRef, SegmentRef
from tasks import regenerate_segment_summary_task as task_module


@dataclass
class SummaryQueue:
    ref: SegmentRef
    redis: MagicMock
    task: MagicMock
    tokens: dict[str, str]

    def schedule(self, sessions: sessionmaker[Session], expected_hash: str = "hash-1") -> str | None:
        return task_module.schedule_segment_summary_regeneration(self.ref, expected_hash, new_session=sessions)

    def run(self, *, job: int = -1) -> None:
        task_module.regenerate_segment_summary_task.run(**self.task.call_args_list[job].kwargs["kwargs"])


@pytest.fixture
def summary_queue(sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> SummaryQueue:
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
    tokens: dict[str, str] = {}
    redis = MagicMock()
    redis.get.side_effect = lambda key: tokens[key].encode() if key in tokens else None
    redis.setex.side_effect = lambda key, _ttl, token: tokens.update({key: token})
    redis.delete.side_effect = lambda key: tokens.pop(key, None)

    def evaluate(_script: str, _numkeys: int, key: str, token: str, *replacement: str) -> int:
        if tokens.get(key) != token:
            return 0
        if replacement:
            tokens[key] = replacement[0]
        else:
            tokens.pop(key)
        return 1

    redis.eval.side_effect = evaluate
    monkeypatch.setattr(task_module, "redis_client", redis)
    task = MagicMock()
    monkeypatch.setattr(task_module.regenerate_segment_summary_task, "apply_async", task)
    return SummaryQueue(
        DatasetRef("tenant-1", "dataset-1").document("document-1").segment("segment-1"), redis, task, tokens
    )


def test_schedule_preserves_summary_and_uses_ten_minute_countdown(
    summary_queue: SummaryQueue, sqlite_session_factory: sessionmaker[Session]
) -> None:
    token = summary_queue.schedule(sqlite_session_factory)
    assert token is not None
    summary_queue.task.assert_called_once_with(
        kwargs={
            "tenant_id": "tenant-1",
            "dataset_id": "dataset-1",
            "document_id": "document-1",
            "segment_id": "segment-1",
            "expected_index_node_hash": "hash-1",
            "token": token,
        },
        countdown=600,
    )
    summary_queue.redis.setex.assert_called_once_with("segment_summary_regeneration:segment-1", 3600, token)
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
    generate = MagicMock(return_value=("latest summary", LLMUsage.empty_usage()))
    update = MagicMock()
    monkeypatch.setattr(task_module.SummaryIndexAdapter, "generate_summary_for_segment", generate)
    monkeypatch.setattr(task_module.SummaryIndexAdapter, "update_summary_for_segment", update)
    summary_queue.schedule(sqlite_session_factory)
    summary_queue.schedule(sqlite_session_factory)
    summary_queue.run(job=0)
    generate.assert_not_called()
    summary_queue.run()
    generate.assert_called_once()
    update.assert_called_once()
    assert update.call_args.args[2] == "latest summary"
    assert not summary_queue.tokens
    summary_queue.run()
    assert generate.call_count == 1


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
    update = MagicMock()
    monkeypatch.setattr(task_module.SummaryIndexAdapter, "update_summary_for_segment", update)
    summary_queue.run()
    update.assert_not_called()
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
    owner: str,
) -> None:
    summary_queue.schedule(sqlite_session_factory)
    args = dict(summary_queue.task.call_args.kwargs["kwargs"])
    args[owner] = "foreign-owner"
    generate = MagicMock()
    monkeypatch.setattr(task_module.SummaryIndexAdapter, "generate_summary_for_segment", generate)
    task_module.regenerate_segment_summary_task.run(**args)
    generate.assert_not_called()
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
    generate = MagicMock()
    monkeypatch.setattr(task_module.SummaryIndexAdapter, "generate_summary_for_segment", generate)
    summary_queue.run()
    generate.assert_not_called()
    assert not summary_queue.tokens


@pytest.mark.parametrize("failure", ["broker", "model", "empty", "whitespace"])
def test_failure_preserves_existing_summary_and_records_error(
    summary_queue: SummaryQueue,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    failure: str,
) -> None:
    if failure == "broker":
        summary_queue.task.side_effect = ConnectionError("broker unavailable")
        assert summary_queue.schedule(sqlite_session_factory) is None
    else:
        summary_queue.schedule(sqlite_session_factory)
        generate = MagicMock()
        if failure == "model":
            generate.side_effect = ValueError("model unavailable")
        else:
            generate.return_value = ("" if failure == "empty" else " \n\t ", LLMUsage.empty_usage())
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
    assert summary_queue.task.call_count == 1
