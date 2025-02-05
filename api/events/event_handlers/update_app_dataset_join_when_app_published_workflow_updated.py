from typing import cast

from core.workflow.nodes import NodeType
from core.workflow.nodes.knowledge_retrieval.entities import KnowledgeRetrievalNodeData
from events.app_event import app_published_workflow_was_updated
from extensions.ext_database import db
from models.dataset import AppDatasetJoin
from models.workflow import Workflow


@app_published_workflow_was_updated.connect
def handle(sender, **kwargs):
    app = sender
    published_workflow = kwargs.get("published_workflow")
    published_workflow = cast(Workflow, published_workflow)

    dataset_ids = get_dataset_ids_from_workflow(published_workflow)
    app_dataset_joins = db.session.query(AppDatasetJoin).filter(AppDatasetJoin.app_id == app.id).all()

    removed_dataset_ids: set[str] = set()
    if not app_dataset_joins:
        added_dataset_ids = dataset_ids
    else:
        old_dataset_ids: set[str] = set()
        old_dataset_ids.update(app_dataset_join.dataset_id for app_dataset_join in app_dataset_joins)

        added_dataset_ids = dataset_ids - old_dataset_ids
        removed_dataset_ids = old_dataset_ids - dataset_ids

    if removed_dataset_ids:
        for dataset_id in removed_dataset_ids:
            db.session.query(AppDatasetJoin).filter(
                AppDatasetJoin.app_id == app.id, AppDatasetJoin.dataset_id == dataset_id
            ).delete()

    if added_dataset_ids:
        for dataset_id in added_dataset_ids:
            app_dataset_join = AppDatasetJoin(app_id=app.id, dataset_id=dataset_id)
            db.session.add(app_dataset_join)

    db.session.commit()


def get_dataset_ids_from_workflow(published_workflow: Workflow) -> set[str]:
    dataset_ids: set[str] = set()
    graph = published_workflow.graph_dict
    if not graph:
        return dataset_ids

    nodes = graph.get("nodes", [])

    # fetch all knowledge retrieval nodes
    knowledge_retrieval_nodes = [
        node for node in nodes if node.get("data", {}).get("type") == NodeType.KNOWLEDGE_RETRIEVAL.value
    ]

    if not knowledge_retrieval_nodes:
        return dataset_ids

    for node in knowledge_retrieval_nodes:
        try:
            node_data = KnowledgeRetrievalNodeData(**node.get("data", {}))
            dataset_ids.update(dataset_id for dataset_id in node_data.dataset_ids)
        except Exception as e:
            continue

    return dataset_ids
