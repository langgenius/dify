"""Prepare model-dependent settings before publishing a Pipeline atomically."""

from dataclasses import replace
from typing import Literal, Protocol

from machinery.context import RequestContext
from services.entities.knowledge_entities.rag_pipeline_entities import KnowledgeConfiguration
from services.errors.rag_pipeline import RagPipelinePublicationError
from services.rag_pipeline.publication_contracts import (
    EmbeddingModel,
    PipelinePublicationState,
    PreparedPipelineDataset,
)
from services.workflow.contracts import WorkflowSnapshot


class PipelinePublications(Protocol):
    def snapshot(self, context: RequestContext, pipeline_id: str) -> PipelinePublicationState: ...

    def publish(
        self, context: RequestContext, source: PipelinePublicationState, prepared: PreparedPipelineDataset | None
    ) -> WorkflowSnapshot: ...


class PipelinePublicationModels(Protocol):
    def provider_id(self, value: str | None) -> str | None: ...

    def validate_workflow(self, draft: WorkflowSnapshot) -> None: ...

    def embedding(self, tenant_id: str, provider: str, name: str, *, allow_missing: bool) -> EmbeddingModel | None: ...


class PipelineIndexUpdates(Protocol):
    def dispatch(self, dataset_id: str, action: Literal["add", "update"]) -> None: ...


class PipelinePublicationService:
    def __init__(
        self, publications: PipelinePublications, models: PipelinePublicationModels, indexes: PipelineIndexUpdates
    ) -> None:
        self._publications = publications
        self._models = models
        self._indexes = indexes

    def publish(self, context: RequestContext, pipeline_id: str) -> WorkflowSnapshot:
        source = self._publications.snapshot(context, pipeline_id)
        try:
            self._models.validate_workflow(source.draft)
            prepared = self._prepare_dataset(context, source)
        except ValueError as error:
            raise RagPipelinePublicationError(str(error)) from error
        published = self._publications.publish(context, source, prepared)
        if prepared is not None:
            for action in prepared.index_actions:
                self._indexes.dispatch(prepared.state.id, action)
        return published

    def _prepare_dataset(
        self, context: RequestContext, source: PipelinePublicationState
    ) -> PreparedPipelineDataset | None:
        state = source.dataset
        embedding = None
        actions: list[Literal["add", "update"]] = []
        changed = False
        for node in source.draft.graph_dict.get("nodes", []):
            data = node.get("data", {})
            if data.get("type") != "knowledge-index":
                continue
            config = KnowledgeConfiguration.model_validate(data)
            if state is None:
                raise RagPipelinePublicationError("Dataset not found")
            changed = True
            action: Literal["add", "update"] | None = None
            if source.is_published:
                if state.chunk_structure and state.chunk_structure != config.chunk_structure:
                    raise RagPipelinePublicationError("Chunk structure is not allowed to be updated.")
                if state.indexing_technique != config.indexing_technique:
                    if config.indexing_technique == "economy":
                        raise RagPipelinePublicationError(
                            "Knowledge base indexing technique is not allowed to be updated to economy."
                        )
                    action = "add"
                elif config.indexing_technique == "high_quality":
                    current_provider = self._models.provider_id(state.embedding_model_provider)
                    provider = self._models.provider_id(config.embedding_model_provider)
                    if current_provider != provider or state.embedding_model != config.embedding_model:
                        action = "update"
            else:
                state = replace(state, chunk_structure=config.chunk_structure)
            if config.indexing_technique == "high_quality" and (not source.is_published or action is not None):
                resolved = self._models.embedding(
                    context.active_workspace_id,
                    config.embedding_model_provider,
                    config.embedding_model,
                    allow_missing=action == "update",
                )
                if resolved is not None:
                    embedding = resolved
                    state = replace(
                        state,
                        embedding_model_provider=resolved.provider,
                        embedding_model=resolved.name,
                        is_multimodal=resolved.is_multimodal,
                    )
            if config.indexing_technique == "economy":
                state = replace(state, keyword_number=config.keyword_number)
            state = replace(
                state,
                indexing_technique=config.indexing_technique,
                retrieval_model=config.retrieval_model.model_dump(),
                summary_index_setting=(
                    config.summary_index_setting
                    if config.summary_index_setting is not None
                    else state.summary_index_setting
                ),
            )
            if action is not None:
                actions.append(action)
        return PreparedPipelineDataset(state, embedding, tuple(actions)) if changed and state is not None else None
