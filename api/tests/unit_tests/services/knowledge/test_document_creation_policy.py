"""Pure document-creation policy projections."""

from dataclasses import dataclass, field

import pytest

from core.rag.retrieval.retrieval_methods import RetrievalMethod
from services.knowledge.documents.contracts import (
    DocumentCreationDataset,
    DocumentCreationEnvironment,
    DocumentCreationLimits,
    DocumentWriteNotionPage,
    DocumentWriteNotionSource,
    DocumentWriteWebsiteSource,
    build_initial_retrieval_model,
    build_initialized_dataset_identity,
    build_notion_document_source,
    build_upload_document_source,
    build_website_document_source,
)
from services.knowledge.documents.creation import (
    build_default_process_rules,
    build_document_write_config,
    check_document_creation_limits,
    count_documents_to_create,
    prepare_document_creation,
    validate_document_creation,
)
from services.knowledge.entities.knowledge_entities import (
    KnowledgeConfig,
)
from services.knowledge.entities.model_configuration import EmbeddingModelConfiguration


def _config(**updates: object) -> KnowledgeConfig:
    values: dict[str, object] = {
        "indexing_technique": "high_quality",
        "process_rule": {"mode": "automatic"},
    }
    values.update(updates)
    return KnowledgeConfig.model_validate(values)


def _environment(*, batch_limit: int = 10, upload_limit: int = 100, uploaded: int = 0) -> DocumentCreationEnvironment:
    return DocumentCreationEnvironment(
        limits=DocumentCreationLimits(
            enabled=True,
            sandbox=False,
            batch_upload_limit=batch_limit,
            upload_quota_limit=upload_limit,
            upload_quota_size=uploaded,
        ),
        priority_indexing=False,
        initial_permission="only_me",
    )


@dataclass
class _CreationGateway:
    model: EmbeddingModelConfiguration = field(
        default_factory=lambda: EmbeddingModelConfiguration("provider", "embedding", supports_vision=True)
    )
    resolved_tenants: list[str] = field(default_factory=list)
    validated_datasets: list[DocumentCreationDataset] = field(default_factory=list)

    def load_environment(self, tenant_id: str) -> DocumentCreationEnvironment:
        raise AssertionError(f"unexpected environment lookup for {tenant_id}")

    def resolve_default_embedding_model(self, tenant_id: str) -> EmbeddingModelConfiguration:
        self.resolved_tenants.append(tenant_id)
        return self.model

    def validate_dataset_model(self, dataset: DocumentCreationDataset) -> None:
        self.validated_datasets.append(dataset)


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


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        (
            {
                "data_source_type": "upload_file",
                "file_info_list": {"file_ids": ["first", "second"]},
            },
            2,
        ),
        (
            {
                "data_source_type": "notion_import",
                "notion_info_list": [
                    {
                        "credential_id": "credential-one",
                        "workspace_id": "workspace-one",
                        "pages": [
                            {"page_id": "one", "page_name": "One", "type": "page"},
                            {"page_id": "two", "page_name": "Two", "type": "page"},
                        ],
                    },
                    {
                        "credential_id": "credential-two",
                        "workspace_id": "workspace-two",
                        "pages": [{"page_id": "three", "page_name": "Three", "type": "page"}],
                    },
                ],
            },
            3,
        ),
        (
            {
                "data_source_type": "website_crawl",
                "website_info_list": {
                    "provider": "firecrawl",
                    "job_id": "job",
                    "urls": ["https://example.com/one", "https://example.com/two"],
                },
            },
            2,
        ),
    ],
)
def test_document_count_matches_each_source_boundary(source: dict[str, object], expected: int) -> None:
    config = _config(data_source={"info_list": source})

    assert count_documents_to_create(config) == expected


@pytest.mark.parametrize(
    ("source", "error"),
    [
        ({"data_source_type": "upload_file"}, "File source info is required"),
        ({"data_source_type": "notion_import"}, "Notion source info is required"),
        ({"data_source_type": "website_crawl"}, "Website source info is required"),
    ],
)
def test_source_validation_requires_the_matching_source_details(source: dict[str, object], error: str) -> None:
    config = _config(data_source={"info_list": source})

    with pytest.raises(ValueError, match=error):
        validate_document_creation(config)


def test_process_rule_normalization_is_copy_on_write() -> None:
    automatic = _config(
        process_rule={
            "mode": "automatic",
            "rules": {
                "pre_processing_rules": [{"id": "remove_extra_spaces", "enabled": True}],
                "segmentation": {"separator": "\n", "max_tokens": 100},
            },
        }
    )

    normalized_automatic = validate_document_creation(automatic)

    assert normalized_automatic.process_rule is not None
    assert normalized_automatic.process_rule.rules is None
    assert automatic.process_rule is not None
    assert automatic.process_rule.rules is not None

    hierarchical = _config(
        process_rule={
            "mode": "hierarchical",
            "rules": {
                "pre_processing_rules": [
                    {"id": "remove_extra_spaces", "enabled": True},
                    {"id": "remove_extra_spaces", "enabled": False},
                    {"id": "remove_urls_emails", "enabled": True},
                ],
                "segmentation": {"separator": "\n", "max_tokens": 200},
            },
        }
    )

    normalized_hierarchical = validate_document_creation(hierarchical)

    assert normalized_hierarchical.process_rule is not None
    assert normalized_hierarchical.process_rule.rules is not None
    rules = normalized_hierarchical.process_rule.rules
    assert rules.parent_mode == "paragraph"
    assert [(rule.id, rule.enabled) for rule in rules.pre_processing_rules or ()] == [
        ("remove_extra_spaces", False),
        ("remove_urls_emails", True),
    ]
    assert hierarchical.process_rule is not None
    assert hierarchical.process_rule.rules is not None
    assert hierarchical.process_rule.rules.parent_mode is None
    assert len(hierarchical.process_rule.rules.pre_processing_rules or ()) == 3


@pytest.mark.parametrize(
    ("process_rule", "error"),
    [
        ({"mode": "custom"}, "Process rule rules is required"),
        (
            {"mode": "custom", "rules": {"segmentation": {"separator": "\n", "max_tokens": 100}}},
            "Process rule pre_processing_rules is required",
        ),
        (
            {"mode": "custom", "rules": {"pre_processing_rules": []}},
            "Process rule segmentation is required",
        ),
        (
            {
                "mode": "custom",
                "rules": {
                    "pre_processing_rules": [],
                    "segmentation": {"separator": "", "max_tokens": 100},
                },
            },
            "Process rule segmentation separator is required",
        ),
        (
            {
                "mode": "custom",
                "rules": {
                    "pre_processing_rules": [],
                    "segmentation": {"separator": "\n", "max_tokens": 0},
                },
            },
            "Process rule segmentation max_tokens is required",
        ),
    ],
)
def test_process_rule_validation_rejects_incomplete_custom_rules(process_rule: dict[str, object], error: str) -> None:
    with pytest.raises(ValueError, match=error):
        validate_document_creation(_config(process_rule=process_rule))


def test_validation_requires_a_source_or_process_rule() -> None:
    config = KnowledgeConfig.model_validate({"indexing_technique": "economy"})

    with pytest.raises(ValueError, match="Data source or Process rule is required"):
        validate_document_creation(config)


def test_default_process_rules_return_a_fresh_limit_projection() -> None:
    first = build_default_process_rules(4096)
    second = build_default_process_rules(2048)

    assert first["limits"] == {"indexing_max_segmentation_tokens_length": 4096}
    assert second["limits"] == {"indexing_max_segmentation_tokens_length": 2048}
    assert first["rules"] is not second["rules"]


def test_zero_upload_quota_is_unlimited_but_batch_limit_still_applies() -> None:
    limits = DocumentCreationLimits(
        enabled=True,
        sandbox=False,
        batch_upload_limit=3,
        upload_quota_limit=0,
        upload_quota_size=999,
    )

    check_document_creation_limits(3, limits)

    with pytest.raises(ValueError, match="batch upload limit of 3"):
        check_document_creation_limits(4, limits)


def test_creation_limits_cover_disabled_sandbox_and_remaining_upload_quota() -> None:
    disabled = DocumentCreationLimits(
        enabled=False,
        sandbox=True,
        batch_upload_limit=0,
        upload_quota_limit=1,
        upload_quota_size=1,
    )
    check_document_creation_limits(100, disabled)

    with pytest.raises(ValueError, match="does not support batch upload"):
        check_document_creation_limits(
            2,
            DocumentCreationLimits(
                enabled=True,
                sandbox=True,
                batch_upload_limit=10,
                upload_quota_limit=10,
                upload_quota_size=0,
            ),
        )

    with pytest.raises(ValueError, match="Only 1 documents can be uploaded"):
        check_document_creation_limits(
            2,
            DocumentCreationLimits(
                enabled=True,
                sandbox=False,
                batch_upload_limit=10,
                upload_quota_limit=3,
                upload_quota_size=2,
            ),
        )


def test_preparation_resolves_default_embedding_without_mutating_request() -> None:
    dataset = DocumentCreationDataset(
        tenant_id="tenant",
        indexing_technique=None,
        embedding_model=None,
        embedding_model_provider=None,
    )
    request = _config(
        embedding_model=None,
        embedding_model_provider=None,
        data_source={
            "info_list": {
                "data_source_type": "upload_file",
                "file_info_list": {"file_ids": ["source"]},
            }
        },
    )
    gateway = _CreationGateway()

    prepared = prepare_document_creation(dataset, request, _environment(), gateway)

    assert prepared.embedding_model == "embedding"
    assert prepared.embedding_model_provider == "provider"
    assert request.embedding_model is None
    assert request.embedding_model_provider is None
    assert gateway.resolved_tenants == ["tenant"]
    assert gateway.validated_datasets == []


def test_preparation_rejects_invalid_initial_indexing_technique() -> None:
    dataset = DocumentCreationDataset("tenant", None, None, None)
    request = KnowledgeConfig.model_construct(indexing_technique="invalid", process_rule=None)

    with pytest.raises(ValueError, match="Indexing technique is invalid"):
        prepare_document_creation(dataset, request, _environment(), _CreationGateway())


def test_replacement_skips_creation_quota_and_validates_the_dataset_model() -> None:
    dataset = DocumentCreationDataset("tenant", "high_quality", "embedding", "provider")
    request = _config(
        original_document_id="document",
        data_source={
            "info_list": {
                "data_source_type": "upload_file",
                "file_info_list": {"file_ids": ["replacement"]},
            }
        },
    )
    gateway = _CreationGateway()

    prepared = prepare_document_creation(dataset, request, _environment(batch_limit=0), gateway)

    assert prepared is request
    assert gateway.resolved_tenants == []
    assert gateway.validated_datasets == [dataset]


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
