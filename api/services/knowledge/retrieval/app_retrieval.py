"""Easy-UI application adapter for the unified knowledge retrieval boundary."""

from collections.abc import Mapping
from typing import Any

from pydantic import JsonValue

from core.app.app_config.entities import DatasetEntity
from core.app.entities.app_invoke_entities import (
    EasyUIBasedAppGenerateEntity,
    get_credit_usage_app_type,
)
from core.callback_handler.index_tool_callback_handler import DatasetIndexToolCallbackHandler
from core.ops.entities.trace_entity import TraceTaskName
from core.ops.ops_trace_manager import TraceTask
from core.rag.models.document import Document
from core.workflow.file_reference import build_file_reference
from graphon.file import File, FileTransferMethod, FileType
from graphon.nodes.llm.entities import ModelConfig as RetrievalMetadataModelConfig
from services.knowledge.entities.citation import to_retrieval_source_metadata
from services.knowledge.entities.retrieval import KnowledgeRetrievalRequest, Source
from services.knowledge.retrieval.retrieval import KnowledgeRetriever


def _completion_params(application_generate_entity: EasyUIBasedAppGenerateEntity) -> dict[str, JsonValue]:
    """Preserve the already-resolved app model snapshot without refreshing its provider."""
    model_config = application_generate_entity.model_conf
    parameters = dict(model_config.parameters)
    if model_config.stop:
        parameters["stop"] = list(model_config.stop)
    return parameters


def _metadata_model_config(dataset_config: DatasetEntity) -> RetrievalMetadataModelConfig | None:
    model_config = dataset_config.retrieve_config.metadata_model_config
    if model_config is None:
        return None
    return RetrievalMetadataModelConfig.model_validate(model_config.model_dump())


def _publish_retrieval_resources(
    *,
    sources: list[Source],
    show_retrieve_source: bool,
    hit_callback: DatasetIndexToolCallbackHandler,
) -> None:
    resources = [
        to_retrieval_source_metadata(source)
        for source in sources
        if source.metadata.data_source_type == "external" or show_retrieve_source
    ]
    if not resources:
        return
    resources.sort(key=lambda resource: resource.score or 0.0, reverse=True)
    for position, resource in enumerate(resources, start=1):
        resource.position = position
    hit_callback.return_retriever_resource_info(resources)


def retrieve_app_context(
    *,
    knowledge_retrieval: KnowledgeRetriever,
    application_generate_entity: EasyUIBasedAppGenerateEntity,
    app_id: str,
    tenant_id: str,
    dataset_config: DatasetEntity,
    query: str,
    show_retrieve_source: bool,
    hit_callback: DatasetIndexToolCallbackHandler,
    message_id: str,
    inputs: Mapping[str, Any] | None,
    vision_enabled: bool,
) -> tuple[str | None, list[File]]:
    """Retrieve finalized app context, citations, vision files, and tracing evidence.

    ``model_conf`` is the provider-resolved snapshot created with the app generate
    entity. The unified knowledge query resolves only the planner model it owns;
    this adapter deliberately adds no implicit provider refresh side effect.
    """
    if not dataset_config.dataset_ids:
        return None, []

    retrieve_config = dataset_config.retrieve_config
    model_config = application_generate_entity.model_conf
    invoke_from = application_generate_entity.invoke_from
    request = KnowledgeRetrievalRequest(
        tenant_id=tenant_id,
        user_id=application_generate_entity.user_id,
        app_id=app_id,
        user_from="account" if invoke_from.runs_as_account() else "end_user",
        dataset_ids=dataset_config.dataset_ids,
        query=query,
        retrieval_mode="single" if retrieve_config.retrieve_strategy == "single" else "multiple",
        routing_strategy="auto",
        model_provider=model_config.provider,
        completion_params=_completion_params(application_generate_entity),
        model_mode=model_config.mode,
        model_name=model_config.model,
        metadata_model_config=_metadata_model_config(dataset_config),
        metadata_filtering_conditions=retrieve_config.metadata_filtering_conditions,
        metadata_filtering_mode=retrieve_config.metadata_filtering_mode or "disabled",
        metadata_inputs={key: str(value) for key, value in inputs.items()} if inputs else {},
        retriever_from=invoke_from.to_source(),
        top_k=retrieve_config.top_k or 0,
        score_threshold=retrieve_config.score_threshold or 0.0,
        reranking_mode=retrieve_config.rerank_mode or "reranking_model",
        reranking_model=retrieve_config.reranking_model,
        weights=retrieve_config.weights,
        reranking_enable=True if retrieve_config.reranking_enabled is None else retrieve_config.reranking_enabled,
    )
    result = knowledge_retrieval.retrieve(
        request,
        request_metadata={
            "app_id": app_id,
            "app_type": get_credit_usage_app_type(application_generate_entity.app_config.app_mode),
        },
    )

    _publish_retrieval_resources(
        sources=result.sources,
        show_retrieve_source=show_retrieve_source,
        hit_callback=hit_callback,
    )

    if result.trace is not None and result.trace.documents and application_generate_entity.trace_manager is not None:
        application_generate_entity.trace_manager.add_trace_task(
            TraceTask(
                TraceTaskName.DATASET_RETRIEVAL_TRACE,
                message_id=message_id,
                documents=[
                    Document(
                        page_content=document.page_content,
                        provider=document.provider,
                        metadata=dict(document.metadata),
                    )
                    for document in result.trace.documents
                ],
                timer=dict(result.trace.timer),
            )
        )

    context_files: list[File] = []
    if vision_enabled:
        context_files = [
            File(
                file_id=attachment.id,
                filename=attachment.name,
                extension=f".{attachment.extension}",
                mime_type=attachment.mime_type,
                file_type=FileType.IMAGE,
                transfer_method=FileTransferMethod.LOCAL_FILE,
                remote_url=attachment.source_url,
                reference=build_file_reference(record_id=attachment.id),
                size=attachment.size,
                storage_key=attachment.storage_key,
                url=attachment.preview_url,
            )
            for attachment in result.attachments
        ]

    return result.context, context_files
