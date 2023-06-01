import logging
import time

import click
from celery import shared_task
from llama_index.data_structs.node_v2 import DocumentRelationship, Node
from core.index.vector_index import VectorIndex
from extensions.ext_database import db
from models.dataset import DocumentSegment, Document, Dataset


@shared_task
def deal_dataset_vector_index_task(dataset_id: str, action: str):
    """
    Async deal dataset from index
    :param dataset_id: dataset_id
    :param action: action
    Usage: deal_dataset_vector_index_task.delay(dataset_id, action)
    """
    logging.info(click.style('Start deal dataset vector index: {}'.format(dataset_id), fg='green'))
    start_at = time.perf_counter()

    try:
        dataset = Dataset.query.filter_by(
            id=dataset_id
        ).first()
        if not dataset:
            raise Exception('Dataset not found')
        documents = Document.query.filter_by(dataset_id=dataset_id).all()
        if documents:
            vector_index = VectorIndex(dataset=dataset)
            for document in documents:
                # delete from vector index
                if action == "remove":
                    vector_index.del_doc(document.id)
                elif action == "add":
                    segments = db.session.query(DocumentSegment).filter(
                        DocumentSegment.document_id == document.id,
                        DocumentSegment.enabled == True
                    ) .order_by(DocumentSegment.position.asc()).all()

                    nodes = []
                    previous_node = None
                    for segment in segments:
                        relationships = {
                            DocumentRelationship.SOURCE: document.id
                        }

                        if previous_node:
                            relationships[DocumentRelationship.PREVIOUS] = previous_node.doc_id

                            previous_node.relationships[DocumentRelationship.NEXT] = segment.index_node_id

                        node = Node(
                            doc_id=segment.index_node_id,
                            doc_hash=segment.index_node_hash,
                            text=segment.content,
                            extra_info=None,
                            node_info=None,
                            relationships=relationships
                        )

                        previous_node = node
                        nodes.append(node)
                    # save vector index
                    vector_index.add_nodes(
                        nodes=nodes,
                        duplicate_check=True
                    )

        end_at = time.perf_counter()
        logging.info(
            click.style('Deal dataset vector index: {} latency: {}'.format(dataset_id, end_at - start_at), fg='green'))
    except Exception:
        logging.exception("Deal dataset vector index failed")
