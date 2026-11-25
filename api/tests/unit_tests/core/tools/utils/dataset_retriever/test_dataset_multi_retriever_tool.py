from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from operator import itemgetter
from pathlib import Path
from typing import override
from unittest.mock import patch

import pytest
from flask import Flask
from sqlalchemy.orm import Session, scoped_session, sessionmaker
from yaml import YAMLError

from core.app.app_config.entities import DatasetRetrieveConfigEntity
from core.callback_handler.index_tool_callback_handler import DatasetIndexToolCallbackHandler
from core.model_manager import ModelInstance, ModelManager
from core.provider_manager import ProviderManager
from core.rag.data_post_processor.data_post_processor import WeightsDict
from core.rag.datasource.retrieval_service import DefaultRetrievalModelDict
from core.rag.embedding.retrieval import RetrievalSegments
from core.rag.entities import RetrievalSourceMetadata
from core.rag.models.document import Document as RagDocument
from core.rag.rerank.rerank_model import RerankModelRunner
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from core.tools.utils.dataset_retriever import dataset_multi_retriever_tool as multi_retriever_module
from core.tools.utils.dataset_retriever import dataset_retriever_tool as single_retriever_module
from core.tools.utils.dataset_retriever.dataset_multi_retriever_tool import DatasetMultiRetrieverTool
from core.tools.utils.dataset_retriever.dataset_retriever_tool import DatasetRetrieverTool as SingleDatasetRetrieverTool
from core.tools.utils.text_processing_utils import remove_leading_symbols
from core.tools.utils.uuid_utils import is_valid_uuid
from core.tools.utils.yaml_utils import _load_yaml_file, load_yaml_file_cached
from models.dataset import Dataset, DocumentSegment
from models.enums import DataSourceType, SegmentStatus
from tests.helpers.unit.model_factories import make_document


def _flask_app() -> Flask:
    return Flask(__name__)


def _retrieve_config() -> DatasetRetrieveConfigEntity:
    return DatasetRetrieveConfigEntity(retrieve_strategy=DatasetRetrieveConfigEntity.RetrieveStrategy.SINGLE)


def _persist_dataset(
    session: Session,
    *,
    dataset_id: str | None = None,
    tenant_id: str | None = None,
    name: str = "Knowledge Base",
    provider: str = "vendor",
    retrieval_model: DefaultRetrievalModelDict | None = None,
) -> Dataset:
    dataset = Dataset(
        id=dataset_id or str(uuid.uuid4()),
        tenant_id=tenant_id or str(uuid.uuid4()),
        name=name,
        provider=provider,
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique="high_quality",
        retrieval_model=retrieval_model,
        created_by=str(uuid.uuid4()),
    )
    session.add(dataset)
    session.commit()
    return dataset


@dataclass(eq=False, repr=False)
class _DatabaseWithSession:
    session: scoped_session[Session]


class _UnusedProviderManager(ProviderManager):
    def __init__(self) -> None:
        pass


class _UnusedModelInstance(ModelInstance):
    def __init__(self) -> None:
        pass


class _TestHitCallback(DatasetIndexToolCallbackHandler):
    def __init__(self) -> None:
        self.queries: list[tuple[str, str]] = []
        self.documents: list[RagDocument] | None = None
        self.resources: list[RetrievalSourceMetadata] | None = None

    @override
    def on_query(self, query: str, dataset_id: str, session: Session) -> None:
        self.queries.append((query, dataset_id))

    @override
    def on_tool_end(self, documents: list[RagDocument], session: Session) -> None:
        self.documents = documents

    @override
    def return_retriever_resource_info(self, resource: Sequence[RetrievalSourceMetadata]) -> None:
        self.resources = list(resource)


def test_remove_leading_symbols_preserves_markdown_link_and_strips_punctuation() -> None:
    markdown = "[Example](https://example.com) content"
    assert remove_leading_symbols(markdown) == markdown

    assert remove_leading_symbols("...Hello world") == "Hello world"


def test_is_valid_uuid_handles_valid_invalid_and_empty_values() -> None:
    assert is_valid_uuid(str(uuid.uuid4())) is True
    assert is_valid_uuid("not-a-uuid") is False
    assert is_valid_uuid("") is False
    assert is_valid_uuid(None) is False


def test_load_yaml_file_valid(tmp_path: Path) -> None:
    valid_file = tmp_path / "valid.yaml"
    valid_file.write_text("a: 1\nb: two\n", encoding="utf-8")

    loaded = _load_yaml_file(file_path=str(valid_file))

    assert loaded == {"a": 1, "b": "two"}


def test_load_yaml_file_missing(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        _load_yaml_file(file_path=str(tmp_path / "missing.yaml"))


def test_load_yaml_file_invalid(tmp_path: Path) -> None:
    invalid_file = tmp_path / "invalid.yaml"
    invalid_file.write_text("a: [1, 2\n", encoding="utf-8")

    with pytest.raises(YAMLError):
        _load_yaml_file(file_path=str(invalid_file))


def test_load_yaml_file_cached_hits(tmp_path: Path) -> None:
    valid_file = tmp_path / "valid.yaml"
    valid_file.write_text("a: 1\nb: two\n", encoding="utf-8")

    load_yaml_file_cached.cache_clear()
    assert load_yaml_file_cached(str(valid_file)) == {"a": 1, "b": "two"}

    assert load_yaml_file_cached(str(valid_file)) == {"a": 1, "b": "two"}
    assert load_yaml_file_cached.cache_info().hits == 1


def test_single_dataset_retriever_from_dataset_builds_name_and_description(sqlite_session: Session) -> None:
    dataset = _persist_dataset(
        sqlite_session,
        dataset_id="dataset-1",
        tenant_id="tenant-1",
        name="Knowledge",
    )

    tool = SingleDatasetRetrieverTool.from_dataset(
        dataset=dataset,
        retrieve_config=_retrieve_config(),
        return_resource=False,
        retriever_from="prod",
        inputs={},
    )

    assert tool.name == "dataset_dataset_1"
    assert tool.description == "useful for when you want to answer queries about the Knowledge"


def test_single_dataset_retriever_external_run_returns_content_and_resources(sqlite_session: Session) -> None:
    dataset = _persist_dataset(sqlite_session, provider="external")
    # External retrieval forwards its stored parameters, including an explicitly empty mapping.
    dataset.retrieval_model = {}
    sqlite_session.commit()
    callback = _TestHitCallback()
    metadata_filter_result = (
        {dataset.id: ["doc-a"]},
        {"logical_operator": "and"},
    )
    external_documents = [
        {"content": "first", "metadata": {"document_id": "doc-a"}, "score": 0.9, "title": "Doc A"},
        {"content": "second", "metadata": {"document_id": "doc-b"}, "score": 0.8, "title": "Doc B"},
    ]

    tool = SingleDatasetRetrieverTool(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        retrieve_config=_retrieve_config(),
        return_resource=True,
        retriever_from="dev",
        hit_callbacks=[callback],
        inputs={"x": 1},
    )

    with patch.object(
        single_retriever_module.DatasetRetrieval,
        "get_metadata_filter_condition",
        return_value=metadata_filter_result,
    ):
        with patch.object(
            single_retriever_module.ExternalDatasetService,
            "fetch_external_knowledge_retrieval",
            return_value=external_documents,
        ) as fetch_mock:
            result = tool.run(session=sqlite_session, query="hello")

    assert result == "first\nsecond"
    assert callback.queries == [("hello", dataset.id)]
    assert callback.resources is not None
    resource_info = callback.resources
    assert [item.position for item in resource_info] == [1, 2]
    assert resource_info[0].dataset_id == dataset.id
    fetch_mock.assert_called_once()
    assert fetch_mock.call_args.kwargs["session"] is sqlite_session
    assert fetch_mock.call_args.kwargs["external_retrieval_parameters"] == {}


def test_single_dataset_retriever_returns_empty_when_metadata_filter_finds_no_documents(
    sqlite_session: Session,
) -> None:
    dataset = _persist_dataset(sqlite_session)
    tool = SingleDatasetRetrieverTool(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        retrieve_config=_retrieve_config(),
        return_resource=False,
        retriever_from="prod",
        hit_callbacks=[_TestHitCallback()],
        inputs={},
    )

    with patch.object(
        single_retriever_module.DatasetRetrieval,
        "get_metadata_filter_condition",
        return_value=({dataset.id: []}, {"logical_operator": "and"}),
    ):
        with patch.object(single_retriever_module.RetrievalService, "retrieve") as retrieve_mock:
            result = tool.run(session=sqlite_session, query="hello")

    assert result == ""
    retrieve_mock.assert_not_called()


def test_single_dataset_retriever_non_economy_run_sorts_context_and_resources(sqlite_session: Session) -> None:
    dataset = _persist_dataset(
        sqlite_session,
        retrieval_model={
            "search_method": RetrievalMethod.SEMANTIC_SEARCH,
            "top_k": 4,
            "score_threshold_enabled": True,
            "score_threshold": 0.2,
            "reranking_enable": True,
            "reranking_model": {"reranking_provider_name": "provider", "reranking_model_name": "model"},
            "reranking_mode": "reranking_model",
            "weights": {
                "vector_setting": {
                    "vector_weight": 0.6,
                    "embedding_provider_name": "openai",
                    "embedding_model_name": "text-embedding-3-small",
                },
                "keyword_setting": {"keyword_weight": 0.4},
            },
        },
    )
    document_low = make_document(
        document_id=None,
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        created_by=dataset.created_by,
        name="Document Low",
        doc_metadata={"lang": "en"},
    )
    document_high = make_document(
        document_id=None,
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        created_by=dataset.created_by,
        name="Document High",
        data_source_type=DataSourceType.NOTION_IMPORT,
        doc_metadata={"lang": "fr"},
    )
    sqlite_session.add_all([document_low, document_high])
    sqlite_session.commit()
    callback = _TestHitCallback()
    low_segment = DocumentSegment(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document_low.id,
        index_node_id="node-low",
        content="raw low",
        hit_count=1,
        word_count=10,
        position=3,
        index_node_hash="hash-low",
        tokens=10,
        created_by=dataset.created_by,
        answer="low answer",
        status=SegmentStatus.COMPLETED,
        completed_at=datetime.now(),
    )
    high_segment = DocumentSegment(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document_high.id,
        index_node_id="node-high",
        content="raw high",
        hit_count=9,
        word_count=25,
        position=1,
        index_node_hash="hash-high",
        tokens=25,
        created_by=dataset.created_by,
        status=SegmentStatus.COMPLETED,
        completed_at=datetime.now(),
    )
    sqlite_session.add_all([low_segment, high_segment])
    sqlite_session.commit()
    records = [
        RetrievalSegments(segment=low_segment, score=0.2, summary="summary low"),
        RetrievalSegments(segment=high_segment, score=0.9),
    ]
    documents = [
        RagDocument(page_content="first", metadata={"doc_id": "node-low", "score": 0.2}),
        RagDocument(page_content="second", metadata={"doc_id": "node-high", "score": 0.9}),
    ]
    tool = SingleDatasetRetrieverTool(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        retrieve_config=_retrieve_config(),
        return_resource=True,
        retriever_from="dev",
        hit_callbacks=[callback],
        inputs={},
        top_k=2,
    )

    with (
        patch.object(
            single_retriever_module.DatasetRetrieval,
            "get_metadata_filter_condition",
            return_value=(None, None),
        ),
        patch.object(single_retriever_module.RetrievalService, "retrieve", return_value=documents),
        patch.object(
            single_retriever_module.RetrievalService,
            "format_retrieval_documents",
            return_value=records,
        ),
        patch.object(
            single_retriever_module,
            "sign_segment_content",
            lambda segment, **_kwargs: segment.content.replace("raw", "signed"),
        ),
    ):
        result = tool.run(session=sqlite_session, query="hello")

    assert result == "signed high\nsummary low\nquestion:signed low answer:low answer"
    assert callback.documents == documents
    assert callback.resources is not None
    resource_info = callback.resources
    assert [item.position for item in resource_info] == [1, 2]
    assert resource_info[0].segment_id == high_segment.id
    assert resource_info[0].hit_count == 9
    assert [item.doc_metadata for item in resource_info] == [{"lang": "fr"}, {"lang": "en"}]
    assert resource_info[1].summary == "summary low"
    assert resource_info[1].content == "question:raw low \nanswer:low answer"


def test_multi_dataset_retriever_from_dataset_sets_tool_name() -> None:
    tool = DatasetMultiRetrieverTool.from_dataset(
        dataset_ids=["dataset-1"],
        tenant_id="tenant-1",
        reranking_provider_name="provider",
        reranking_model_name="model",
        return_resource=False,
        retriever_from="prod",
    )

    assert tool.name == "dataset_tenant_1"


def test_multi_dataset_retriever_retriever_returns_early_when_dataset_is_missing(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    callback = _TestHitCallback()
    all_documents: list[RagDocument] = []
    db_session = scoped_session(sqlite_session_factory)
    tool = DatasetMultiRetrieverTool(
        tenant_id="tenant-1",
        dataset_ids=["dataset-1"],
        reranking_provider_name="provider",
        reranking_model_name="model",
        return_resource=False,
        retriever_from="prod",
    )

    try:
        with patch.object(multi_retriever_module, "db", _DatabaseWithSession(db_session)):
            with patch.object(multi_retriever_module.RetrievalService, "retrieve") as retrieve_mock:
                result = tool._retriever(
                    flask_app=_flask_app(),
                    dataset_id=str(uuid.uuid4()),
                    query="hello",
                    all_documents=all_documents,
                    hit_callbacks=[callback],
                )
    finally:
        db_session.remove()

    assert result == []
    assert all_documents == []
    assert callback.queries == []
    retrieve_mock.assert_not_called()


@pytest.mark.parametrize("legacy_null_reranking_mode", [False, True], ids=["missing-mode", "legacy-null-mode"])
def test_multi_dataset_retriever_retriever_non_economy_uses_retrieval_model(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    legacy_null_reranking_mode: bool,
) -> None:
    """Forward configured retrieval options and default both missing and legacy null reranking modes."""
    weights: WeightsDict = {
        "vector_setting": {
            "vector_weight": 0.5,
            "embedding_provider_name": "openai",
            "embedding_model_name": "text-embedding-3-small",
        },
        "keyword_setting": {"keyword_weight": 0.5},
    }
    retrieval_model: DefaultRetrievalModelDict = {
        "search_method": RetrievalMethod.SEMANTIC_SEARCH,
        "top_k": 6,
        "score_threshold_enabled": True,
        "score_threshold": 0.4,
        "reranking_enable": False,
        "reranking_model": {"reranking_provider_name": "", "reranking_model_name": ""},
        "weights": weights,
    }
    dataset = _persist_dataset(sqlite_session, retrieval_model=retrieval_model)
    if legacy_null_reranking_mode:
        # The JSON column also accepts legacy data outside the default settings shape.
        dataset.retrieval_model = {**retrieval_model, "reranking_mode": None}
        sqlite_session.commit()
    callback = _TestHitCallback()
    documents = [RagDocument(page_content="retrieved", metadata={"doc_id": "node-1", "score": 0.4})]
    all_documents: list[RagDocument] = []
    db_session = scoped_session(sqlite_session_factory)
    tool = DatasetMultiRetrieverTool(
        tenant_id=dataset.tenant_id,
        dataset_ids=[dataset.id],
        reranking_provider_name="provider",
        reranking_model_name="model",
        return_resource=False,
        retriever_from="prod",
        top_k=2,
    )

    try:
        with patch.object(multi_retriever_module, "db", _DatabaseWithSession(db_session)):
            with patch.object(
                multi_retriever_module.RetrievalService, "retrieve", return_value=documents
            ) as retrieve_mock:
                tool._retriever(
                    flask_app=_flask_app(),
                    dataset_id=dataset.id,
                    query="hello",
                    all_documents=all_documents,
                    hit_callbacks=[callback],
                )
    finally:
        db_session.remove()

    assert all_documents == documents
    assert callback.queries == [("hello", dataset.id)]
    retrieve_mock.assert_called_once_with(
        retrieval_method="semantic_search",
        dataset_id=dataset.id,
        query="hello",
        top_k=6,
        score_threshold=0.4,
        reranking_model=None,
        reranking_mode="reranking_model",
        weights=weights,
    )


def test_multi_dataset_retriever_run_orders_segments_and_returns_resources(sqlite_session: Session) -> None:
    """Return ranked resources after both dataset workers contribute documents."""
    dataset_one = _persist_dataset(sqlite_session, name="Dataset One")
    dataset_two = _persist_dataset(sqlite_session, tenant_id=dataset_one.tenant_id, name="Dataset Two")
    document_two = make_document(
        document_id=None,
        tenant_id=dataset_one.tenant_id,
        dataset_id=dataset_one.id,
        created_by=dataset_one.created_by,
        name="Doc Two",
        data_source_type=DataSourceType.NOTION_IMPORT,
        doc_metadata={"p": 2},
    )
    document_one = make_document(
        document_id=None,
        tenant_id=dataset_two.tenant_id,
        dataset_id=dataset_two.id,
        created_by=dataset_two.created_by,
        name="Doc One",
        doc_metadata={"p": 1},
    )
    sqlite_session.add_all([document_two, document_one])
    sqlite_session.commit()
    dataset_ids = [dataset_one.id, dataset_two.id]
    callback = _TestHitCallback()
    tool = DatasetMultiRetrieverTool(
        tenant_id=dataset_one.tenant_id,
        dataset_ids=dataset_ids,
        reranking_provider_name="provider",
        reranking_model_name="model",
        return_resource=True,
        retriever_from="dev",
        hit_callbacks=[callback],
        top_k=2,
        score_threshold=0.1,
    )
    first_doc = RagDocument(page_content="first", metadata={"doc_id": "node-2", "score": 0.4})
    second_doc = RagDocument(page_content="second", metadata={"doc_id": "node-1", "score": 0.9})

    documents_by_dataset = {dataset_ids[0]: first_doc, dataset_ids[1]: second_doc}
    retriever_calls: list[tuple[str, Flask, str, tuple[DatasetIndexToolCallbackHandler, ...]]] = []

    def fake_retriever(
        *,
        flask_app: Flask,
        dataset_id: str,
        query: str,
        all_documents: list[RagDocument],
        hit_callbacks: list[DatasetIndexToolCallbackHandler],
    ) -> None:
        """Record the worker inputs and emit its document without accessing the SQLite session."""
        retriever_calls.append((dataset_id, flask_app, query, tuple(hit_callbacks)))
        all_documents.append(documents_by_dataset[dataset_id])

    def fake_rerank(
        query: str, documents: list[RagDocument], score_threshold: float | None, top_n: int | None
    ) -> list[RagDocument]:
        """Verify both workers finished before returning a deterministic ranking."""
        assert query == "hello"
        assert score_threshold == 0.1
        assert top_n == 2
        assert sorted(documents, key=lambda document: document.page_content) == [first_doc, second_doc]
        return [second_doc, first_doc]

    segment_for_node_2 = DocumentSegment(
        tenant_id=dataset_one.tenant_id,
        dataset_id=dataset_one.id,
        document_id=document_two.id,
        index_node_id="node-2",
        content="raw two",
        hit_count=2,
        word_count=20,
        position=2,
        index_node_hash="hash-2",
        tokens=20,
        created_by=dataset_one.created_by,
        answer="answer two",
        status=SegmentStatus.COMPLETED,
        completed_at=datetime.now(),
    )
    segment_for_node_1 = DocumentSegment(
        tenant_id=dataset_two.tenant_id,
        dataset_id=dataset_two.id,
        document_id=document_one.id,
        index_node_id="node-1",
        content="raw one",
        hit_count=7,
        word_count=30,
        position=1,
        index_node_hash="hash-1",
        tokens=30,
        created_by=dataset_two.created_by,
        status=SegmentStatus.COMPLETED,
        completed_at=datetime.now(),
    )
    sqlite_session.add_all([segment_for_node_2, segment_for_node_1])
    sqlite_session.commit()
    model_manager = ModelManager(provider_manager=_UnusedProviderManager())
    model_instance = _UnusedModelInstance()
    rerank_runner = RerankModelRunner(model_instance, session=sqlite_session)
    flask_app = _flask_app()

    with (
        flask_app.app_context(),
        patch.object(
            multi_retriever_module,
            "sign_segment_content",
            lambda segment, **_kwargs: segment.content.replace("raw", "signed"),
        ),
        patch.object(tool, "_retriever", new=fake_retriever),
        patch.object(multi_retriever_module.ModelManager, "for_tenant", return_value=model_manager),
        patch.object(model_manager, "get_model_instance", return_value=model_instance),
        patch.object(multi_retriever_module, "RerankModelRunner", return_value=rerank_runner) as rerank_runner_class,
        patch.object(rerank_runner, "run", side_effect=fake_rerank) as rerank_mock,
    ):
        result = tool.run(session=sqlite_session, query="hello")

    assert result == "signed one\nquestion:signed two answer:answer two"
    rerank_runner_class.assert_called_once_with(model_instance, session=sqlite_session)
    rerank_mock.assert_called_once()
    assert sorted(retriever_calls, key=itemgetter(0)) == [
        (dataset_id, flask_app, "hello", (callback,)) for dataset_id in sorted(dataset_ids)
    ]
    assert callback.documents == [second_doc, first_doc]
    assert callback.resources is not None
    resource_info = callback.resources
    assert [item.position for item in resource_info] == [1, 2]
    assert resource_info[0].score == 0.9
    assert resource_info[0].content == "raw one"
    assert [item.doc_metadata for item in resource_info] == [{"p": 1}, {"p": 2}]
    assert resource_info[1].score == 0.4
    assert resource_info[1].content == "question:raw two \nanswer:answer two"
