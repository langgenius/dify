"""Unit tests for `api/services/vector_service.py`."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from unittest.mock import MagicMock

import pytest
from sqlalchemy import event
from sqlalchemy.orm import Session

import services.vector_service as vector_service_module
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from extensions.storage.storage_type import StorageType
from models import UploadFile
from models.dataset import ChildChunk, Dataset, DatasetProcessRule, DocumentSegment, SegmentAttachmentBinding
from models.dataset import Document as DatasetDocument
from models.enums import CreatorUserRole, DataSourceType, DocumentCreatedFrom, ProcessRuleMode
from services.vector_service import VectorService


@dataclass(frozen=True)
class _ChildDocStub:
    page_content: str
    metadata: dict[str, Any]


@dataclass
class _ParentDocStub:
    children: list[_ChildDocStub]


def _make_dataset(
    *,
    indexing_technique: str = IndexTechniqueType.HIGH_QUALITY,
    doc_form: str = IndexStructureType.PARAGRAPH_INDEX,
    tenant_id: str = "tenant-1",
    dataset_id: str = "dataset-1",
    is_multimodal: bool = False,
    embedding_model_provider: str | None = "openai",
    embedding_model: str = "text-embedding",
) -> Dataset:
    dataset = Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        name="Dataset",
        created_by="account-1",
        indexing_technique=indexing_technique,
        chunk_structure=doc_form,
        is_multimodal=is_multimodal,
        embedding_model_provider=embedding_model_provider,
        embedding_model=embedding_model,
    )
    return dataset


def _make_segment(
    *,
    segment_id: str = "seg-1",
    tenant_id: str = "tenant-1",
    dataset_id: str = "dataset-1",
    document_id: str = "doc-1",
    content: str = "hello",
    index_node_id: str = "node-1",
    index_node_hash: str = "hash-1",
    session: Session | None = None,
    attachments: list[dict[str, str]] | None = None,
) -> DocumentSegment:
    segment = DocumentSegment(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=document_id,
        position=1,
        content=content,
        word_count=len(content),
        tokens=len(content),
        created_by="account-1",
        index_node_id=index_node_id,
        index_node_hash=index_node_hash,
    )
    segment.id = segment_id
    if attachments:
        assert session is not None
        for attachment in attachments:
            upload_file = _upload_file(
                file_id=attachment["id"],
                name=attachment.get("name", f"{attachment['id']}.png"),
                tenant_id=tenant_id,
            )
            session.add_all(
                [
                    upload_file,
                    SegmentAttachmentBinding(
                        tenant_id=tenant_id,
                        dataset_id=dataset_id,
                        document_id=document_id,
                        segment_id=segment_id,
                        attachment_id=upload_file.id,
                    ),
                ]
            )
        session.flush()
    return segment


def _upload_file(*, file_id: str = "file-1", name: str = "img.png", tenant_id: str = "tenant-1") -> UploadFile:
    upload_file = UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.LOCAL,
        key=f"uploads/{file_id}",
        name=name,
        size=10,
        extension="png",
        mime_type="image/png",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
        created_at=datetime(2026, 1, 1),
        used=False,
    )
    upload_file.id = file_id
    return upload_file


def _make_child_chunk(
    *,
    index_node_id: str,
    content: str = "child",
    index_node_hash: str = "hash",
    tenant_id: str = "tenant-1",
    dataset_id: str = "dataset-1",
    document_id: str = "doc-1",
    segment_id: str = "seg-1",
) -> ChildChunk:
    return ChildChunk(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=document_id,
        segment_id=segment_id,
        position=1,
        content=content,
        word_count=len(content),
        created_by="account-1",
        index_node_id=index_node_id,
        index_node_hash=index_node_hash,
    )


def test_create_segments_vector_regular_indexing_loads_documents_and_keywords(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    dataset = _make_dataset(is_multimodal=False)
    segment = _make_segment()

    index_processor = MagicMock(name="index_processor")
    factory_instance = MagicMock(name="IndexProcessorFactory-instance")
    factory_instance.init_index_processor.return_value = index_processor
    monkeypatch.setattr(vector_service_module, "IndexProcessorFactory", MagicMock(return_value=factory_instance))

    VectorService.create_segments_vector(
        [["k1"]], [segment], dataset, IndexStructureType.PARAGRAPH_INDEX, session=sqlite_session
    )

    index_processor.load.assert_called_once()
    args, kwargs = index_processor.load.call_args
    assert args[0] == dataset
    assert len(args[1]) == 1
    assert args[2] is None
    assert kwargs["with_keywords"] is True
    assert kwargs["keywords_list"] == [["k1"]]


def test_create_segments_vector_regular_indexing_loads_multimodal_documents(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    dataset = _make_dataset(is_multimodal=True)
    segment = _make_segment(
        session=sqlite_session,
        attachments=[
            {"id": "img-1", "name": "a.png"},
            {"id": "img-2", "name": "b.png"},
        ],
    )

    index_processor = MagicMock(name="index_processor")
    factory_instance = MagicMock(name="IndexProcessorFactory-instance")
    factory_instance.init_index_processor.return_value = index_processor
    monkeypatch.setattr(vector_service_module, "IndexProcessorFactory", MagicMock(return_value=factory_instance))

    VectorService.create_segments_vector(
        [["k1"]], [segment], dataset, IndexStructureType.PARAGRAPH_INDEX, session=sqlite_session
    )

    assert index_processor.load.call_count == 2
    first_args, first_kwargs = index_processor.load.call_args_list[0]
    assert first_args[0] == dataset
    assert len(first_args[1]) == 1
    assert first_kwargs["with_keywords"] is True

    second_args, second_kwargs = index_processor.load.call_args_list[1]
    assert second_args[0] == dataset
    assert second_args[1] == []
    assert len(second_args[2]) == 2
    assert second_kwargs["with_keywords"] is False
    assert {document.page_content for document in second_args[2]} == {"a.png", "b.png"}


def test_create_segments_vector_with_no_segments_does_not_load(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    dataset = _make_dataset()
    index_processor = MagicMock(name="index_processor")
    factory_instance = MagicMock()
    factory_instance.init_index_processor.return_value = index_processor
    monkeypatch.setattr(vector_service_module, "IndexProcessorFactory", MagicMock(return_value=factory_instance))

    VectorService.create_segments_vector(None, [], dataset, IndexStructureType.PARAGRAPH_INDEX, session=sqlite_session)
    index_processor.load.assert_not_called()


def _persist_parent_child_rows(
    session: Session,
    *,
    segment: DocumentSegment,
    include_document: bool = True,
    include_rule: bool = True,
) -> tuple[DatasetDocument | None, DatasetProcessRule | None]:
    document = None
    rule = None
    if include_document:
        document = DatasetDocument(
            id=segment.document_id,
            tenant_id=segment.tenant_id,
            dataset_id=segment.dataset_id,
            position=1,
            data_source_type=DataSourceType.UPLOAD_FILE,
            dataset_process_rule_id="rule-1",
            batch="batch-1",
            name="Document",
            created_from=DocumentCreatedFrom.API,
            created_by="user-1",
            doc_language="en",
        )
        session.add(document)
    if include_rule:
        rule = DatasetProcessRule(
            dataset_id=segment.dataset_id,
            mode=ProcessRuleMode.HIERARCHICAL,
            rules='{"parent_mode":"full-doc"}',
            created_by="user-1",
        )
        rule.id = "rule-1"
        session.add(rule)
    session.flush()
    return document, rule


def test_create_segments_vector_parent_child_calls_generate_child_chunks_with_explicit_model(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    dataset = _make_dataset(
        doc_form=vector_service_module.IndexStructureType.PARENT_CHILD_INDEX,
        embedding_model_provider="openai",
        indexing_technique=IndexTechniqueType.HIGH_QUALITY,
    )
    segment = _make_segment()

    dataset_document, processing_rule = _persist_parent_child_rows(sqlite_session, segment=segment)
    assert dataset_document is not None
    assert processing_rule is not None

    embedding_model_instance = MagicMock(name="embedding_model_instance")
    model_manager_instance = MagicMock(name="model_manager_instance")
    model_manager_instance.get_model_instance.return_value = embedding_model_instance
    monkeypatch.setattr(
        vector_service_module.ModelManager, "for_tenant", MagicMock(return_value=model_manager_instance)
    )

    generate_child_chunks_mock = MagicMock()
    monkeypatch.setattr(VectorService, "generate_child_chunks", generate_child_chunks_mock)

    index_processor = MagicMock()
    factory_instance = MagicMock()
    factory_instance.init_index_processor.return_value = index_processor
    monkeypatch.setattr(vector_service_module, "IndexProcessorFactory", MagicMock(return_value=factory_instance))

    VectorService.create_segments_vector(
        None,
        [segment],
        dataset,
        vector_service_module.IndexStructureType.PARENT_CHILD_INDEX,
        session=sqlite_session,
    )

    model_manager_instance.get_model_instance.assert_called_once()
    generate_child_chunks_mock.assert_called_once_with(
        segment, dataset_document, dataset, embedding_model_instance, processing_rule, False, session=sqlite_session
    )
    index_processor.load.assert_not_called()


def test_create_segments_vector_parent_child_uses_default_embedding_model_when_provider_missing(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    dataset = _make_dataset(
        doc_form=vector_service_module.IndexStructureType.PARENT_CHILD_INDEX,
        embedding_model_provider=None,
        indexing_technique=IndexTechniqueType.HIGH_QUALITY,
    )
    segment = _make_segment()

    _persist_parent_child_rows(sqlite_session, segment=segment)

    embedding_model_instance = MagicMock()
    model_manager_instance = MagicMock()
    model_manager_instance.get_default_model_instance.return_value = embedding_model_instance
    monkeypatch.setattr(
        vector_service_module.ModelManager, "for_tenant", MagicMock(return_value=model_manager_instance)
    )

    generate_child_chunks_mock = MagicMock()
    monkeypatch.setattr(VectorService, "generate_child_chunks", generate_child_chunks_mock)

    index_processor = MagicMock()
    factory_instance = MagicMock()
    factory_instance.init_index_processor.return_value = index_processor
    monkeypatch.setattr(vector_service_module, "IndexProcessorFactory", MagicMock(return_value=factory_instance))

    VectorService.create_segments_vector(
        None,
        [segment],
        dataset,
        vector_service_module.IndexStructureType.PARENT_CHILD_INDEX,
        session=sqlite_session,
    )

    model_manager_instance.get_default_model_instance.assert_called_once()
    generate_child_chunks_mock.assert_called_once()


def test_create_segments_vector_parent_child_missing_document_logs_warning_and_continues(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    sqlite_session: Session,
) -> None:
    dataset = _make_dataset(doc_form=vector_service_module.IndexStructureType.PARENT_CHILD_INDEX)
    segment = _make_segment()

    index_processor = MagicMock()
    factory_instance = MagicMock()
    factory_instance.init_index_processor.return_value = index_processor
    monkeypatch.setattr(vector_service_module, "IndexProcessorFactory", MagicMock(return_value=factory_instance))

    with caplog.at_level(logging.WARNING, logger="services.vector_service"):
        VectorService.create_segments_vector(
            None,
            [segment],
            dataset,
            vector_service_module.IndexStructureType.PARENT_CHILD_INDEX,
            session=sqlite_session,
        )
        assert any(r.levelno >= logging.WARNING for r in caplog.records)
    index_processor.load.assert_not_called()


def test_create_segments_vector_parent_child_missing_processing_rule_raises(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    dataset = _make_dataset(doc_form=vector_service_module.IndexStructureType.PARENT_CHILD_INDEX)
    segment = _make_segment()

    _persist_parent_child_rows(sqlite_session, segment=segment, include_rule=False)

    with pytest.raises(ValueError, match="No processing rule found"):
        VectorService.create_segments_vector(
            None,
            [segment],
            dataset,
            vector_service_module.IndexStructureType.PARENT_CHILD_INDEX,
            session=sqlite_session,
        )


def test_create_segments_vector_parent_child_non_high_quality_raises(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    dataset = _make_dataset(
        doc_form=vector_service_module.IndexStructureType.PARENT_CHILD_INDEX,
        indexing_technique=IndexTechniqueType.ECONOMY,
    )
    segment = _make_segment()
    _persist_parent_child_rows(sqlite_session, segment=segment)

    with pytest.raises(ValueError, match="not high quality"):
        VectorService.create_segments_vector(
            None,
            [segment],
            dataset,
            vector_service_module.IndexStructureType.PARENT_CHILD_INDEX,
            session=sqlite_session,
        )


def test_update_segment_vector_high_quality_uses_vector(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    dataset = _make_dataset(indexing_technique=IndexTechniqueType.HIGH_QUALITY)
    segment = _make_segment()

    vector_instance = MagicMock()
    vector_cls = MagicMock(return_value=vector_instance)
    monkeypatch.setattr(vector_service_module, "Vector", vector_cls)

    VectorService.update_segment_vector(["k"], segment, dataset, session=sqlite_session)

    vector_cls.assert_called_once_with(dataset=dataset, session=sqlite_session)
    vector_instance.delete_by_ids.assert_called_once_with([segment.index_node_id])
    vector_instance.add_texts.assert_called_once()
    add_args, add_kwargs = vector_instance.add_texts.call_args
    assert len(add_args[0]) == 1
    assert add_kwargs["duplicate_check"] is True


def test_update_segment_vector_economy_uses_keyword_with_keywords_list(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    dataset = _make_dataset(indexing_technique=IndexTechniqueType.ECONOMY)
    segment = _make_segment()

    keyword_instance = MagicMock()
    monkeypatch.setattr(vector_service_module, "Keyword", MagicMock(return_value=keyword_instance))

    VectorService.update_segment_vector(["a", "b"], segment, dataset, session=sqlite_session)

    keyword_instance.delete_by_ids.assert_called_once_with([segment.index_node_id], sqlite_session)
    keyword_instance.add_texts.assert_called_once()
    args, kwargs = keyword_instance.add_texts.call_args
    assert len(args[0]) == 1
    assert args[1] is sqlite_session
    assert kwargs["keywords_list"] == [["a", "b"]]


def test_update_segment_vector_economy_uses_keyword_without_keywords_list(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    dataset = _make_dataset(indexing_technique=IndexTechniqueType.ECONOMY)
    segment = _make_segment()

    keyword_instance = MagicMock()
    monkeypatch.setattr(vector_service_module, "Keyword", MagicMock(return_value=keyword_instance))

    VectorService.update_segment_vector(None, segment, dataset, session=sqlite_session)
    keyword_instance.add_texts.assert_called_once()
    args, kwargs = keyword_instance.add_texts.call_args
    assert len(args[0]) == 1
    assert args[1] is sqlite_session
    assert "keywords_list" not in kwargs


def test_generate_child_chunks_regenerate_cleans_then_saves_children(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    dataset = _make_dataset(doc_form=IndexStructureType.PARAGRAPH_INDEX, tenant_id="tenant-1", dataset_id="dataset-1")
    segment = _make_segment(segment_id="seg-1")

    dataset_document = DatasetDocument(
        id=segment.document_id,
        tenant_id=segment.tenant_id,
        dataset_id=segment.dataset_id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch-1",
        name="Document",
        created_from=DocumentCreatedFrom.API,
        created_by="user-1",
        doc_language="en",
    )
    processing_rule = DatasetProcessRule(
        dataset_id=segment.dataset_id,
        mode=ProcessRuleMode.HIERARCHICAL,
        rules="{}",
        created_by="user-1",
    )

    child1 = _ChildDocStub(page_content="c1", metadata={"doc_id": "c1-id", "doc_hash": "c1-h"})
    child2 = _ChildDocStub(page_content="c2", metadata={"doc_id": "c2-id", "doc_hash": "c2-h"})
    transformed = [_ParentDocStub(children=[child1, child2])]

    index_processor = MagicMock()
    index_processor.transform.return_value = transformed
    factory_instance = MagicMock()
    factory_instance.init_index_processor.return_value = index_processor
    monkeypatch.setattr(vector_service_module, "IndexProcessorFactory", MagicMock(return_value=factory_instance))

    VectorService.generate_child_chunks(
        segment=segment,
        dataset_document=dataset_document,
        dataset=dataset,
        embedding_model_instance=MagicMock(),
        processing_rule=processing_rule,
        regenerate=True,
        session=sqlite_session,
    )

    index_processor.clean.assert_called_once()
    _, transform_kwargs = index_processor.transform.call_args
    assert transform_kwargs["process_rule"]["rules"]["parent_mode"] == vector_service_module.ParentMode.FULL_DOC
    index_processor.load.assert_called_once()
    stored = sqlite_session.query(ChildChunk).order_by(ChildChunk.position).all()
    assert [chunk.content for chunk in stored] == ["c1", "c2"]


def test_generate_child_chunks_flushes_even_when_no_children(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    dataset = _make_dataset(doc_form=IndexStructureType.PARAGRAPH_INDEX)
    segment = _make_segment()
    dataset_document = DatasetDocument(
        id=segment.document_id,
        tenant_id=segment.tenant_id,
        dataset_id=segment.dataset_id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch-1",
        name="Document",
        created_from=DocumentCreatedFrom.API,
        created_by="user-1",
        doc_language="en",
    )
    processing_rule = DatasetProcessRule(
        dataset_id=segment.dataset_id,
        mode=ProcessRuleMode.HIERARCHICAL,
        rules="{}",
        created_by="user-1",
    )

    index_processor = MagicMock()
    index_processor.transform.return_value = [_ParentDocStub(children=[])]
    factory_instance = MagicMock()
    factory_instance.init_index_processor.return_value = index_processor
    monkeypatch.setattr(vector_service_module, "IndexProcessorFactory", MagicMock(return_value=factory_instance))

    VectorService.generate_child_chunks(
        segment=segment,
        dataset_document=dataset_document,
        dataset=dataset,
        embedding_model_instance=MagicMock(),
        processing_rule=processing_rule,
        regenerate=False,
        session=sqlite_session,
    )

    index_processor.load.assert_not_called()
    assert sqlite_session.query(ChildChunk).count() == 0


def test_create_child_chunk_vector_high_quality_adds_texts(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    dataset = _make_dataset(indexing_technique=IndexTechniqueType.HIGH_QUALITY)
    child_chunk = _make_child_chunk(index_node_id="id", index_node_hash="h")

    vector_instance = MagicMock()
    vector_cls = MagicMock(return_value=vector_instance)
    monkeypatch.setattr(vector_service_module, "Vector", vector_cls)

    VectorService.create_child_chunk_vector(child_chunk, dataset, session=sqlite_session)
    vector_cls.assert_called_once_with(dataset=dataset, session=sqlite_session)
    vector_instance.add_texts.assert_called_once()


def test_create_child_chunk_vector_economy_noop(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    dataset = _make_dataset(indexing_technique=IndexTechniqueType.ECONOMY)
    vector_cls = MagicMock()
    monkeypatch.setattr(vector_service_module, "Vector", vector_cls)

    child_chunk = _make_child_chunk(index_node_id="id", index_node_hash="h")

    VectorService.create_child_chunk_vector(child_chunk, dataset, session=sqlite_session)
    vector_cls.assert_not_called()


def test_update_child_chunk_vector_high_quality_updates_vector(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    dataset = _make_dataset(indexing_technique=IndexTechniqueType.HIGH_QUALITY)

    new_chunk = _make_child_chunk(
        content="n", index_node_id="nid", index_node_hash="nh", document_id="d", dataset_id="ds"
    )
    upd_chunk = _make_child_chunk(
        content="u", index_node_id="uid", index_node_hash="uh", document_id="d", dataset_id="ds"
    )
    del_chunk = _make_child_chunk(index_node_id="did")

    vector_instance = MagicMock()
    vector_cls = MagicMock(return_value=vector_instance)
    monkeypatch.setattr(vector_service_module, "Vector", vector_cls)

    VectorService.update_child_chunk_vector([new_chunk], [upd_chunk], [del_chunk], dataset, session=sqlite_session)

    vector_cls.assert_called_once_with(dataset=dataset, session=sqlite_session)
    vector_instance.delete_by_ids.assert_called_once_with(["uid", "did"])
    vector_instance.add_texts.assert_called_once()
    docs = vector_instance.add_texts.call_args.args[0]
    assert len(docs) == 2


def test_update_child_chunk_vector_economy_noop(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    dataset = _make_dataset(indexing_technique=IndexTechniqueType.ECONOMY)
    vector_cls = MagicMock()
    monkeypatch.setattr(vector_service_module, "Vector", vector_cls)
    VectorService.update_child_chunk_vector([], [], [], dataset, session=sqlite_session)
    vector_cls.assert_not_called()


def test_delete_child_chunk_vector_deletes_by_id(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    dataset = _make_dataset()
    child_chunk = _make_child_chunk(index_node_id="cid")

    vector_instance = MagicMock()
    vector_cls = MagicMock(return_value=vector_instance)
    monkeypatch.setattr(vector_service_module, "Vector", vector_cls)

    VectorService.delete_child_chunk_vector(child_chunk, dataset, session=sqlite_session)
    vector_cls.assert_called_once_with(dataset=dataset, session=sqlite_session)
    vector_instance.delete_by_ids.assert_called_once_with(["cid"])


# ---------------------------------------------------------------------------
# update_multimodel_vector (missing coverage in previous suites)
# ---------------------------------------------------------------------------


def test_update_multimodel_vector_returns_when_not_high_quality(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    dataset = _make_dataset(indexing_technique=IndexTechniqueType.ECONOMY, is_multimodal=True)
    segment = _make_segment(tenant_id="t")

    vector_cls = MagicMock()
    monkeypatch.setattr(vector_service_module, "Vector", vector_cls)

    VectorService.update_multimodel_vector(
        session=sqlite_session, segment=segment, attachment_ids=["a"], dataset=dataset
    )
    vector_cls.assert_not_called()
    assert not sqlite_session.in_transaction()


def test_update_multimodel_vector_returns_when_no_actual_change(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    dataset = _make_dataset(indexing_technique=IndexTechniqueType.HIGH_QUALITY, is_multimodal=True)
    segment = _make_segment(tenant_id="t", session=sqlite_session, attachments=[{"id": "a"}, {"id": "b"}])

    vector_cls = MagicMock()
    monkeypatch.setattr(vector_service_module, "Vector", vector_cls)

    VectorService.update_multimodel_vector(
        session=sqlite_session, segment=segment, attachment_ids=["b", "a"], dataset=dataset
    )
    vector_cls.assert_not_called()
    assert sqlite_session.in_transaction()


def test_update_multimodel_vector_deletes_bindings_and_commits_on_empty_new_ids(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    dataset = _make_dataset(indexing_technique=IndexTechniqueType.HIGH_QUALITY, is_multimodal=True)
    segment = _make_segment(
        tenant_id="tenant-1",
        session=sqlite_session,
        attachments=[{"id": "old-1"}, {"id": "old-2"}],
    )

    vector_instance = MagicMock(name="vector_instance")
    vector_cls = MagicMock(return_value=vector_instance)

    monkeypatch.setattr(vector_service_module, "Vector", vector_cls)

    VectorService.update_multimodel_vector(segment=segment, attachment_ids=[], dataset=dataset, session=sqlite_session)

    vector_cls.assert_called_once_with(dataset=dataset, session=sqlite_session)
    vector_instance.delete_by_ids.assert_called_once_with(["old-1", "old-2"])
    assert sqlite_session.query(SegmentAttachmentBinding).count() == 0
    vector_instance.add_texts.assert_not_called()


def test_update_multimodel_vector_flushes_when_no_upload_files_found(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    dataset = _make_dataset(indexing_technique=IndexTechniqueType.HIGH_QUALITY, is_multimodal=True)
    segment = _make_segment(tenant_id="tenant-1", session=sqlite_session, attachments=[{"id": "old-1"}])

    vector_instance = MagicMock()
    monkeypatch.setattr(vector_service_module, "Vector", MagicMock(return_value=vector_instance))
    VectorService.update_multimodel_vector(
        session=sqlite_session, segment=segment, attachment_ids=["new-1"], dataset=dataset
    )

    assert sqlite_session.query(SegmentAttachmentBinding).count() == 0
    vector_instance.add_texts.assert_not_called()


def test_update_multimodel_vector_adds_bindings_and_vectors_and_skips_missing_upload_files(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    sqlite_session: Session,
) -> None:
    dataset = _make_dataset(indexing_technique=IndexTechniqueType.HIGH_QUALITY, is_multimodal=True)
    segment = _make_segment(
        segment_id="seg-1",
        tenant_id="tenant-1",
        session=sqlite_session,
        attachments=[{"id": "old-1"}],
    )

    vector_instance = MagicMock()
    monkeypatch.setattr(vector_service_module, "Vector", MagicMock(return_value=vector_instance))
    sqlite_session.add(_upload_file())
    sqlite_session.flush()

    with caplog.at_level(logging.WARNING, logger="services.vector_service"):
        VectorService.update_multimodel_vector(
            session=sqlite_session, segment=segment, attachment_ids=["file-1", "missing"], dataset=dataset
        )
        assert any(r.levelno >= logging.WARNING for r in caplog.records)
    bindings = sqlite_session.query(SegmentAttachmentBinding).all()
    assert len(bindings) == 1
    assert bindings[0].attachment_id == "file-1"

    vector_instance.create_multimodal.assert_called_once()
    documents = vector_instance.create_multimodal.call_args.args[0]
    assert len(documents) == 1
    assert documents[0].page_content == "img.png"
    assert documents[0].metadata["doc_id"] == "file-1"


def test_update_multimodel_vector_updates_bindings_without_multimodal_vector_ops(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
) -> None:
    dataset = _make_dataset(indexing_technique=IndexTechniqueType.HIGH_QUALITY, is_multimodal=False)
    segment = _make_segment(tenant_id="tenant-1", session=sqlite_session, attachments=[{"id": "old-1"}])

    vector_instance = MagicMock()
    monkeypatch.setattr(vector_service_module, "Vector", MagicMock(return_value=vector_instance))
    sqlite_session.add(_upload_file())
    sqlite_session.flush()

    VectorService.update_multimodel_vector(
        session=sqlite_session, segment=segment, attachment_ids=["file-1"], dataset=dataset
    )

    vector_instance.delete_by_ids.assert_not_called()
    vector_instance.add_texts.assert_not_called()
    binding = sqlite_session.query(SegmentAttachmentBinding).one()
    assert binding.attachment_id == "file-1"


def test_update_multimodel_vector_rolls_back_and_reraises_on_error(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    sqlite_session: Session,
) -> None:
    dataset = _make_dataset(indexing_technique=IndexTechniqueType.HIGH_QUALITY, is_multimodal=True)
    segment = _make_segment(
        segment_id="seg-1",
        tenant_id="tenant-1",
        session=sqlite_session,
        attachments=[{"id": "old-1"}],
    )

    vector_instance = MagicMock()
    monkeypatch.setattr(vector_service_module, "Vector", MagicMock(return_value=vector_instance))
    sqlite_session.add(_upload_file())
    sqlite_session.flush()
    rollback_events: list[str] = []
    event.listen(sqlite_session, "after_rollback", lambda _session: rollback_events.append("rollback"))
    monkeypatch.setattr(sqlite_session, "flush", MagicMock(side_effect=RuntimeError("boom")))

    with caplog.at_level(logging.ERROR, logger="services.vector_service"):
        with sqlite_session.no_autoflush:
            with pytest.raises(RuntimeError, match="boom"):
                VectorService.update_multimodel_vector(
                    session=sqlite_session, segment=segment, attachment_ids=["file-1"], dataset=dataset
                )

        assert any(r.levelno >= logging.ERROR for r in caplog.records)
    assert rollback_events == ["rollback"]
