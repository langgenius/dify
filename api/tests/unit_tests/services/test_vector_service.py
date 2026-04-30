"""Unit tests for `api/services/vector_service.py`."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from unittest.mock import MagicMock

import pytest

import services.vector_service as vector_service_module
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from services.vector_service import VectorService


@dataclass(frozen=True)
class _UploadFileStub:
    id: str
    name: str


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
) -> MagicMock:
    dataset = MagicMock(name="dataset")
    dataset.id = dataset_id
    dataset.tenant_id = tenant_id
    dataset.doc_form = doc_form
    dataset.indexing_technique = indexing_technique
    dataset.is_multimodal = is_multimodal
    dataset.embedding_model_provider = embedding_model_provider
    dataset.embedding_model = embedding_model
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
    attachments: list[dict[str, str]] | None = None,
) -> MagicMock:
    segment = MagicMock(name="segment")
    segment.id = segment_id
    segment.tenant_id = tenant_id
    segment.dataset_id = dataset_id
    segment.document_id = document_id
    segment.content = content
    segment.index_node_id = index_node_id
    segment.index_node_hash = index_node_hash
    segment.attachments = attachments or []
    return segment


def _mock_db_session_for_update_multimodel(*, upload_files: list[_UploadFileStub] | None) -> MagicMock:
    session = MagicMock(name="session")

    # db.session.execute() is used for delete(SegmentAttachmentBinding).where(...)
    session.execute = MagicMock(name="execute")

    # db.session.scalars(select(UploadFile).where(...)).all() returns upload files
    session.scalars.return_value.all.return_value = upload_files or []

    db_mock = MagicMock(name="db")
    db_mock.session = session
    return db_mock


def test_create_segments_vector_regular_indexing_loads_documents_and_keywords(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _make_dataset(is_multimodal=False)
    segment = _make_segment()

    index_processor = MagicMock(name="index_processor")
    factory_instance = MagicMock(name="IndexProcessorFactory-instance")
    factory_instance.init_index_processor.return_value = index_processor
    monkeypatch.setattr(vector_service_module, "IndexProcessorFactory", MagicMock(return_value=factory_instance))

    VectorService.create_segments_vector([["k1"]], [segment], dataset, IndexStructureType.PARAGRAPH_INDEX)

    index_processor.load.assert_called_once()
    args, kwargs = index_processor.load.call_args
    assert args[0] == dataset
    assert len(args[1]) == 1
    assert args[2] is None
    assert kwargs["with_keywords"] is True
    assert kwargs["keywords_list"] == [["k1"]]


def test_create_segments_vector_regular_indexing_loads_multimodal_documents(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _make_dataset(is_multimodal=True)
    segment = _make_segment(
        attachments=[
            {"id": "img-1", "name": "a.png"},
            {"id": "img-2", "name": "b.png"},
        ]
    )

    index_processor = MagicMock(name="index_processor")
    factory_instance = MagicMock(name="IndexProcessorFactory-instance")
    factory_instance.init_index_processor.return_value = index_processor
    monkeypatch.setattr(vector_service_module, "IndexProcessorFactory", MagicMock(return_value=factory_instance))

    VectorService.create_segments_vector([["k1"]], [segment], dataset, IndexStructureType.PARAGRAPH_INDEX)

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


def test_create_segments_vector_with_no_segments_does_not_load(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _make_dataset()
    index_processor = MagicMock(name="index_processor")
    factory_instance = MagicMock()
    factory_instance.init_index_processor.return_value = index_processor
    monkeypatch.setattr(vector_service_module, "IndexProcessorFactory", MagicMock(return_value=factory_instance))

    VectorService.create_segments_vector(None, [], dataset, IndexStructureType.PARAGRAPH_INDEX)
    index_processor.load.assert_not_called()


def _mock_parent_child_queries(
    *,
    dataset_document: object | None,
    processing_rule: object | None,
) -> MagicMock:
    session = MagicMock(name="session")

    get_dispatch: dict[object, object | None] = {
        vector_service_module.DatasetDocument: dataset_document,
        vector_service_module.DatasetProcessRule: processing_rule,
    }

    def get_side_effect(model: object, pk: object) -> object | None:
        return get_dispatch.get(model)

    session.get.side_effect = get_side_effect
    db_mock = MagicMock(name="db")
    db_mock.session = session
    return db_mock


def test_create_segments_vector_parent_child_calls_generate_child_chunks_with_explicit_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset = _make_dataset(
        doc_form=vector_service_module.IndexStructureType.PARENT_CHILD_INDEX,
        embedding_model_provider="openai",
        indexing_technique=IndexTechniqueType.HIGH_QUALITY,
    )
    segment = _make_segment()

    dataset_document = MagicMock(name="dataset_document")
    dataset_document.id = segment.document_id
    dataset_document.dataset_process_rule_id = "rule-1"
    dataset_document.doc_language = "en"
    dataset_document.created_by = "user-1"

    processing_rule = MagicMock(name="processing_rule")
    processing_rule.to_dict.return_value = {"rules": {}}

    monkeypatch.setattr(
        vector_service_module,
        "db",
        _mock_parent_child_queries(dataset_document=dataset_document, processing_rule=processing_rule),
    )

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
        None, [segment], dataset, vector_service_module.IndexStructureType.PARENT_CHILD_INDEX
    )

    model_manager_instance.get_model_instance.assert_called_once()
    generate_child_chunks_mock.assert_called_once_with(
        segment, dataset_document, dataset, embedding_model_instance, processing_rule, False
    )
    index_processor.load.assert_not_called()


def test_create_segments_vector_parent_child_uses_default_embedding_model_when_provider_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset = _make_dataset(
        doc_form=vector_service_module.IndexStructureType.PARENT_CHILD_INDEX,
        embedding_model_provider=None,
        indexing_technique=IndexTechniqueType.HIGH_QUALITY,
    )
    segment = _make_segment()

    dataset_document = MagicMock()
    dataset_document.dataset_process_rule_id = "rule-1"
    dataset_document.doc_language = "en"
    dataset_document.created_by = "user-1"

    processing_rule = MagicMock()
    processing_rule.to_dict.return_value = {"rules": {}}

    monkeypatch.setattr(
        vector_service_module,
        "db",
        _mock_parent_child_queries(dataset_document=dataset_document, processing_rule=processing_rule),
    )

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
        None, [segment], dataset, vector_service_module.IndexStructureType.PARENT_CHILD_INDEX
    )

    model_manager_instance.get_default_model_instance.assert_called_once()
    generate_child_chunks_mock.assert_called_once()


def test_create_segments_vector_parent_child_missing_document_logs_warning_and_continues(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset = _make_dataset(doc_form=vector_service_module.IndexStructureType.PARENT_CHILD_INDEX)
    segment = _make_segment()

    processing_rule = MagicMock()
    monkeypatch.setattr(
        vector_service_module,
        "db",
        _mock_parent_child_queries(dataset_document=None, processing_rule=processing_rule),
    )

    logger_mock = MagicMock()
    monkeypatch.setattr(vector_service_module, "logger", logger_mock)

    index_processor = MagicMock()
    factory_instance = MagicMock()
    factory_instance.init_index_processor.return_value = index_processor
    monkeypatch.setattr(vector_service_module, "IndexProcessorFactory", MagicMock(return_value=factory_instance))

    VectorService.create_segments_vector(
        None, [segment], dataset, vector_service_module.IndexStructureType.PARENT_CHILD_INDEX
    )
    logger_mock.warning.assert_called_once()
    index_processor.load.assert_not_called()


def test_create_segments_vector_parent_child_missing_processing_rule_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _make_dataset(doc_form=vector_service_module.IndexStructureType.PARENT_CHILD_INDEX)
    segment = _make_segment()

    dataset_document = MagicMock()
    dataset_document.dataset_process_rule_id = "rule-1"
    monkeypatch.setattr(
        vector_service_module,
        "db",
        _mock_parent_child_queries(dataset_document=dataset_document, processing_rule=None),
    )

    with pytest.raises(ValueError, match="No processing rule found"):
        VectorService.create_segments_vector(
            None, [segment], dataset, vector_service_module.IndexStructureType.PARENT_CHILD_INDEX
        )


def test_create_segments_vector_parent_child_non_high_quality_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _make_dataset(
        doc_form=vector_service_module.IndexStructureType.PARENT_CHILD_INDEX,
        indexing_technique=IndexTechniqueType.ECONOMY,
    )
    segment = _make_segment()
    dataset_document = MagicMock()
    dataset_document.dataset_process_rule_id = "rule-1"
    processing_rule = MagicMock()
    monkeypatch.setattr(
        vector_service_module,
        "db",
        _mock_parent_child_queries(dataset_document=dataset_document, processing_rule=processing_rule),
    )

    with pytest.raises(ValueError, match="not high quality"):
        VectorService.create_segments_vector(
            None, [segment], dataset, vector_service_module.IndexStructureType.PARENT_CHILD_INDEX
        )


def test_update_segment_vector_high_quality_uses_vector(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _make_dataset(indexing_technique=IndexTechniqueType.HIGH_QUALITY)
    segment = _make_segment()

    vector_instance = MagicMock()
    monkeypatch.setattr(vector_service_module, "Vector", MagicMock(return_value=vector_instance))

    VectorService.update_segment_vector(["k"], segment, dataset)

    vector_instance.delete_by_ids.assert_called_once_with([segment.index_node_id])
    vector_instance.add_texts.assert_called_once()
    add_args, add_kwargs = vector_instance.add_texts.call_args
    assert len(add_args[0]) == 1
    assert add_kwargs["duplicate_check"] is True


def test_update_segment_vector_economy_uses_keyword_with_keywords_list(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _make_dataset(indexing_technique=IndexTechniqueType.ECONOMY)
    segment = _make_segment()

    keyword_instance = MagicMock()
    monkeypatch.setattr(vector_service_module, "Keyword", MagicMock(return_value=keyword_instance))

    VectorService.update_segment_vector(["a", "b"], segment, dataset)

    keyword_instance.delete_by_ids.assert_called_once_with([segment.index_node_id])
    keyword_instance.add_texts.assert_called_once()
    args, kwargs = keyword_instance.add_texts.call_args
    assert len(args[0]) == 1
    assert kwargs["keywords_list"] == [["a", "b"]]


def test_update_segment_vector_economy_uses_keyword_without_keywords_list(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _make_dataset(indexing_technique=IndexTechniqueType.ECONOMY)
    segment = _make_segment()

    keyword_instance = MagicMock()
    monkeypatch.setattr(vector_service_module, "Keyword", MagicMock(return_value=keyword_instance))

    VectorService.update_segment_vector(None, segment, dataset)
    keyword_instance.add_texts.assert_called_once()
    _, kwargs = keyword_instance.add_texts.call_args
    assert "keywords_list" not in kwargs


def test_generate_child_chunks_regenerate_cleans_then_saves_children(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _make_dataset(doc_form=IndexStructureType.PARAGRAPH_INDEX, tenant_id="tenant-1", dataset_id="dataset-1")
    segment = _make_segment(segment_id="seg-1")

    dataset_document = MagicMock()
    dataset_document.id = segment.document_id
    dataset_document.doc_language = "en"
    dataset_document.created_by = "user-1"

    processing_rule = MagicMock()
    processing_rule.to_dict.return_value = {"rules": {}}

    child1 = _ChildDocStub(page_content="c1", metadata={"doc_id": "c1-id", "doc_hash": "c1-h"})
    child2 = _ChildDocStub(page_content="c2", metadata={"doc_id": "c2-id", "doc_hash": "c2-h"})
    transformed = [_ParentDocStub(children=[child1, child2])]

    index_processor = MagicMock()
    index_processor.transform.return_value = transformed
    factory_instance = MagicMock()
    factory_instance.init_index_processor.return_value = index_processor
    monkeypatch.setattr(vector_service_module, "IndexProcessorFactory", MagicMock(return_value=factory_instance))

    child_chunk_ctor = MagicMock(side_effect=lambda **kwargs: kwargs)
    monkeypatch.setattr(vector_service_module, "ChildChunk", child_chunk_ctor)

    db_mock = MagicMock()
    db_mock.session.add = MagicMock()
    db_mock.session.commit = MagicMock()
    monkeypatch.setattr(vector_service_module, "db", db_mock)

    VectorService.generate_child_chunks(
        segment=segment,
        dataset_document=dataset_document,
        dataset=dataset,
        embedding_model_instance=MagicMock(),
        processing_rule=processing_rule,
        regenerate=True,
    )

    index_processor.clean.assert_called_once()
    _, transform_kwargs = index_processor.transform.call_args
    assert transform_kwargs["process_rule"]["rules"]["parent_mode"] == vector_service_module.ParentMode.FULL_DOC
    index_processor.load.assert_called_once()
    assert db_mock.session.add.call_count == 2
    db_mock.session.commit.assert_called_once()


def test_generate_child_chunks_commits_even_when_no_children(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _make_dataset(doc_form=IndexStructureType.PARAGRAPH_INDEX)
    segment = _make_segment()
    dataset_document = MagicMock()
    dataset_document.doc_language = "en"
    dataset_document.created_by = "user-1"

    processing_rule = MagicMock()
    processing_rule.to_dict.return_value = {"rules": {}}

    index_processor = MagicMock()
    index_processor.transform.return_value = [_ParentDocStub(children=[])]
    factory_instance = MagicMock()
    factory_instance.init_index_processor.return_value = index_processor
    monkeypatch.setattr(vector_service_module, "IndexProcessorFactory", MagicMock(return_value=factory_instance))

    db_mock = MagicMock()
    monkeypatch.setattr(vector_service_module, "db", db_mock)

    VectorService.generate_child_chunks(
        segment=segment,
        dataset_document=dataset_document,
        dataset=dataset,
        embedding_model_instance=MagicMock(),
        processing_rule=processing_rule,
        regenerate=False,
    )

    index_processor.load.assert_not_called()
    db_mock.session.add.assert_not_called()
    db_mock.session.commit.assert_called_once()


def test_create_child_chunk_vector_high_quality_adds_texts(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _make_dataset(indexing_technique=IndexTechniqueType.HIGH_QUALITY)
    child_chunk = MagicMock()
    child_chunk.content = "child"
    child_chunk.index_node_id = "id"
    child_chunk.index_node_hash = "h"
    child_chunk.document_id = "doc-1"
    child_chunk.dataset_id = "dataset-1"

    vector_instance = MagicMock()
    monkeypatch.setattr(vector_service_module, "Vector", MagicMock(return_value=vector_instance))

    VectorService.create_child_chunk_vector(child_chunk, dataset)
    vector_instance.add_texts.assert_called_once()


def test_create_child_chunk_vector_economy_noop(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _make_dataset(indexing_technique=IndexTechniqueType.ECONOMY)
    vector_cls = MagicMock()
    monkeypatch.setattr(vector_service_module, "Vector", vector_cls)

    child_chunk = MagicMock()
    child_chunk.content = "child"
    child_chunk.index_node_id = "id"
    child_chunk.index_node_hash = "h"
    child_chunk.document_id = "doc-1"
    child_chunk.dataset_id = "dataset-1"

    VectorService.create_child_chunk_vector(child_chunk, dataset)
    vector_cls.assert_not_called()


def test_update_child_chunk_vector_high_quality_updates_vector(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _make_dataset(indexing_technique=IndexTechniqueType.HIGH_QUALITY)

    new_chunk = MagicMock()
    new_chunk.content = "n"
    new_chunk.index_node_id = "nid"
    new_chunk.index_node_hash = "nh"
    new_chunk.document_id = "d"
    new_chunk.dataset_id = "ds"

    upd_chunk = MagicMock()
    upd_chunk.content = "u"
    upd_chunk.index_node_id = "uid"
    upd_chunk.index_node_hash = "uh"
    upd_chunk.document_id = "d"
    upd_chunk.dataset_id = "ds"

    del_chunk = MagicMock()
    del_chunk.index_node_id = "did"

    vector_instance = MagicMock()
    monkeypatch.setattr(vector_service_module, "Vector", MagicMock(return_value=vector_instance))

    VectorService.update_child_chunk_vector([new_chunk], [upd_chunk], [del_chunk], dataset)

    vector_instance.delete_by_ids.assert_called_once_with(["uid", "did"])
    vector_instance.add_texts.assert_called_once()
    docs = vector_instance.add_texts.call_args.args[0]
    assert len(docs) == 2


def test_update_child_chunk_vector_economy_noop(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _make_dataset(indexing_technique=IndexTechniqueType.ECONOMY)
    vector_cls = MagicMock()
    monkeypatch.setattr(vector_service_module, "Vector", vector_cls)
    VectorService.update_child_chunk_vector([], [], [], dataset)
    vector_cls.assert_not_called()


def test_delete_child_chunk_vector_deletes_by_id(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _make_dataset()
    child_chunk = MagicMock()
    child_chunk.index_node_id = "cid"

    vector_instance = MagicMock()
    monkeypatch.setattr(vector_service_module, "Vector", MagicMock(return_value=vector_instance))

    VectorService.delete_child_chunk_vector(child_chunk, dataset)
    vector_instance.delete_by_ids.assert_called_once_with(["cid"])


# ---------------------------------------------------------------------------
# update_multimodel_vector (missing coverage in previous suites)
# ---------------------------------------------------------------------------


def test_update_multimodel_vector_returns_when_not_high_quality(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _make_dataset(indexing_technique=IndexTechniqueType.ECONOMY, is_multimodal=True)
    segment = _make_segment(tenant_id="t", attachments=[{"id": "a"}])

    vector_cls = MagicMock()
    db_mock = _mock_db_session_for_update_multimodel(upload_files=[])
    monkeypatch.setattr(vector_service_module, "Vector", vector_cls)
    monkeypatch.setattr(vector_service_module, "db", db_mock)

    VectorService.update_multimodel_vector(segment=segment, attachment_ids=["a"], dataset=dataset)
    vector_cls.assert_not_called()
    db_mock.session.query.assert_not_called()


def test_update_multimodel_vector_returns_when_no_actual_change(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _make_dataset(indexing_technique=IndexTechniqueType.HIGH_QUALITY, is_multimodal=True)
    segment = _make_segment(tenant_id="t", attachments=[{"id": "a"}, {"id": "b"}])

    vector_cls = MagicMock()
    db_mock = _mock_db_session_for_update_multimodel(upload_files=[])
    monkeypatch.setattr(vector_service_module, "Vector", vector_cls)
    monkeypatch.setattr(vector_service_module, "db", db_mock)

    VectorService.update_multimodel_vector(segment=segment, attachment_ids=["b", "a"], dataset=dataset)
    vector_cls.assert_not_called()
    db_mock.session.query.assert_not_called()


def test_update_multimodel_vector_deletes_bindings_and_commits_on_empty_new_ids(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset = _make_dataset(indexing_technique=IndexTechniqueType.HIGH_QUALITY, is_multimodal=True)
    segment = _make_segment(tenant_id="tenant-1", attachments=[{"id": "old-1"}, {"id": "old-2"}])

    vector_instance = MagicMock(name="vector_instance")
    vector_cls = MagicMock(return_value=vector_instance)
    db_mock = _mock_db_session_for_update_multimodel(upload_files=[])

    monkeypatch.setattr(vector_service_module, "Vector", vector_cls)
    monkeypatch.setattr(vector_service_module, "db", db_mock)

    VectorService.update_multimodel_vector(segment=segment, attachment_ids=[], dataset=dataset)

    vector_cls.assert_called_once_with(dataset=dataset)
    vector_instance.delete_by_ids.assert_called_once_with(["old-1", "old-2"])
    db_mock.session.execute.assert_called_once()
    db_mock.session.commit.assert_called_once()
    db_mock.session.add_all.assert_not_called()
    vector_instance.add_texts.assert_not_called()


def test_update_multimodel_vector_commits_when_no_upload_files_found(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _make_dataset(indexing_technique=IndexTechniqueType.HIGH_QUALITY, is_multimodal=True)
    segment = _make_segment(tenant_id="tenant-1", attachments=[{"id": "old-1"}])

    vector_instance = MagicMock()
    monkeypatch.setattr(vector_service_module, "Vector", MagicMock(return_value=vector_instance))
    db_mock = _mock_db_session_for_update_multimodel(upload_files=[])
    monkeypatch.setattr(vector_service_module, "db", db_mock)

    VectorService.update_multimodel_vector(segment=segment, attachment_ids=["new-1"], dataset=dataset)

    db_mock.session.commit.assert_called_once()
    db_mock.session.add_all.assert_not_called()
    vector_instance.add_texts.assert_not_called()


def test_update_multimodel_vector_adds_bindings_and_vectors_and_skips_missing_upload_files(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset = _make_dataset(indexing_technique=IndexTechniqueType.HIGH_QUALITY, is_multimodal=True)
    segment = _make_segment(segment_id="seg-1", tenant_id="tenant-1", attachments=[{"id": "old-1"}])

    vector_instance = MagicMock()
    monkeypatch.setattr(vector_service_module, "Vector", MagicMock(return_value=vector_instance))
    db_mock = _mock_db_session_for_update_multimodel(upload_files=[_UploadFileStub(id="file-1", name="img.png")])
    monkeypatch.setattr(vector_service_module, "db", db_mock)

    binding_ctor = MagicMock(side_effect=lambda **kwargs: kwargs)
    monkeypatch.setattr(vector_service_module, "SegmentAttachmentBinding", binding_ctor)
    monkeypatch.setattr(vector_service_module, "delete", MagicMock())
    monkeypatch.setattr(vector_service_module, "select", MagicMock())

    logger_mock = MagicMock()
    monkeypatch.setattr(vector_service_module, "logger", logger_mock)

    VectorService.update_multimodel_vector(segment=segment, attachment_ids=["file-1", "missing"], dataset=dataset)

    logger_mock.warning.assert_called_once()
    db_mock.session.add_all.assert_called_once()
    bindings = db_mock.session.add_all.call_args.args[0]
    assert len(bindings) == 1
    assert bindings[0]["attachment_id"] == "file-1"

    vector_instance.add_texts.assert_called_once()
    documents = vector_instance.add_texts.call_args.args[0]
    assert len(documents) == 1
    assert documents[0].page_content == "img.png"
    assert documents[0].metadata["doc_id"] == "file-1"
    db_mock.session.commit.assert_called_once()


def test_update_multimodel_vector_updates_bindings_without_multimodal_vector_ops(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset = _make_dataset(indexing_technique=IndexTechniqueType.HIGH_QUALITY, is_multimodal=False)
    segment = _make_segment(tenant_id="tenant-1", attachments=[{"id": "old-1"}])

    vector_instance = MagicMock()
    monkeypatch.setattr(vector_service_module, "Vector", MagicMock(return_value=vector_instance))
    db_mock = _mock_db_session_for_update_multimodel(upload_files=[_UploadFileStub(id="file-1", name="img.png")])
    monkeypatch.setattr(vector_service_module, "db", db_mock)
    monkeypatch.setattr(
        vector_service_module, "SegmentAttachmentBinding", MagicMock(side_effect=lambda **kwargs: kwargs)
    )
    monkeypatch.setattr(vector_service_module, "delete", MagicMock())
    monkeypatch.setattr(vector_service_module, "select", MagicMock())

    VectorService.update_multimodel_vector(segment=segment, attachment_ids=["file-1"], dataset=dataset)

    vector_instance.delete_by_ids.assert_not_called()
    vector_instance.add_texts.assert_not_called()
    db_mock.session.add_all.assert_called_once()
    db_mock.session.commit.assert_called_once()


def test_update_multimodel_vector_rolls_back_and_reraises_on_error(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _make_dataset(indexing_technique=IndexTechniqueType.HIGH_QUALITY, is_multimodal=True)
    segment = _make_segment(segment_id="seg-1", tenant_id="tenant-1", attachments=[{"id": "old-1"}])

    vector_instance = MagicMock()
    monkeypatch.setattr(vector_service_module, "Vector", MagicMock(return_value=vector_instance))
    db_mock = _mock_db_session_for_update_multimodel(upload_files=[_UploadFileStub(id="file-1", name="img.png")])
    db_mock.session.commit.side_effect = RuntimeError("boom")
    monkeypatch.setattr(vector_service_module, "db", db_mock)
    monkeypatch.setattr(
        vector_service_module, "SegmentAttachmentBinding", MagicMock(side_effect=lambda **kwargs: kwargs)
    )
    monkeypatch.setattr(vector_service_module, "delete", MagicMock())
    monkeypatch.setattr(vector_service_module, "select", MagicMock())

    logger_mock = MagicMock()
    monkeypatch.setattr(vector_service_module, "logger", logger_mock)

    with pytest.raises(RuntimeError, match="boom"):
        VectorService.update_multimodel_vector(segment=segment, attachment_ids=["file-1"], dataset=dataset)

    logger_mock.exception.assert_called_once()
    db_mock.session.rollback.assert_called_once()
