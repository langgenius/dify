"""Pure document-creation policy projections."""

from core.rag.retrieval.retrieval_methods import RetrievalMethod
from services.knowledge.documents.contracts import (
    DocumentWriteNotionPage,
    DocumentWriteNotionSource,
    DocumentWriteWebsiteSource,
    build_initial_retrieval_model,
    build_initialized_dataset_identity,
    build_notion_document_source,
    build_upload_document_source,
    build_website_document_source,
)
from services.knowledge.documents.creation import build_document_write_config
from services.knowledge.entities.knowledge_entities import (
    KnowledgeConfig,
)


def _config(**updates: object) -> KnowledgeConfig:
    values: dict[str, object] = {
        "indexing_technique": "high_quality",
        "process_rule": {"mode": "automatic"},
    }
    values.update(updates)
    return KnowledgeConfig.model_validate(values)


def test_initial_retrieval_model_uses_default_or_prepared_request() -> None:
    assert build_initial_retrieval_model(build_document_write_config(_config())) == {
        "search_method": RetrievalMethod.SEMANTIC_SEARCH,
        "reranking_enable": False,
        "reranking_model": {"reranking_provider_name": "", "reranking_model_name": ""},
        "top_k": 4,
        "score_threshold_enabled": False,
    }

    configured = build_initial_retrieval_model(
        build_document_write_config(
            _config(
                retrieval_model={
                    "search_method": "full_text_search",
                    "reranking_enable": False,
                    "top_k": 7,
                    "score_threshold_enabled": True,
                    "score_threshold": 0.4,
                }
            )
        )
    )
    assert configured["search_method"] == RetrievalMethod.FULL_TEXT_SEARCH
    assert configured["top_k"] == 7
    assert configured["score_threshold"] == 0.4


def test_upload_source_projection_uses_locked_file_identity() -> None:
    source = build_upload_document_source(file_id="file-id", filename="report.pdf")

    assert source.data_source_type == "upload_file"
    assert source.data_source_info == {"upload_file_id": "file-id"}
    assert source.name == "report.pdf"


def test_write_config_detaches_nested_request_values() -> None:
    write_config = build_document_write_config(
        _config(
            data_source={
                "info_list": {
                    "data_source_type": "upload_file",
                    "file_info_list": {"file_ids": ["file-id"]},
                }
            },
            summary_index_setting={},
        )
    )

    assert write_config.data_source is not None
    assert write_config.data_source.file_ids == ("file-id",)
    assert write_config.process_rule is not None
    assert write_config.process_rule.mode == "automatic"
    assert write_config.summary_index_setting == {}


def test_notion_and_website_source_projection_preserves_storage_contract() -> None:
    notion = DocumentWriteNotionSource(
        credential_id="credential",
        workspace_id="notion-workspace",
        pages=(),
    )
    page = DocumentWriteNotionPage(
        page_id="page",
        page_name="",
        page_icon={"type": "emoji", "url": None, "emoji": "📄"},
        type="page",
    )
    notion_source = build_notion_document_source(notion, page)
    assert notion_source.name == "nopagename"
    assert notion_source.data_source_info == {
        "credential_id": "credential",
        "notion_workspace_id": "notion-workspace",
        "notion_page_id": "page",
        "notion_page_icon": {"type": "emoji", "url": None, "emoji": "📄"},
        "type": "page",
    }

    url = "https://example.com/" + "x" * 260
    website_source = build_website_document_source(
        DocumentWriteWebsiteSource(provider="firecrawl", job_id="job", urls=(url,), only_main_content=True),
        url,
    )
    assert website_source.name == url[:200] + "..."
    assert website_source.data_source_info == {
        "url": url,
        "provider": "firecrawl",
        "job_id": "job",
        "only_main_content": True,
        "mode": "crawl",
    }


def test_initialized_dataset_identity_preserves_existing_name_policy() -> None:
    identity = build_initialized_dataset_identity("A document name that is longer than eighteen characters")

    assert identity.name == "A document name th..."
    assert identity.description == (
        "useful for when you want to answer queries about the A document name that is longer than eighteen characters"
    )
