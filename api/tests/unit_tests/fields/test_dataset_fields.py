from types import SimpleNamespace
from unittest.mock import Mock

from fields.dataset_fields import DatasetDetailResponse, dataset_detail_response_source


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


def test_dataset_detail_response_source_uses_caller_session_for_database_fields():
    session = Mock()
    getter_values = {
        "get_app_count": 3,
        "get_document_count": 4,
        "get_word_count": 500,
        "get_author_name": "Ada",
        "get_tags": [{"id": "tag-1", "name": "Tag", "type": "knowledge"}],
        "get_doc_form": "paragraph",
        "get_external_knowledge_info": {
            "external_knowledge_id": "knowledge-id",
            "external_knowledge_api_id": "api-id",
            "external_knowledge_api_name": "api",
            "external_knowledge_api_endpoint": "https://example.com",
        },
        "get_doc_metadata": [{"id": "metadata-1", "name": "Metadata", "type": "string"}],
        "get_is_published": True,
        "get_total_documents": 4,
        "get_total_available_documents": 2,
    }
    dataset = SimpleNamespace(**_dataset_detail_payload())
    for getter_name, value in getter_values.items():
        setattr(dataset, getter_name, Mock(return_value=value))

    response = DatasetDetailResponse.model_validate(
        dataset_detail_response_source(dataset, session=session),
        from_attributes=True,
    )

    assert response.app_count == 3
    assert response.document_count == 4
    assert response.word_count == 500
    assert response.author_name == "Ada"
    assert response.tags[0].id == "tag-1"
    assert response.doc_form == "paragraph"
    assert response.external_knowledge_info.external_knowledge_api_id == "api-id"
    assert response.doc_metadata[0].id == "metadata-1"
    assert response.is_published is True
    assert response.total_documents == 4
    assert response.total_available_documents == 2
    for getter_name in getter_values:
        getattr(dataset, getter_name).assert_called_once_with(session=session)
