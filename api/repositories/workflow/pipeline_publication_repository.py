"""Commit a Pipeline version, publication pointer and dataset settings together."""

from dataclasses import fields
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
    return PipelineDatasetState(**{field.name: getattr(dataset, field.name) for field in fields(PipelineDatasetState)})


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
                for field in fields(PipelineDatasetState):
                    if field.name not in {"id", "collection_binding_id", "indexing_technique"}:
                        setattr(dataset, field.name, getattr(prepared.state, field.name))
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
