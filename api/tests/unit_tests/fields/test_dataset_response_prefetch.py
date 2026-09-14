import json
from datetime import datetime
from unittest.mock import MagicMock

import pytest
from sqlalchemy import Engine, event
from sqlalchemy.dialects import sqlite
from sqlalchemy.orm import Session

from core.rag.index_processor.constant.index_type import IndexStructureType
from fields.dataset_fields import DatasetDetailResponse, DatasetDetailResponseSource, dataset_detail_response_source
from fields.dataset_response_prefetch import (
    DatasetResponsePrefetch,
    _load_doc_forms,
    _load_external_knowledge_infos,
)
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
from models.enums import DatasetMetadataType, DataSourceType, DocumentCreatedFrom, IndexingStatus
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


@pytest.mark.parametrize("dataset_count", [1, 5, 20])
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
    assert response.is_published is True
    assert select_count == 11


def test_load_doc_forms_limits_rows_per_dataset(sqlite_session: Session) -> None:
    dataset = _dataset("dataset-1")
    now = datetime(2026, 1, 1)
    documents = [
        Document(
            id=f"document-{index:03d}",
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
            position=index,
            data_source_type=DataSourceType.UPLOAD_FILE,
            batch="batch-1",
            name=f"document-{index}.txt",
            created_from=DocumentCreatedFrom.WEB,
            created_by="account-1",
            created_at=now,
            updated_at=now,
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
        )
        for index in range(100)
    ]
    sqlite_session.add_all([dataset, *documents])
    sqlite_session.flush()

    returned_row_counts: list[int] = []
    statements = []

    class ResultProxy:
        def __init__(self, result) -> None:
            self._result = result

        def all(self):
            rows = self._result.all()
            returned_row_counts.append(len(rows))
            return rows

    class SessionProxy:
        def execute(self, statement):
            statements.append(statement)
            return ResultProxy(sqlite_session.execute(statement))

    forms = _load_doc_forms([dataset], session=SessionProxy())  # type: ignore[arg-type]

    assert forms[dataset.id] == IndexStructureType.PARAGRAPH_INDEX
    assert returned_row_counts == [1]
    assert len(statements) == 1
    compiled_statement = statements[0].compile(dialect=sqlite.dialect(), compile_kwargs={"literal_binds": True})
    query_plan = sqlite_session.connection().exec_driver_sql(f"EXPLAIN QUERY PLAN {compiled_statement}").all()
    assert all("TEMP B-TREE" not in row[-1].upper() for row in query_plan)


def test_load_doc_forms_preserves_existing_limit_one_semantics(sqlite_session: Session) -> None:
    dataset = _dataset("dataset-1")
    now = datetime(2026, 1, 1)
    first_document = Document(
        id="z-document",
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch-1",
        name="first.txt",
        created_from=DocumentCreatedFrom.WEB,
        created_by="account-1",
        created_at=now,
        updated_at=now,
        doc_form=IndexStructureType.QA_INDEX,
    )
    second_document = Document(
        id="a-document",
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        position=2,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch-1",
        name="second.txt",
        created_from=DocumentCreatedFrom.WEB,
        created_by="account-1",
        created_at=now,
        updated_at=now,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    sqlite_session.add_all([dataset, first_document, second_document])
    sqlite_session.flush()

    expected_doc_form = dataset.get_doc_form(session=sqlite_session)
    prefetch = DatasetResponsePrefetch.load([dataset], session=sqlite_session)

    assert expected_doc_form == IndexStructureType.QA_INDEX
    assert prefetch.doc_forms[dataset.id] == expected_doc_form


def test_load_external_knowledge_info_limits_bindings_per_dataset(sqlite_session: Session) -> None:
    dataset = _dataset("dataset-external")
    dataset.provider = "external"
    api = ExternalKnowledgeApis(
        name="External API",
        description="",
        tenant_id=dataset.tenant_id,
        settings=json.dumps({"endpoint": "https://example.test"}),
        created_by="account-1",
        updated_by=None,
    )
    api.id = "external-api-1"
    bindings = []
    for index in range(100):
        binding = ExternalKnowledgeBindings(
            tenant_id=dataset.tenant_id,
            external_knowledge_api_id=api.id,
            dataset_id=dataset.id,
            external_knowledge_id=f"knowledge-{index}",
            created_by="account-1",
        )
        binding.id = f"binding-{index:03d}"
        bindings.append(binding)
    sqlite_session.add_all([dataset, api, *bindings])
    sqlite_session.flush()

    returned_row_counts: list[int] = []

    class ResultProxy:
        def __init__(self, result) -> None:
            self._result = result

        def all(self):
            rows = self._result.all()
            returned_row_counts.append(len(rows))
            return rows

    class SessionProxy:
        def execute(self, statement):
            return ResultProxy(sqlite_session.execute(statement))

        def scalars(self, statement):
            return ResultProxy(sqlite_session.scalars(statement))

    info = _load_external_knowledge_infos([dataset], session=SessionProxy())  # type: ignore[arg-type]

    assert info[dataset.id] is not None
    assert returned_row_counts[0] == 1


def test_source_uses_prefetched_values_without_model_getters() -> None:
    dataset = MagicMock(id="dataset-1")
    prefetch = DatasetResponsePrefetch(
        app_counts={"dataset-1": 3},
        document_counts={"dataset-1": 4},
        word_counts={"dataset-1": 20},
        author_names={"dataset-1": "Ada"},
        tags={"dataset-1": []},
        doc_forms={"dataset-1": "text_model"},
        external_knowledge_infos={"dataset-1": None},
        doc_metadatas={"dataset-1": []},
        published_statuses={"dataset-1": False},
        available_document_counts={"dataset-1": 2},
    )
    source = DatasetDetailResponseSource(dataset=dataset, session=MagicMock(), prefetch=prefetch)

    assert source.app_count == 3
    assert source.document_count == 4
    assert source.word_count == 20
    assert source.author_name == "Ada"
    assert source.tags == []
    assert source.doc_form == "text_model"
    assert source.external_knowledge_info is None
    assert source.doc_metadata == []
    assert source.is_published is False
    assert source.total_documents == 4
    assert source.total_available_documents == 2
    dataset.get_document_count.assert_not_called()


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
    tag = Tag(tenant_id=dataset.tenant_id, type="knowledge", name="Tag", created_by=account.id)
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
    dataset_id = str(dataset.id)

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


def test_prefetch_matches_dataset_getter_for_external_knowledge(sqlite_session: Session) -> None:
    dataset = _dataset("dataset-external")
    dataset.provider = "external"
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
    sqlite_session.add_all([dataset, api, binding])
    sqlite_session.commit()

    prefetch = DatasetResponsePrefetch.load([dataset], session=sqlite_session)

    assert prefetch.external_knowledge_infos[dataset.id] == dataset.get_external_knowledge_info(session=sqlite_session)


def test_prefetch_keeps_tag_and_external_data_in_their_tenant(sqlite_session: Session) -> None:
    dataset = _dataset("dataset-1")
    dataset.provider = "external"
    other_tenant_tag = Tag(tenant_id="tenant-2", type="knowledge", name="Other", created_by="account-2")
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
