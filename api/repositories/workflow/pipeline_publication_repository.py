"""Commit a Pipeline version, publication pointer and dataset settings together."""

from uuid import uuid4

from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexTechniqueType
from libs.datetime_utils import naive_utc_now
from machinery.context import RequestContext
from models.dataset import Dataset, Pipeline
from repositories.knowledge.collection_binding_repository import DatasetCollectionBindingRepository
from repositories.knowledge.dataset_read_repository import get_pipeline_dataset
from repositories.workflow.definition_repository import (
    WorkflowDefinitionStore,
    workflow_from_snapshot,
    workflow_snapshot,
)
from services.errors.app import WorkflowHashNotEqualError, WorkflowNotFoundError
from services.rag_pipeline.publication_contracts import (
    PipelineDatasetState,
    PipelinePublicationState,
    PreparedPipelineDataset,
)
from services.workflow.contracts import WorkflowOwner, WorkflowSnapshot


def _dataset_state(dataset: Dataset | None) -> PipelineDatasetState | None:
    if dataset is None:
        return None
    return PipelineDatasetState(
        id=dataset.id,
        chunk_structure=dataset.chunk_structure,
        indexing_technique=dataset.indexing_technique,
        embedding_model_provider=dataset.embedding_model_provider,
        embedding_model=dataset.embedding_model,
        is_multimodal=dataset.is_multimodal,
        keyword_number=dataset.keyword_number,
        retrieval_model=dataset.retrieval_model,
        summary_index_setting=dataset.summary_index_setting,
        collection_binding_id=dataset.collection_binding_id,
    )


class PipelinePublicationRepository:
    def __init__(self, sessions: sessionmaker[Session]) -> None:
        self._sessions = sessions

    def snapshot(self, context: RequestContext, pipeline_id: str) -> PipelinePublicationState:
        with self._sessions() as session:
            pipeline = WorkflowDefinitionStore.owner(session, context, WorkflowOwner(pipeline_id, "pipeline"))
            assert isinstance(pipeline, Pipeline)
            draft = WorkflowDefinitionStore.get_draft_workflow(pipeline, session=session)
            if draft is None:
                raise WorkflowNotFoundError("No valid workflow found.")
            return PipelinePublicationState(
                workflow_snapshot(draft),
                pipeline.is_published,
                pipeline.workflow_id,
                _dataset_state(get_pipeline_dataset(pipeline, session)),
            )

    def publish(
        self, context: RequestContext, source: PipelinePublicationState, prepared: PreparedPipelineDataset | None
    ) -> WorkflowSnapshot:
        with self._sessions.begin() as session:
            pipeline = WorkflowDefinitionStore.owner(
                session, context, WorkflowOwner(source.draft.app_id, "pipeline"), lock=True
            )
            assert isinstance(pipeline, Pipeline)
            draft = WorkflowDefinitionStore.get_draft_workflow(pipeline, session=session, for_update=True)
            dataset = get_pipeline_dataset(pipeline, session, for_update=True)
            if draft is None:
                raise WorkflowNotFoundError("No valid workflow found.")
            current = PipelinePublicationState(
                workflow_snapshot(draft), pipeline.is_published, pipeline.workflow_id, _dataset_state(dataset)
            )
            if current != source:
                raise WorkflowHashNotEqualError()
            if prepared is not None:
                assert dataset is not None
                dataset.chunk_structure = prepared.state.chunk_structure
                dataset.embedding_model_provider = prepared.state.embedding_model_provider
                dataset.embedding_model = prepared.state.embedding_model
                dataset.is_multimodal = prepared.state.is_multimodal
                dataset.keyword_number = prepared.state.keyword_number
                dataset.retrieval_model = prepared.state.retrieval_model
                dataset.summary_index_setting = prepared.state.summary_index_setting
                technique = prepared.state.indexing_technique
                dataset.indexing_technique = IndexTechniqueType(technique) if technique is not None else None
                if prepared.embedding is not None:
                    binding = DatasetCollectionBindingRepository.get_dataset_collection_binding(
                        prepared.embedding.provider, prepared.embedding.name, session
                    )
                    dataset.collection_binding_id = binding.id
            published = workflow_from_snapshot(source.draft)
            published.id = str(uuid4())
            published.version = str(naive_utc_now())
            published.version_number = None
            published.created_by = context.account_id
            published.created_at = naive_utc_now()
            published.updated_by = None
            published.updated_at = published.created_at
            published.marked_name = ""
            published.marked_comment = ""
            session.add(published)
            pipeline.workflow_id = published.id
            pipeline.is_published = True
            session.flush()
            return workflow_snapshot(published)
