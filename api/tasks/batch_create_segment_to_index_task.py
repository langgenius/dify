import datetime
import logging
import time
import uuid

import click
from celery import shared_task  # type: ignore
from sqlalchemy import func

from core.model_manager import ModelManager
from core.model_runtime.entities.model_entities import ModelType
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from libs import helper
from models.dataset import Dataset, Document, DocumentSegment
from services.vector_service import VectorService


@shared_task(queue="dataset")
def batch_create_segment_to_index_task(
    job_id: str, content: list, dataset_id: str, document_id: str, tenant_id: str, user_id: str
):
    """
    Async batch create segment to index
    :param job_id:
    :param content:
    :param dataset_id:
    :param document_id:
    :param tenant_id:
    :param user_id:

    Usage: batch_create_segment_to_index_task.delay(segment_id)
    """
    logging.info(click.style("Start batch create segment jobId: {}".format(job_id), fg="green"))
    start_at = time.perf_counter()

    indexing_cache_key = "segment_batch_import_{}".format(job_id)

    try:
        dataset = db.session.query(Dataset).filter(Dataset.id == dataset_id).first()
        if not dataset:
            raise ValueError("Dataset not exist.")

        dataset_document = db.session.query(Document).filter(Document.id == document_id).first()
        if not dataset_document:
            raise ValueError("Document not exist.")

        if not dataset_document.enabled or dataset_document.archived or dataset_document.indexing_status != "completed":
            raise ValueError("Document is not available.")
        document_segments = []
        embedding_model = None
        if dataset.indexing_technique == "high_quality":
            model_manager = ModelManager()
            embedding_model = model_manager.get_model_instance(
                tenant_id=dataset.tenant_id,
                provider=dataset.embedding_model_provider,
                model_type=ModelType.TEXT_EMBEDDING,
                model=dataset.embedding_model,
            )
        word_count_change = 0
        segments_to_insert: list[str] = []  # Explicitly type hint the list as List[str]
        for segment in content:
            content_str = segment["content"]
            doc_id = str(uuid.uuid4())
            segment_hash = helper.generate_text_hash(content_str)
            # calc embedding use tokens
            tokens = embedding_model.get_text_embedding_num_tokens(texts=[content_str]) if embedding_model else 0
            max_position = (
                db.session.query(func.max(DocumentSegment.position))
                .filter(DocumentSegment.document_id == dataset_document.id)
                .scalar()
            )
            segment_document = DocumentSegment(
                tenant_id=tenant_id,
                dataset_id=dataset_id,
                document_id=document_id,
                index_node_id=doc_id,
                index_node_hash=segment_hash,
                position=max_position + 1 if max_position else 1,
                content=content_str,
                word_count=len(content_str),
                tokens=tokens,
                created_by=user_id,
                indexing_at=datetime.datetime.now(datetime.UTC).replace(tzinfo=None),
                status="completed",
                completed_at=datetime.datetime.now(datetime.UTC).replace(tzinfo=None),
            )
            if dataset_document.doc_form == "qa_model":
                segment_document.answer = segment["answer"]
                segment_document.word_count += len(segment["answer"])
            word_count_change += segment_document.word_count
            db.session.add(segment_document)
            document_segments.append(segment_document)
            segments_to_insert.append(str(segment))  # Cast to string if needed
        # update document word count
        dataset_document.word_count += word_count_change
        db.session.add(dataset_document)
        # add index to db
        VectorService.create_segments_vector(None, document_segments, dataset, dataset_document.doc_form)
        db.session.commit()
        redis_client.setex(indexing_cache_key, 600, "completed")
        end_at = time.perf_counter()
        logging.info(
            click.style("Segment batch created job: {} latency: {}".format(job_id, end_at - start_at), fg="green")
        )
    except Exception as e:
        logging.exception("Segments batch created index failed")
        redis_client.setex(indexing_cache_key, 600, "error")
