from typing import cast

from sqlalchemy.orm import Session

from core.workflow.nodes.knowledge_retrieval.entities import KnowledgeRetrievalNodeData
from events.app_event import app_published_workflow_was_updated
from graphon.nodes import BuiltinNodeTypes
from models.workflow import Workflow
from repositories.knowledge.dataset_read_repository import sync_app_dataset_joins


@app_published_workflow_was_updated.connect
def handle(sender, *, session: Session, **kwargs):
    app = sender
    published_workflow = kwargs.get("published_workflow")
    published_workflow = cast(Workflow, published_workflow)

    dataset_ids = get_dataset_ids_from_workflow(published_workflow)
    sync_app_dataset_joins(
        session,
        tenant_id=app.tenant_id,
        app_id=app.id,
        dataset_ids=dataset_ids,
    )


def get_dataset_ids_from_workflow(published_workflow: Workflow) -> set[str]:
    dataset_ids: set[str] = set()
    graph = published_workflow.graph_dict
    if not graph:
        return dataset_ids

    nodes = graph.get("nodes", [])

    # fetch all knowledge retrieval nodes
    knowledge_retrieval_nodes = [
        node for node in nodes if node.get("data", {}).get("type") == BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL
    ]

    if not knowledge_retrieval_nodes:
        return dataset_ids

    for node in knowledge_retrieval_nodes:
        try:
            node_data = KnowledgeRetrievalNodeData.model_validate(node.get("data", {}))
            dataset_ids.update(dataset_id for dataset_id in node_data.dataset_ids)
        except Exception:
            continue

    return dataset_ids
