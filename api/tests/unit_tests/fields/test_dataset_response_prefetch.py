import json
from datetime import datetime

import pytest
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session

from core.rag.index_processor.constant.index_type import IndexStructureType
from fields.dataset_fields import DatasetDetailResponse, dataset_detail_response_source
from fields.dataset_response_prefetch import DatasetResponsePrefetch
from models.account import Account
from models.dataset import (
    AppDatasetJoin,
    Dataset,
    DatasetMetadata,
    Document,
    ExternalKnowledgeApis,
    ExternalKnowledgeBindings,
    Pipeline,
)
from models.enums import DatasetMetadataType, DataSourceType, DocumentCreatedFrom, IndexingStatus, TagType
from models.model import App, AppMode, IconType, Tag, TagBinding


def _dataset(dataset_id: str) -> Dataset:
    return Dataset(
        id=dataset_id,
        tenant_id="tenant-1",
        name=dataset_id,
        description="",
        provider="vendor",
        permission="only_me",
        data_source_type=None,
        indexing_technique="economy",
        created_by=f"account-{dataset_id}",
        created_at=datetime(2026, 1, 1),
        updated_at=datetime(2026, 1, 1),
        embedding_model=None,
        embedding_model_provider=None,
        retrieval_model=None,
        summary_index_setting=None,
        built_in_field_enabled=False,
        icon_info=None,
        runtime_mode="general",
        enable_api=False,
        is_multimodal=False,
    )


@pytest.mark.parametrize("dataset_count", [1, 20])
def test_load_batches_dataset_response_queries(
    sqlite_session: Session, sqlite_engine: Engine, dataset_count: int
) -> None:
    datasets = [_dataset(f"dataset-{index}") for index in range(dataset_count)]
    select_count = 0

    def count_selects(_conn, _cursor, statement: str, _parameters, _context, _executemany) -> None:
        nonlocal select_count
        if statement.lstrip().upper().startswith("SELECT"):
            select_count += 1

    event.listen(sqlite_engine, "before_cursor_execute", count_selects)
    try:
        prefetch = DatasetResponsePrefetch.load(datasets, session=sqlite_session)
        responses = [
            DatasetDetailResponse.model_validate(
                dataset_detail_response_source(dataset, session=sqlite_session, prefetch=prefetch),
                from_attributes=True,
            )
            for dataset in datasets
        ]
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", count_selects)

    assert len(responses) == dataset_count
    assert set(prefetch.document_counts) == {dataset.id for dataset in datasets}
    assert select_count <= 8


def test_load_batches_optional_dataset_response_queries(sqlite_session: Session, sqlite_engine: Engine) -> None:
    dataset = _dataset("dataset-external")
    dataset.provider = "external"
    dataset.pipeline_id = "pipeline-1"
    api = ExternalKnowledgeApis(
        name="External API",
        description="",
        tenant_id=dataset.tenant_id,
        settings=json.dumps({"endpoint": "https://example.test"}),
        created_by="account-1",
        updated_by=None,
    )
    api.id = "external-api-1"
    binding = ExternalKnowledgeBindings(
        tenant_id=dataset.tenant_id,
        external_knowledge_api_id=api.id,
        dataset_id=dataset.id,
        external_knowledge_id="knowledge-1",
        created_by="account-1",
    )
    pipeline = Pipeline(tenant_id=dataset.tenant_id, name="Pipeline", description="", is_published=True)
    pipeline.id = dataset.pipeline_id
    sqlite_session.add_all([dataset, api, binding, pipeline])
    sqlite_session.flush()

    select_count = 0

    def count_selects(_conn, _cursor, statement: str, _parameters, _context, _executemany) -> None:
        nonlocal select_count
        if statement.lstrip().upper().startswith("SELECT"):
            select_count += 1

    event.listen(sqlite_engine, "before_cursor_execute", count_selects)
    try:
        prefetch = DatasetResponsePrefetch.load([dataset], session=sqlite_session)
        response = DatasetDetailResponse.model_validate(
            dataset_detail_response_source(dataset, session=sqlite_session, prefetch=prefetch),
            from_attributes=True,
        )
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", count_selects)

    assert response.external_knowledge_info.external_knowledge_id == binding.external_knowledge_id
    assert response.external_knowledge_info.model_dump(mode="json") == dataset.get_external_knowledge_info(
        session=sqlite_session
    )
    assert response.is_published is True
    assert select_count == 11


def test_prefetch_matches_dataset_getters_for_vendor_dataset(sqlite_session: Session) -> None:
    now = datetime(2026, 1, 1)
    account = Account(name="Ada", email="ada@example.com")
    account.id = "account-1"
    dataset = _dataset("dataset-1")
    dataset.created_by = account.id
    dataset.built_in_field_enabled = True
    app = App(
        id="app-1",
        tenant_id=dataset.tenant_id,
        name="App",
        description="",
        mode=AppMode.CHAT,
        icon_type=IconType.EMOJI,
        icon="📙",
        icon_background="#ffffff",
        enable_site=False,
        enable_api=False,
        max_active_requests=0,
        created_by=account.id,
    )
    app_dataset_join = AppDatasetJoin(app_id=app.id, dataset_id=dataset.id)
    tag = Tag(tenant_id=dataset.tenant_id, type=TagType.KNOWLEDGE, name="Tag", created_by=account.id)
    tag.id = "tag-1"
    tag_binding = TagBinding(
        tenant_id=dataset.tenant_id,
        tag_id=tag.id,
        target_id=dataset.id,
        created_by=account.id,
    )
    metadata = DatasetMetadata(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        type=DatasetMetadataType.STRING,
        name="author",
        created_by=account.id,
    )
    metadata.id = "metadata-1"
    document = Document(
        id="document-1",
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch-1",
        name="document.txt",
        created_from=DocumentCreatedFrom.WEB,
        created_by=account.id,
        created_at=now,
        updated_at=now,
        word_count=12,
        indexing_status=IndexingStatus.COMPLETED,
        enabled=True,
        archived=False,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    pipeline = Pipeline(tenant_id=dataset.tenant_id, name="Pipeline", description="", is_published=True)
    pipeline.id = "pipeline-1"
    dataset.pipeline_id = pipeline.id
    sqlite_session.add_all([account, dataset, app, app_dataset_join, tag, tag_binding, metadata, document, pipeline])
    sqlite_session.commit()

    prefetch = DatasetResponsePrefetch.load([dataset], session=sqlite_session)
    dataset_id = dataset.id

    assert prefetch.app_counts[dataset_id] == dataset.get_app_count(session=sqlite_session)
    assert prefetch.document_counts[dataset_id] == dataset.get_document_count(session=sqlite_session)
    assert prefetch.word_counts[dataset_id] == dataset.get_word_count(session=sqlite_session)
    assert prefetch.author_names[dataset_id] == dataset.get_author_name(session=sqlite_session)
    assert list(prefetch.tags[dataset_id]) == list(dataset.get_tags(session=sqlite_session))
    assert prefetch.doc_forms[dataset_id] == dataset.get_doc_form(session=sqlite_session)
    assert prefetch.external_knowledge_infos[dataset_id] == dataset.get_external_knowledge_info(session=sqlite_session)
    assert prefetch.doc_metadatas[dataset_id] == dataset.get_doc_metadata(session=sqlite_session)
    assert prefetch.published_statuses[dataset_id] == dataset.get_is_published(session=sqlite_session)
    assert prefetch.available_document_counts[dataset_id] == dataset.get_total_available_documents(
        session=sqlite_session
    )


def test_prefetch_keeps_tag_and_external_data_in_their_tenant(sqlite_session: Session) -> None:
    dataset = _dataset("dataset-1")
    dataset.provider = "external"
    other_tenant_tag = Tag(tenant_id="tenant-2", type=TagType.KNOWLEDGE, name="Other", created_by="account-2")
    other_tenant_tag.id = "tag-2"
    other_tenant_binding = TagBinding(
        tenant_id="tenant-2",
        tag_id=other_tenant_tag.id,
        target_id=dataset.id,
        created_by="account-2",
    )
    other_tenant_api = ExternalKnowledgeApis(
        name="Other API",
        description="",
        tenant_id="tenant-2",
        settings=json.dumps({"endpoint": "https://other.example"}),
        created_by="account-2",
        updated_by=None,
    )
    other_tenant_api.id = "external-api-2"
    other_tenant_binding = ExternalKnowledgeBindings(
        tenant_id="tenant-2",
        external_knowledge_api_id=other_tenant_api.id,
        dataset_id=dataset.id,
        external_knowledge_id="other-knowledge",
        created_by="account-2",
    )
    sqlite_session.add_all([dataset, other_tenant_tag, other_tenant_binding, other_tenant_api])
    sqlite_session.commit()

    prefetch = DatasetResponsePrefetch.load([dataset], session=sqlite_session)

    assert prefetch.tags[dataset.id] == []
    assert prefetch.external_knowledge_infos[dataset.id] is None
