import datetime
import logging
import time
import uuid
from typing import cast

import click
from celery import shared_task
from sqlalchemy import func

from core.indexing_runner import IndexingRunner
from core.model_manager import ModelManager
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.model_providers.__base.text_embedding_model import TextEmbeddingModel
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from libs import helper
from models.dataset import Dataset, Document, DocumentSegment


@shared_task(queue='dataset')
def batch_create_segment_to_index_task(job_id: str, content: list, dataset_id: str, document_id: str,
                                       tenant_id: str, user_id: str):
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
    logging.info(click.style('Start batch create segment jobId: {}'.format(job_id), fg='green'))
    start_at = time.perf_counter()

    indexing_cache_key = 'segment_batch_import_{}'.format(job_id)

    try:
        dataset = db.session.query(Dataset).filter(Dataset.id == dataset_id).first()
        if not dataset:
            raise ValueError('Dataset not exist.')

        dataset_document = db.session.query(Document).filter(Document.id == document_id).first()
        if not dataset_document:
            raise ValueError('Document not exist.')

        if not dataset_document.enabled or dataset_document.archived or dataset_document.indexing_status != 'completed':
            raise ValueError('Document is not available.')
        document_segments = []
        embedding_model = None
        if dataset.indexing_technique == 'high_quality':
            model_manager = ModelManager()
            embedding_model = model_manager.get_model_instance(
                tenant_id=dataset.tenant_id,
                provider=dataset.embedding_model_provider,
                model_type=ModelType.TEXT_EMBEDDING,
                model=dataset.embedding_model
            )

        model_type_instance = embedding_model.model_type_instance
        model_type_instance = cast(TextEmbeddingModel, model_type_instance)
        for segment in content:
            content = segment['content']
            doc_id = str(uuid.uuid4())
            segment_hash = helper.generate_text_hash(content)
            # calc embedding use tokens
            tokens = model_type_instance.get_num_tokens(
                model=embedding_model.model,
                credentials=embedding_model.credentials,
                texts=[content]
            ) if embedding_model else 0
            max_position = db.session.query(func.max(DocumentSegment.position)).filter(
                DocumentSegment.document_id == dataset_document.id
            ).scalar()
            segment_document = DocumentSegment(
                tenant_id=tenant_id,
                dataset_id=dataset_id,
                document_id=document_id,
                index_node_id=doc_id,
                index_node_hash=segment_hash,
                position=max_position + 1 if max_position else 1,
                content=content,
                word_count=len(content),
                tokens=tokens,
                created_by=user_id,
                indexing_at=datetime.datetime.utcnow(),
                status='completed',
                completed_at=datetime.datetime.utcnow()
            )
            if dataset_document.doc_form == 'qa_model':
                segment_document.answer = segment['answer']
            db.session.add(segment_document)
            document_segments.append(segment_document)
        # add index to db
        indexing_runner = IndexingRunner()
        indexing_runner.batch_add_segments(document_segments, dataset)
        db.session.commit()
        redis_client.setex(indexing_cache_key, 600, 'completed')
        end_at = time.perf_counter()
        logging.info(click.style('Segment batch created job: {} latency: {}'.format(job_id, end_at - start_at), fg='green'))
    except Exception as e:
        logging.exception("Segments batch created index failed:{}".format(str(e)))
        redis_client.setex(indexing_cache_key, 600, 'error')
