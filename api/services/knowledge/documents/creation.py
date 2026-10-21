"""Document-creation validation and policy independent of persistence and providers."""

from dataclasses import replace

from enums.knowledge import ProcessRuleMode
from services.knowledge.documents.contracts import (
    DocumentCreationDataset,
    DocumentCreationEnvironment,
    DocumentCreationGateway,
    DocumentCreationLimits,
    DocumentWriteConfig,
    DocumentWriteNotionPage,
    DocumentWriteNotionSource,
    DocumentWriteProcessRule,
    DocumentWriteSource,
    DocumentWriteWebsiteSource,
)
from services.knowledge.entities.knowledge_entities import KnowledgeConfig

_SUPPORTED_DATA_SOURCES = frozenset({"upload_file", "notion_import", "website_crawl"})
_SUPPORTED_INDEXING_TECHNIQUES = frozenset({"high_quality", "economy"})


def build_document_write_config(config: KnowledgeConfig) -> DocumentWriteConfig:
    """Detach a validated API model into the document persistence contract."""

    source = None
    if config.data_source is not None:
        info = config.data_source.info_list
        notion_sources = tuple(
            DocumentWriteNotionSource(
                credential_id=notion.credential_id,
                workspace_id=notion.workspace_id,
                pages=tuple(
                    DocumentWriteNotionPage(
                        page_id=page.page_id,
                        page_name=page.page_name,
                        page_icon={str(key): value for key, value in page.page_icon.model_dump().items()}
                        if page.page_icon
                        else None,
                        type=page.type,
                    )
                    for page in notion.pages
                ),
            )
            for notion in info.notion_info_list or ()
        )
        website = info.website_info_list
        source = DocumentWriteSource(
            data_source_type=info.data_source_type,
            file_ids=tuple(info.file_info_list.file_ids) if info.file_info_list else (),
            notion_sources=notion_sources,
            website_source=DocumentWriteWebsiteSource(
                provider=website.provider,
                job_id=website.job_id,
                urls=tuple(website.urls),
                only_main_content=website.only_main_content,
            )
            if website
            else None,
        )

    process_rule = config.process_rule
    return DocumentWriteConfig(
        original_document_id=config.original_document_id,
        duplicate=config.duplicate,
        indexing_technique=config.indexing_technique,
        data_source=source,
        process_rule=DocumentWriteProcessRule(
            mode=process_rule.mode,
            rules_json=process_rule.rules.model_dump_json() if process_rule.rules else None,
        )
        if process_rule
        else None,
        retrieval_model={str(key): value for key, value in config.retrieval_model.model_dump().items()}
        if config.retrieval_model is not None
        else None,
        summary_index_setting={str(key): value for key, value in config.summary_index_setting.items()}
        if config.summary_index_setting is not None
        else None,
        doc_form=config.doc_form,
        doc_language=config.doc_language,
        embedding_model=config.embedding_model,
        embedding_model_provider=config.embedding_model_provider,
        name=config.name,
        is_multimodal=config.is_multimodal,
    )


def build_default_process_rules(indexing_max_segmentation_tokens_length: int) -> dict[str, object]:
    """Return a fresh default process-rule projection for API responses."""

    return {
        "mode": "custom",
        "rules": {
            "pre_processing_rules": [
                {"id": "remove_extra_spaces", "enabled": True},
                {"id": "remove_urls_emails", "enabled": False},
            ],
            "segmentation": {"delimiter": "\n", "max_tokens": 1024, "chunk_overlap": 50},
        },
        "limits": {
            "indexing_max_segmentation_tokens_length": indexing_max_segmentation_tokens_length,
        },
    }


def validate_document_creation(config: KnowledgeConfig) -> KnowledgeConfig:
    """Validate and normalize a creation command without mutating the caller's value."""

    if config.data_source is None and config.process_rule is None:
        raise ValueError("Data source or Process rule is required")

    normalized = config.model_copy(deep=True)
    if normalized.data_source is not None:
        _validate_data_source(normalized)
    if normalized.process_rule is not None:
        _normalize_process_rule(normalized)
    return normalized


def count_documents_to_create(config: KnowledgeConfig) -> int | None:
    """Count source documents for quota checks; no source means no upload quota applies."""

    if config.data_source is None:
        return None
    info = config.data_source.info_list
    source_type = info.data_source_type
    if source_type == "upload_file":
        assert info.file_info_list is not None
        return len(info.file_info_list.file_ids)
    if source_type == "notion_import":
        assert info.notion_info_list is not None
        return sum(len(notion.pages) for notion in info.notion_info_list)
    if source_type == "website_crawl":
        assert info.website_info_list is not None
        return len(info.website_info_list.urls)
    raise ValueError("Data source type is invalid")


def check_document_creation_limits(count: int, limits: DocumentCreationLimits) -> None:
    """Apply the existing Cloud batch and document-upload quota contract."""

    if not limits.enabled:
        return
    if limits.sandbox and count > 1:
        raise ValueError("Your current plan does not support batch upload, please upgrade your plan.")
    if count > limits.batch_upload_limit:
        raise ValueError(f"You have reached the batch upload limit of {limits.batch_upload_limit}.")

    available = limits.upload_quota_limit - limits.upload_quota_size
    if limits.upload_quota_limit > 0 and count > available:
        raise ValueError(
            f"You have reached the limit of your subscription. Only {available} documents can be uploaded."
        )


def prepare_document_creation(
    dataset: DocumentCreationDataset,
    config: KnowledgeConfig,
    environment: DocumentCreationEnvironment,
    gateway: DocumentCreationGateway,
) -> KnowledgeConfig:
    """Prepare one validated command using an immutable external-state snapshot."""

    prepared = config
    if not prepared.original_document_id:
        count = count_documents_to_create(prepared)
        if count is not None:
            check_document_creation_limits(count, environment.limits)

    effective_dataset = dataset
    if not dataset.indexing_technique:
        if prepared.indexing_technique not in _SUPPORTED_INDEXING_TECHNIQUES:
            raise ValueError("Indexing technique is invalid")
        if prepared.indexing_technique == "high_quality" and (
            not prepared.embedding_model or not prepared.embedding_model_provider
        ):
            model = gateway.resolve_default_embedding_model(dataset.tenant_id)
            prepared = prepared.model_copy(
                update={"embedding_model": model.model, "embedding_model_provider": model.provider}
            )
        effective_dataset = replace(
            dataset,
            indexing_technique=prepared.indexing_technique,
            embedding_model=prepared.embedding_model,
            embedding_model_provider=prepared.embedding_model_provider,
        )

    if prepared.original_document_id:
        gateway.validate_dataset_model(effective_dataset)
    return prepared


def _validate_data_source(config: KnowledgeConfig) -> None:
    data_source = config.data_source
    if data_source is None:
        raise ValueError("Data source is required")
    info = data_source.info_list
    if info is None:
        raise ValueError("Data source info is required")
    if info.data_source_type not in _SUPPORTED_DATA_SOURCES:
        raise ValueError("Data source type is invalid")
    if info.data_source_type == "upload_file" and not info.file_info_list:
        raise ValueError("File source info is required")
    if info.data_source_type == "notion_import" and not info.notion_info_list:
        raise ValueError("Notion source info is required")
    if info.data_source_type == "website_crawl" and not info.website_info_list:
        raise ValueError("Website source info is required")


def _normalize_process_rule(config: KnowledgeConfig) -> None:
    process_rule = config.process_rule
    if process_rule is None:
        raise ValueError("Process rule is required")
    if not process_rule.mode:
        raise ValueError("Process rule mode is required")

    mode = str(process_rule.mode)
    if mode not in {item.value for item in ProcessRuleMode}:
        raise ValueError("Process rule mode is invalid")
    if mode == ProcessRuleMode.AUTOMATIC:
        process_rule.rules = None
        return

    rules = process_rule.rules
    if rules is None:
        raise ValueError("Process rule rules is required")
    if rules.pre_processing_rules is None:
        raise ValueError("Process rule pre_processing_rules is required")

    unique_pre_processing_rules = {}
    for rule in rules.pre_processing_rules:
        if not rule.id:
            raise ValueError("Process rule pre_processing_rules id is required")
        if not isinstance(rule.enabled, bool):
            raise ValueError("Process rule pre_processing_rules enabled is invalid")
        unique_pre_processing_rules[rule.id] = rule
    rules.pre_processing_rules = list(unique_pre_processing_rules.values())

    if mode == ProcessRuleMode.HIERARCHICAL and not rules.parent_mode:
        rules.parent_mode = "paragraph"
    segmentation = rules.segmentation
    if segmentation is None:
        raise ValueError("Process rule segmentation is required")
    if not segmentation.separator:
        raise ValueError("Process rule segmentation separator is required")
    if not isinstance(segmentation.separator, str):
        raise ValueError("Process rule segmentation separator is invalid")
    if not (mode == ProcessRuleMode.HIERARCHICAL and rules.parent_mode == "full-doc"):
        if not segmentation.max_tokens:
            raise ValueError("Process rule segmentation max_tokens is required")
        if not isinstance(segmentation.max_tokens, int):
            raise ValueError("Process rule segmentation max_tokens is invalid")
