"""Persistence owner for RAG pipeline aggregate state."""

import copy
import json

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from libs.datetime_utils import naive_utc_now
from models.dataset import Dataset, Pipeline
from models.workflow import Workflow


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
