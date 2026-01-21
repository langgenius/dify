import logging
import tempfile
import time
import uuid
from pathlib import Path

import click
import pandas as pd
from celery import shared_task
from sqlalchemy import func

from core.db.session_factory import session_factory
from core.model_manager import ModelManager
from core.model_runtime.entities.model_entities import ModelType
from extensions.ext_redis import redis_client
from extensions.ext_storage import storage
from libs import helper
from libs.datetime_utils import naive_utc_now
from models.dataset import Dataset, Document, DocumentSegment
from models.model import UploadFile
from services.vector_service import VectorService

logger = logging.getLogger(__name__)


@shared_task(queue="dataset")
def batch_create_segment_to_index_task(
    job_id: str,
    upload_file_id: str,
    dataset_id: str,
    document_id: str,
    tenant_id: str,
    user_id: str,
):
    """
    Async batch create segment to index
    :param job_id:
    :param upload_file_id:
    :param dataset_id:
    :param document_id:
    :param tenant_id:
    :param user_id:

    Usage: batch_create_segment_to_index_task.delay(job_id, upload_file_id, dataset_id, document_id, tenant_id, user_id)
    """
    logger.info(click.style(f"Start batch create segment jobId: {job_id}", fg="green"))
    start_at = time.perf_counter()

    indexing_cache_key = f"segment_batch_import_{job_id}"

    with session_factory.create_session() as session:
        try:
            dataset = session.get(Dataset, dataset_id)
            if not dataset:
                raise ValueError("Dataset not exist.")

            dataset_document = session.get(Document, document_id)
            if not dataset_document:
                raise ValueError("Document not exist.")

            if (
                not dataset_document.enabled
                or dataset_document.archived
                or dataset_document.indexing_status != "completed"
            ):
                raise ValueError("Document is not available.")

            upload_file = session.get(UploadFile, upload_file_id)
            if not upload_file:
                raise ValueError("UploadFile not found.")

            with tempfile.TemporaryDirectory() as temp_dir:
                suffix = Path(upload_file.key).suffix
                file_path = f"{temp_dir}/{next(tempfile._get_candidate_names())}{suffix}"  # type: ignore
                storage.download(upload_file.key, file_path)

                df = pd.read_csv(file_path)
                content = []
                for _, row in df.iterrows():
                    if dataset_document.doc_form == "qa_model":
                        data = {"content": row.iloc[0], "answer": row.iloc[1]}
                    else:
                        data = {"content": row.iloc[0]}
                    content.append(data)
                if len(content) == 0:
                    raise ValueError("The CSV file is empty.")

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
            if embedding_model:
                tokens_list = embedding_model.get_text_embedding_num_tokens(
                    texts=[segment["content"] for segment in content]
                )
            else:
                tokens_list = [0] * len(content)

            for segment, tokens in zip(content, tokens_list):
                content = segment["content"]
                doc_id = str(uuid.uuid4())
                segment_hash = helper.generate_text_hash(content)
                max_position = (
                    session.query(func.max(DocumentSegment.position))
                    .where(DocumentSegment.document_id == dataset_document.id)
                    .scalar()
                )
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
                    indexing_at=naive_utc_now(),
                    status="completed",
                    completed_at=naive_utc_now(),
                )
                if dataset_document.doc_form == "qa_model":
                    segment_document.answer = segment["answer"]
                    segment_document.word_count += len(segment["answer"])
                word_count_change += segment_document.word_count
                session.add(segment_document)
                document_segments.append(segment_document)

            assert dataset_document.word_count is not None
            dataset_document.word_count += word_count_change
            session.add(dataset_document)

            VectorService.create_segments_vector(None, document_segments, dataset, dataset_document.doc_form)
            session.commit()
            redis_client.setex(indexing_cache_key, 600, "completed")
            end_at = time.perf_counter()
            logger.info(
                click.style(
                    f"Segment batch created job: {job_id} latency: {end_at - start_at}",
                    fg="green",
                )
            )
        except Exception:
            logger.exception("Segments batch created index failed")
            redis_client.setex(indexing_cache_key, 600, "error")
