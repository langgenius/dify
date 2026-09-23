import json
from collections.abc import Iterator
from contextlib import contextmanager

import pytest
from sqlalchemy import event
from sqlalchemy.orm import Session

from core.rag.index_processor.constant.index_type import IndexStructureType
from fields.dataset_fields import (
    DatasetDetailPrefetch,
    DatasetDetailResponse,
    build_dataset_detail_prefetch,
    dataset_detail_response_source,
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
from models.enums import DatasetMetadataType, DataSourceType, DocumentCreatedFrom, TagType
from models.model import App, AppMode, IconType, Tag, TagBinding


def _dataset_detail_payload(**overrides):
    payload = {
        "id": "ds-1",
        "name": "Dataset",
        "description": "desc",
        "provider": "vendor",
        "permission": "only_me",
        "data_source_type": None,
        "indexing_technique": "economy",
        "app_count": 0,
        "document_count": 0,
        "word_count": 0,
        "created_by": "account-1",
        "author_name": None,
        "created_at": 1704067200,
        "updated_by": None,
        "updated_at": 1704067200,
        "embedding_model": None,
        "embedding_model_provider": None,
        "embedding_available": True,
        "retrieval_model_dict": {
            "search_method": "hybrid_search",
            "reranking_enable": True,
            "reranking_mode": "weighted_score",
            "reranking_model": {
                "reranking_provider_name": "provider",
                "reranking_model_name": "model",
            },
            "weights": {
                "weight_type": "customized",
                "keyword_setting": {"keyword_weight": 0.3},
                "vector_setting": {
                    "vector_weight": 0.7,
                    "embedding_model_name": "embedding",
                    "embedding_provider_name": "provider",
                },
            },
            "top_k": 3,
            "score_threshold_enabled": False,
            "score_threshold": None,
        },
        "summary_index_setting": {
            "enable": False,
            "model_name": None,
            "model_provider_name": None,
            "summary_prompt": None,
        },
        "tags": [],
        "doc_form": None,
        "external_knowledge_info": {
            "external_knowledge_id": "knowledge-id",
            "external_knowledge_api_id": "api-id",
            "external_knowledge_api_name": "api",
            "external_knowledge_api_endpoint": "https://example.com",
        },
        "external_retrieval_model": None,
        "doc_metadata": [],
        "built_in_field_enabled": False,
        "pipeline_id": None,
        "runtime_mode": "general",
        "chunk_structure": None,
        "icon_info": {
            "icon_type": "emoji",
            "icon": "📙",
            "icon_background": None,
            "icon_url": None,
        },
        "is_published": False,
        "total_documents": 0,
        "total_available_documents": 0,
        "enable_api": False,
        "is_multimodal": False,
    }
    payload.update(overrides)
    return payload


def _dump_dataset_detail(payload):
    return DatasetDetailResponse.model_validate(payload).model_dump(mode="json")


def test_dataset_detail_preserves_permission_keys():
    response = _dump_dataset_detail(
        _dataset_detail_payload(permission_keys=["dataset.acl.readonly", "dataset.acl.edit"])
    )

    assert response["permission_keys"] == ["dataset.acl.readonly", "dataset.acl.edit"]


def test_dataset_detail_expands_legacy_null_nested_fields():
    response = _dump_dataset_detail(
        _dataset_detail_payload(
            summary_index_setting=None,
            external_knowledge_info=None,
            icon_info=None,
        )
    )

    assert response["summary_index_setting"] == {
        "enable": None,
        "model_name": None,
        "model_provider_name": None,
        "summary_prompt": None,
    }
    assert response["external_knowledge_info"] == {
        "external_knowledge_id": None,
        "external_knowledge_api_id": None,
        "external_knowledge_api_name": None,
        "external_knowledge_api_endpoint": None,
    }
    assert response["icon_info"] == {
        "icon_type": None,
        "icon": None,
        "icon_background": None,
        "icon_url": None,
    }
    assert response["external_retrieval_model"] is None


def test_dataset_detail_expands_legacy_null_retrieval_nested_fields():
    response = _dump_dataset_detail(
        _dataset_detail_payload(
            retrieval_model_dict={
                "search_method": "hybrid_search",
                "reranking_enable": True,
                "reranking_mode": "weighted_score",
                "reranking_model": None,
                "weights": {
                    "keyword_setting": None,
                    "vector_setting": None,
                },
                "top_k": 3,
                "score_threshold_enabled": False,
                "score_threshold": None,
            }
        )
    )

    assert response["retrieval_model_dict"]["reranking_model"] == {
        "reranking_provider_name": None,
        "reranking_model_name": None,
    }
    assert response["retrieval_model_dict"]["weights"] == {
        "weight_type": None,
        "keyword_setting": {"keyword_weight": None},
        "vector_setting": {
            "vector_weight": None,
            "embedding_model_name": None,
            "embedding_provider_name": None,
        },
    }


def test_dataset_detail_expands_missing_weighted_score_nested_fields():
    response = _dump_dataset_detail(
        _dataset_detail_payload(
            retrieval_model_dict={
                "search_method": "hybrid_search",
                "reranking_enable": True,
                "reranking_mode": "weighted_score",
                "reranking_model": None,
                "weights": {},
                "top_k": 3,
                "score_threshold_enabled": False,
                "score_threshold": None,
            }
        )
    )

    assert response["retrieval_model_dict"]["weights"] == {
        "weight_type": None,
        "keyword_setting": {"keyword_weight": None},
        "vector_setting": {
            "vector_weight": None,
            "embedding_model_name": None,
            "embedding_provider_name": None,
        },
    }


@pytest.mark.parametrize("sqlite_session", [(Dataset, Account, App, AppDatasetJoin)], indirect=True)
def test_dataset_detail_response_source_uses_caller_session_for_database_fields(sqlite_session: Session):
    account = Account(name="Ada", email="ada@example.com")
    account.id = "account-1"
    dataset = Dataset(
        id="ds-1",
        tenant_id="tenant-1",
        name="Dataset",
        description="desc",
        provider="vendor",
        permission="only_me",
        data_source_type=None,
        indexing_technique="economy",
        created_by=account.id,
        retrieval_model=_dataset_detail_payload()["retrieval_model_dict"],
        summary_index_setting=_dataset_detail_payload()["summary_index_setting"],
        built_in_field_enabled=False,
        icon_info=_dataset_detail_payload()["icon_info"],
        runtime_mode="general",
        enable_api=False,
        is_multimodal=False,
    )
    dataset.embedding_available = True
    decoy_app = App(
        id="decoy-app",
        tenant_id="tenant-1",
        name="Decoy app",
        description="",
        mode=AppMode.CHAT,
        icon_type=IconType.EMOJI,
        icon="app",
        icon_background="#FFFFFF",
        enable_site=False,
        enable_api=False,
        max_active_requests=0,
    )
    decoy_join = AppDatasetJoin(app_id=decoy_app.id, dataset_id="other-dataset")
    sqlite_session.add_all([account, dataset, decoy_app, decoy_join])
    sqlite_session.flush()

    response = DatasetDetailResponse.model_validate(
        dataset_detail_response_source(dataset, session=sqlite_session),
        from_attributes=True,
    )

    assert response.app_count == 0
    assert response.document_count == 0
    assert response.word_count == 0
    assert response.author_name == "Ada"
    assert response.tags == []
    assert response.doc_form is None
    assert response.external_knowledge_info.external_knowledge_api_id is None
    assert response.doc_metadata == []
    assert response.is_published is False
    assert response.total_documents == 0
    assert response.total_available_documents == 0


def _dataset(index: int, account_id: str, **overrides: object) -> Dataset:
    dataset = Dataset(
        id=f"ds-{index}",
        tenant_id="tenant-1",
        name=f"Dataset {index}",
        description="desc",
        provider="vendor",
        permission="only_me",
        data_source_type=None,
        indexing_technique="economy",
        created_by=account_id,
        retrieval_model=None,
        summary_index_setting=None,
        built_in_field_enabled=False,
        icon_info=None,
        runtime_mode="general",
        enable_api=False,
        is_multimodal=False,
    )
    for name, value in overrides.items():
        setattr(dataset, name, value)
    return dataset


def _document(dataset_id: str, *, word_count: int, indexing_status: str, archived: bool = False) -> Document:
    return Document(
        tenant_id="tenant-1",
        dataset_id=dataset_id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch",
        name="doc",
        created_from=DocumentCreatedFrom.WEB,
        created_by="account-1",
        word_count=word_count,
        indexing_status=indexing_status,
        enabled=True,
        archived=archived,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )


def _seed_dataset_page(session: Session) -> list[Dataset]:
    """Create a page of datasets covering every session-scoped detail field."""
    account = Account(name="Ada", email="ada@example.com")
    account.id = "account-1"
    session.add(account)

    pipeline = Pipeline(tenant_id="tenant-1", name="Pipeline", is_published=True, created_by=account.id)
    external_api = ExternalKnowledgeApis(
        name="api",
        description="",
        tenant_id="tenant-1",
        settings=json.dumps({"endpoint": "https://example.com"}),
        created_by=account.id,
        updated_by=None,
    )
    session.add_all([pipeline, external_api])
    session.flush()

    plain = _dataset(1, account.id, built_in_field_enabled=True)
    piped = _dataset(2, account.id, pipeline_id=pipeline.id)
    external = _dataset(3, account.id, provider="external")
    structured = _dataset(4, account.id, chunk_structure=IndexStructureType.QA_INDEX)
    empty = _dataset(5, account.id)
    datasets = [plain, piped, external, structured, empty]
    session.add_all(datasets)

    session.add_all(
        [
            _document(plain.id, word_count=10, indexing_status="completed"),
            _document(plain.id, word_count=20, indexing_status="completed", archived=True),
            _document(plain.id, word_count=5, indexing_status="waiting"),
            _document(piped.id, word_count=7, indexing_status="completed"),
        ]
    )

    tag = Tag(tenant_id="tenant-1", type=TagType.KNOWLEDGE, name="tag", created_by=account.id)
    other_tag = Tag(tenant_id="tenant-1", type=TagType.APP, name="app tag", created_by=account.id)
    session.add_all([tag, other_tag])
    session.flush()
    session.add_all(
        [
            TagBinding(tenant_id="tenant-1", tag_id=tag.id, target_id=plain.id, created_by=account.id),
            TagBinding(tenant_id="tenant-1", tag_id=other_tag.id, target_id=plain.id, created_by=account.id),
        ]
    )

    session.add(
        DatasetMetadata(
            tenant_id="tenant-1",
            dataset_id=plain.id,
            type=DatasetMetadataType.STRING,
            name="author",
            created_by=account.id,
        )
    )
    session.add(
        ExternalKnowledgeBindings(
            tenant_id="tenant-1",
            external_knowledge_api_id=external_api.id,
            dataset_id=external.id,
            external_knowledge_id="external-1",
            created_by=account.id,
        )
    )

    app = App(
        id="app-1",
        tenant_id="tenant-1",
        name="App",
        description="",
        mode=AppMode.CHAT,
        icon_type=IconType.EMOJI,
        icon="app",
        icon_background="#FFFFFF",
        enable_site=False,
        enable_api=False,
        max_active_requests=0,
    )
    session.add_all([app, AppDatasetJoin(app_id=app.id, dataset_id=plain.id)])
    session.flush()
    return datasets


def _dump(dataset: Dataset, *, session: Session, prefetch: DatasetDetailPrefetch | None = None) -> dict[str, object]:
    return DatasetDetailResponse.model_validate(
        dataset_detail_response_source(dataset, session=session, prefetch=prefetch),
        from_attributes=True,
    ).model_dump(mode="json")


@contextmanager
def _count_selects(session: Session) -> Iterator[list[str]]:
    """Record every SELECT issued against the session's engine."""
    statements: list[str] = []
    engine = session.get_bind()

    @event.listens_for(engine, "before_cursor_execute")
    def _before(_conn, _cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", _before)


def test_dataset_detail_prefetch_matches_per_dataset_lookups(sqlite_session: Session):
    datasets = _seed_dataset_page(sqlite_session)

    expected = [_dump(dataset, session=sqlite_session) for dataset in datasets]

    prefetch = build_dataset_detail_prefetch(datasets, session=sqlite_session)
    prefetched = [_dump(dataset, session=sqlite_session, prefetch=prefetch) for dataset in datasets]

    assert prefetched == expected

    plain = prefetched[0]
    assert plain["app_count"] == 1
    assert plain["document_count"] == 3
    assert plain["total_documents"] == 3
    assert plain["total_available_documents"] == 1
    assert plain["word_count"] == 35
    assert plain["author_name"] == "Ada"
    assert [tag["name"] for tag in plain["tags"]] == ["tag"]
    assert plain["doc_form"] == IndexStructureType.PARAGRAPH_INDEX
    assert [metadata["name"] for metadata in plain["doc_metadata"]][0] == "author"
    assert len(plain["doc_metadata"]) == 6
    assert prefetched[1]["is_published"] is True
    assert prefetched[2]["external_knowledge_info"]["external_knowledge_api_endpoint"] == "https://example.com"
    assert prefetched[3]["doc_form"] == IndexStructureType.QA_INDEX
    assert prefetched[4]["document_count"] == 0
    assert prefetched[4]["doc_form"] is None


def test_dataset_detail_prefetch_keeps_query_count_independent_of_page_size(sqlite_session: Session):
    account = Account(name="Ada", email="ada@example.com")
    account.id = "account-1"
    sqlite_session.add(account)
    datasets = [_dataset(index, account.id) for index in range(20)]
    sqlite_session.add_all(datasets)
    sqlite_session.flush()

    def select_count(page: list[Dataset]) -> int:
        with _count_selects(sqlite_session) as statements:
            prefetch = build_dataset_detail_prefetch(page, session=sqlite_session)
            for dataset in page:
                _dump(dataset, session=sqlite_session, prefetch=prefetch)
            return len(statements)

    small_page = select_count(datasets[:2])
    full_page = select_count(datasets)

    assert full_page == small_page
    assert full_page <= 8
