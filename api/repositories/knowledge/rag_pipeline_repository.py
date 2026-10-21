"""Persistence owner for RAG pipeline aggregate state."""

import copy
import json
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from libs.datetime_utils import naive_utc_now
from models import Account
from models.dataset import Dataset, Document, DocumentPipelineExecutionLog, Pipeline
from models.workflow import Workflow
from repositories.knowledge.pipeline_query_repository import get_pipeline_dataset
from repositories.knowledge.upload_file_repository import replace_document_upload_file_references


@dataclass(frozen=True, slots=True)
class PipelineRetryState:
    pipeline: Pipeline
    workflow: Workflow
    datasource_type: str
    datasource_info: Mapping[str, object]
    datasource_node_id: str
    input_data: Mapping[str, object]


@dataclass(frozen=True, slots=True)
class PipelinePublicationState:
    pipeline: Pipeline
    dataset: Dataset
    draft: Workflow


def _lock_dataset(session: Session, *, tenant_id: str, dataset_id: str) -> Dataset | None:
    """Use the Dataset parent lock before pipeline-owned child mutations."""

    return session.scalar(
        select(Dataset)
        .where(Dataset.id == dataset_id, Dataset.tenant_id == tenant_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )


def _project_dataset_settings_to_graph(graph: str, dataset: Dataset) -> str:
    graph_data = json.loads(graph)
    nodes = graph_data.get("nodes")
    if not isinstance(nodes, list):
        return graph

    settings: dict[str, object] = {
        "embedding_model": dataset.embedding_model,
        "embedding_model_provider": dataset.embedding_model_provider,
        "retrieval_model": dataset.retrieval_model,
        "chunk_structure": dataset.chunk_structure,
        "indexing_technique": dataset.indexing_technique,
        "keyword_number": dataset.keyword_number,
        "summary_index_setting": dataset.summary_index_setting,
    }
    changed = False
    for node in nodes:
        if not isinstance(node, dict):
            continue
        node_data = node.get("data")
        if not isinstance(node_data, dict) or node_data.get("type") != "knowledge-index":
            continue
        for key, value in settings.items():
            if node_data.get(key) == value:
                continue
            node_data[key] = copy.deepcopy(value)
            changed = True

    return json.dumps(graph_data, ensure_ascii=False) if changed else graph


class SQLAlchemyRagPipelineDatasetProjectionWriter:
    """Stage dataset settings into the pipeline's workflow projection."""

    def stage_dataset_settings(self, session: Session, *, dataset: Dataset, actor_id: str) -> None:
        if not dataset.pipeline_id:
            return
        pipeline = session.scalar(
            select(Pipeline)
            .where(Pipeline.id == dataset.pipeline_id, Pipeline.tenant_id == dataset.tenant_id)
            .with_for_update()
        )
        if pipeline is None:
            return

        workflow_conditions = [Workflow.version == Workflow.VERSION_DRAFT]
        if pipeline.workflow_id:
            workflow_conditions.append(Workflow.id == pipeline.workflow_id)
        workflows = session.scalars(
            select(Workflow)
            .where(
                Workflow.tenant_id == pipeline.tenant_id,
                Workflow.app_id == pipeline.id,
                or_(*workflow_conditions),
            )
            .order_by(Workflow.id)
            .with_for_update()
        ).all()
        draft = next((item for item in workflows if item.version == Workflow.VERSION_DRAFT), None)
        published = next(
            (item for item in workflows if item.id == pipeline.workflow_id and item.version != Workflow.VERSION_DRAFT),
            None,
        )

        if published is not None:
            published_graph = _project_dataset_settings_to_graph(published.graph, dataset)
            if published_graph != published.graph:
                published_copy = Workflow(
                    tenant_id=published.tenant_id,
                    app_id=published.app_id,
                    type=published.type,
                    kind=published.kind,
                    version=Workflow.version_from_datetime(naive_utc_now()),
                    graph=published_graph,
                    features=published.serialized_features,
                    created_by=actor_id,
                    marked_name="",
                    marked_comment="",
                )
                published_copy.copy_serialized_variable_storage_from(published)
                session.add(published_copy)
                session.flush()
                pipeline.workflow_id = published_copy.id

        if draft is not None:
            draft_graph = _project_dataset_settings_to_graph(draft.graph, dataset)
            if draft_graph != draft.graph:
                draft.graph = draft_graph
                draft.updated_by = actor_id
                draft.updated_at = naive_utc_now()


class SQLAlchemyRagPipelineRepository:
    """Own Pipeline, its Workflow versions, and pipeline execution-log SQL."""

    @staticmethod
    def get_actor(session: Session, *, tenant_id: str, actor_id: str) -> Account | None:
        account = session.get(Account, actor_id)
        if account is None:
            return None
        account.set_tenant_id_with_session(tenant_id, session=session)
        return account

    @staticmethod
    def get_pipeline(session: Session, *, tenant_id: str, pipeline_id: str) -> Pipeline | None:
        return session.scalar(
            select(Pipeline).where(Pipeline.id == pipeline_id, Pipeline.tenant_id == tenant_id).limit(1)
        )

    @staticmethod
    def get_pipeline_for_dataset(session: Session, *, tenant_id: str, dataset_id: str) -> Pipeline:
        dataset = session.scalar(
            select(Dataset).where(Dataset.id == dataset_id, Dataset.tenant_id == tenant_id).limit(1)
        )
        if dataset is None:
            raise ValueError("Dataset not found")
        if dataset.pipeline_id is None:
            raise ValueError("Pipeline not found")
        pipeline = SQLAlchemyRagPipelineRepository.get_pipeline(
            session,
            tenant_id=tenant_id,
            pipeline_id=dataset.pipeline_id,
        )
        if pipeline is None:
            raise ValueError("Pipeline not found")
        return pipeline

    @staticmethod
    def get_workflow(session: Session, *, pipeline: Pipeline, published: bool) -> Workflow | None:
        if published:
            if pipeline.workflow_id is None:
                return None
            return session.scalar(
                select(Workflow)
                .where(
                    Workflow.tenant_id == pipeline.tenant_id,
                    Workflow.app_id == pipeline.id,
                    Workflow.id == pipeline.workflow_id,
                )
                .limit(1)
            )
        return session.scalar(
            select(Workflow)
            .where(
                Workflow.tenant_id == pipeline.tenant_id,
                Workflow.app_id == pipeline.id,
                Workflow.version == Workflow.VERSION_DRAFT,
            )
            .limit(1)
        )

    @staticmethod
    def get_pipeline_dataset_id(session: Session, *, tenant_id: str, pipeline_id: str) -> str | None:
        return session.scalar(
            select(Dataset.id).where(Dataset.tenant_id == tenant_id, Dataset.pipeline_id == pipeline_id).limit(1)
        )

    def get_retry_state(
        self,
        session: Session,
        *,
        tenant_id: str,
        dataset_id: str,
        document_id: str,
        indexing_generation: str,
    ) -> PipelineRetryState | None:
        execution_log = session.scalar(
            select(DocumentPipelineExecutionLog)
            .join(Document, Document.id == DocumentPipelineExecutionLog.document_id)
            .where(
                Document.tenant_id == tenant_id,
                Document.dataset_id == dataset_id,
                Document.id == document_id,
                Document.indexing_generation == indexing_generation,
                DocumentPipelineExecutionLog.document_id == document_id,
                DocumentPipelineExecutionLog.indexing_generation == indexing_generation,
            )
            .order_by(DocumentPipelineExecutionLog.created_at.desc(), DocumentPipelineExecutionLog.id.desc())
            .limit(1)
        )
        if execution_log is None:
            return None
        pipeline = session.get(Pipeline, execution_log.pipeline_id)
        if pipeline is None:
            raise ValueError("Pipeline not found")
        workflow = self.get_workflow(session, pipeline=pipeline, published=True)
        if workflow is None:
            raise ValueError("Workflow not published")
        datasource_info = json.loads(execution_log.datasource_info)
        if not isinstance(datasource_info, Mapping):
            raise ValueError("Invalid datasource info in pipeline execution log")
        return PipelineRetryState(
            pipeline=pipeline,
            workflow=workflow,
            datasource_type=execution_log.datasource_type,
            datasource_info=datasource_info,
            datasource_node_id=execution_log.datasource_node_id,
            input_data=execution_log.input_data,
        )

    @staticmethod
    def copy_document_pipeline_execution_binding(
        session: Session,
        *,
        tenant_id: str,
        dataset_id: str,
        document_id: str,
        source_generation: str | None,
        target_generation: str,
    ) -> bool:
        """Carry exact source input to a successor generation under the caller's document lock."""

        generation_condition = (
            DocumentPipelineExecutionLog.indexing_generation.is_(None)
            if source_generation is None
            else DocumentPipelineExecutionLog.indexing_generation == source_generation
        )
        owner_conditions = (
            Document.id == document_id,
            Document.tenant_id == tenant_id,
            Document.dataset_id == dataset_id,
            DocumentPipelineExecutionLog.document_id == Document.id,
        )
        target_exists = session.scalar(
            select(DocumentPipelineExecutionLog.id)
            .join(Document, Document.id == DocumentPipelineExecutionLog.document_id)
            .where(
                *owner_conditions,
                DocumentPipelineExecutionLog.indexing_generation == target_generation,
            )
            .limit(1)
        )
        if target_exists is not None:
            return False
        source = session.scalar(
            select(DocumentPipelineExecutionLog)
            .join(Document, Document.id == DocumentPipelineExecutionLog.document_id)
            .where(*owner_conditions, generation_condition)
            .order_by(DocumentPipelineExecutionLog.created_at.desc(), DocumentPipelineExecutionLog.id.desc())
            .limit(1)
        )
        if source is None:
            return False
        session.add(
            DocumentPipelineExecutionLog(
                pipeline_id=source.pipeline_id,
                document_id=source.document_id,
                indexing_generation=target_generation,
                datasource_type=source.datasource_type,
                datasource_info=source.datasource_info,
                datasource_node_id=source.datasource_node_id,
                input_data=copy.deepcopy(source.input_data),
                created_by=source.created_by,
            )
        )
        session.flush()
        return True

    @staticmethod
    def lock_pipeline_dataset(session: Session, *, pipeline: Pipeline) -> Dataset | None:
        return session.scalar(
            select(Dataset)
            .where(Dataset.pipeline_id == pipeline.id, Dataset.tenant_id == pipeline.tenant_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )

    @staticmethod
    def next_document_position(session: Session, *, dataset: Dataset) -> int:
        # Use a locking current read after taking the Dataset parent lock. This
        # sees the previous writer's commit even when an older MySQL
        # REPEATABLE READ snapshot already exists in the preparation session.
        position = session.scalar(
            select(Document.position)
            .where(Document.tenant_id == dataset.tenant_id, Document.dataset_id == dataset.id)
            .order_by(Document.position.desc())
            .limit(1)
            .with_for_update()
        )
        return int(position) + 1 if position is not None else 1

    @staticmethod
    def persist_documents(
        session: Session,
        *,
        dataset: Dataset,
        documents: Sequence[Document],
        datasource_type: str,
        datasource_info_list: Sequence[Mapping[str, object]],
    ) -> None:
        session.add_all(documents)
        session.flush()
        for document, datasource_info in zip(documents, datasource_info_list, strict=True):
            replace_document_upload_file_references(
                session,
                tenant_id=dataset.tenant_id,
                dataset_id=dataset.id,
                document_id=document.id,
                data_source_type=datasource_type,
                data_source_info=datasource_info,
            )

    @staticmethod
    def stage_execution_log(
        session: Session,
        *,
        pipeline_id: str,
        tenant_id: str,
        dataset_id: str,
        document_id: str,
        indexing_generation: str,
        datasource_type: str,
        datasource_info: Mapping[str, object],
        datasource_node_id: str,
        input_data: Mapping[str, object],
        actor_id: str,
    ) -> None:
        document_exists = session.scalar(
            select(Document.id)
            .where(
                Document.tenant_id == tenant_id,
                Document.dataset_id == dataset_id,
                Document.id == document_id,
                Document.indexing_generation == indexing_generation,
            )
            .limit(1)
        )
        if document_exists is None:
            raise ValueError("Pipeline document generation is no longer current")
        session.add(
            DocumentPipelineExecutionLog(
                document_id=document_id,
                indexing_generation=indexing_generation,
                datasource_type=datasource_type,
                datasource_info=json.dumps(datasource_info),
                datasource_node_id=datasource_node_id,
                input_data=dict(input_data),
                pipeline_id=pipeline_id,
                created_by=actor_id,
            )
        )

    def get_publication_state(
        self,
        session: Session,
        *,
        tenant_id: str,
        pipeline_id: str,
    ) -> PipelinePublicationState | None:
        pipeline = self.get_pipeline(session, tenant_id=tenant_id, pipeline_id=pipeline_id)
        if pipeline is None:
            return None
        dataset = get_pipeline_dataset(pipeline, session)
        if dataset is None:
            return None
        draft = self.get_workflow(session, pipeline=pipeline, published=False)
        if draft is None:
            raise ValueError("No valid workflow found.")
        return PipelinePublicationState(pipeline=pipeline, dataset=dataset, draft=draft)

    @staticmethod
    def lock_publication_state(
        session: Session,
        *,
        tenant_id: str,
        pipeline_id: str,
        dataset_id: str,
        workflow_id: str,
        workflow_hash: str,
        workflow_matches: Callable[[Workflow], bool],
    ) -> PipelinePublicationState | None:
        dataset = _lock_dataset(session, tenant_id=tenant_id, dataset_id=dataset_id)
        if dataset is None:
            return None
        pipeline = session.scalar(
            select(Pipeline).where(Pipeline.id == pipeline_id, Pipeline.tenant_id == tenant_id).with_for_update()
        )
        if pipeline is None or dataset.pipeline_id != pipeline.id:
            return None
        draft = session.scalar(
            select(Workflow)
            .where(
                Workflow.id == workflow_id,
                Workflow.tenant_id == tenant_id,
                Workflow.app_id == pipeline.id,
                Workflow.version == Workflow.VERSION_DRAFT,
            )
            .with_for_update()
        )
        if draft is None or draft.unique_hash != workflow_hash or not workflow_matches(draft):
            raise ValueError("Workflow changed while publication was being prepared")
        return PipelinePublicationState(pipeline=pipeline, dataset=dataset, draft=draft)

    @staticmethod
    def stage_publication(
        session: Session,
        *,
        state: PipelinePublicationState,
        actor_id: str,
    ) -> Workflow:
        draft = state.draft
        workflow = Workflow.new(
            tenant_id=state.pipeline.tenant_id,
            app_id=state.pipeline.id,
            type=draft.type,
            version=Workflow.version_from_datetime(naive_utc_now()),
            graph=draft.graph,
            features=draft.features,
            created_by=actor_id,
            environment_variables=draft.environment_variables,
            conversation_variables=draft.conversation_variables,
            rag_pipeline_variables=draft.rag_pipeline_variables,
            marked_name="",
            marked_comment="",
        )
        session.add(workflow)
        session.flush()
        state.pipeline.is_published = True
        state.pipeline.workflow_id = workflow.id
        return workflow
