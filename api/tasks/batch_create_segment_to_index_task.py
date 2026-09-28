import csv
import logging
import tempfile
import time
import uuid
from collections.abc import Iterator
from itertools import islice
from pathlib import Path
from typing import Any, cast

import click
import pandas as pd
from celery import shared_task
from sqlalchemy import func, select

from core.credit_usage import CreditUsageCreatedBy
from core.db.session_factory import session_factory
from core.model_context import with_credit_usage_created_by
from core.model_manager import ModelManager
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from extensions.ext_redis import redis_client
from extensions.ext_storage import storage
from graphon.model_runtime.entities.model_entities import ModelType
from libs import helper
from libs.datetime_utils import naive_utc_now
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import SegmentStatus
from models.model import UploadFile
from services.vector_service import VectorService

logger = logging.getLogger(__name__)

SEGMENT_BATCH_SIZE = 1000


def _iter_segment_id_batches(segment_ids_path: Path) -> Iterator[list[str]]:
    with segment_ids_path.open(encoding="utf-8") as segment_ids_file:
        while lines := list(islice(segment_ids_file, SEGMENT_BATCH_SIZE)):
            yield [line.rstrip("\n") for line in lines]


@shared_task(queue="dataset")
@with_credit_usage_created_by(CreditUsageCreatedBy.KNOWLEDGE_INDEXING)
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

    # Initialize variables with default values
    upload_file_key: str | None = None
    dataset_config: dict[str, Any] | None = None
    document_config: dict[str, Any] | None = None

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

            dataset_config = {
                "id": dataset.id,
                "indexing_technique": dataset.indexing_technique,
                "tenant_id": dataset.tenant_id,
                "embedding_model_provider": dataset.embedding_model_provider,
                "embedding_model": dataset.embedding_model,
            }

            document_config = {
                "id": dataset_document.id,
                "doc_form": dataset_document.doc_form,
                "word_count": dataset_document.word_count or 0,
            }

            upload_file_key = upload_file.key

        except Exception:
            logger.exception("Segments batch created index failed")
            redis_client.setex(indexing_cache_key, 600, "error")
            return

    # Ensure required variables are set before proceeding
    if upload_file_key is None or dataset_config is None or document_config is None:
        logger.error("Required configuration not set due to session error")
        redis_client.setex(indexing_cache_key, 600, "error")
        return

    with tempfile.TemporaryDirectory() as temp_dir:
        suffix = Path(upload_file_key).suffix
        file_path = f"{temp_dir}/{next(tempfile._get_candidate_names())}{suffix}"  # type: ignore
        storage.download(upload_file_key, file_path)

        embedding_model = None
        if dataset_config["indexing_technique"] == IndexTechniqueType.HIGH_QUALITY:
            model_manager = ModelManager.for_tenant(tenant_id=dataset_config["tenant_id"])
            embedding_model = model_manager.get_model_instance(
                tenant_id=dataset_config["tenant_id"],
                provider=dataset_config["embedding_model_provider"],
                model_type=ModelType.TEXT_EMBEDDING,
                model=dataset_config["embedding_model"],
            )

        normalized_segments_path = Path(temp_dir) / "normalized_segments.csv"
        segment_count = 0
        with (
            normalized_segments_path.open("w", encoding="utf-8", newline="") as normalized_segments_file,
            pd.read_csv(
                file_path,
                dtype=str,
                keep_default_na=False,
                chunksize=SEGMENT_BATCH_SIZE,
            ) as csv_reader,
        ):
            normalized_segments_writer = csv.writer(normalized_segments_file)
            for csv_chunk in csv_reader:
                rows = list(csv_chunk.itertuples(index=False, name=None))
                if not rows:
                    continue

                texts = [row[0] for row in rows]
                if embedding_model:
                    tokens_list = embedding_model.get_text_embedding_num_tokens(texts=texts)
                else:
                    tokens_list = [0] * len(rows)
                if len(tokens_list) != len(rows):
                    raise ValueError("Token counter returned an unexpected number of results.")

                for row, token_count in zip(rows, tokens_list):
                    answer = row[1] if document_config["doc_form"] == IndexStructureType.QA_INDEX else ""
                    normalized_segments_writer.writerow((row[0], answer, token_count))
                segment_count += len(rows)

        if segment_count == 0:
            raise ValueError("The CSV file is empty.")

        segment_ids_path = Path(temp_dir) / "segment_ids"
        word_count_change = 0
        with (
            segment_ids_path.open("w", encoding="utf-8") as segment_ids_file,
            normalized_segments_path.open(encoding="utf-8", newline="") as normalized_segments_file,
            session_factory.create_session() as session,
            session.begin(),
        ):
            max_position = (
                session.scalar(
                    select(func.max(DocumentSegment.position)).where(
                        DocumentSegment.document_id == document_config["id"]
                    )
                )
                or 0
            )
            normalized_segments_reader = cast(Iterator[list[str]], csv.reader(normalized_segments_file))
            while serialized_rows := list(islice(normalized_segments_reader, SEGMENT_BATCH_SIZE)):
                document_segments: list[DocumentSegment] = []
                for content, answer, serialized_token_count in serialized_rows:
                    index_node_id = str(uuid.uuid4())
                    max_position += 1
                    segment_document = DocumentSegment(
                        tenant_id=tenant_id,
                        dataset_id=dataset_id,
                        document_id=document_id,
                        index_node_id=index_node_id,
                        index_node_hash=helper.generate_text_hash(content),
                        position=max_position,
                        content=content,
                        word_count=len(content),
                        tokens=int(serialized_token_count),
                        created_by=user_id,
                        indexing_at=naive_utc_now(),
                        status=SegmentStatus.COMPLETED,
                        completed_at=naive_utc_now(),
                    )
                    if document_config["doc_form"] == IndexStructureType.QA_INDEX:
                        segment_document.answer = answer
                        segment_document.word_count += len(answer)

                    word_count_change += segment_document.word_count
                    document_segments.append(segment_document)

                session.add_all(document_segments)
                session.flush()
                for segment_document in document_segments:
                    segment_ids_file.write(f"{segment_document.id}\n")
                    session.expunge(segment_document)

            dataset_document = session.get(Document, document_id)
            if dataset_document:
                assert dataset_document.word_count is not None
                dataset_document.word_count += word_count_change
                session.add(dataset_document)

        for segment_ids in _iter_segment_id_batches(segment_ids_path):
            with session_factory.create_session() as session, session.begin():
                dataset = session.get(Dataset, dataset_id)
                if not dataset:
                    continue

                segments = session.scalars(select(DocumentSegment).where(DocumentSegment.id.in_(segment_ids))).all()
                segments_by_id = {segment.id: segment for segment in segments}
                document_segments = [segments_by_id[segment_id] for segment_id in segment_ids]
                VectorService.create_segments_vector(
                    None, document_segments, dataset, document_config["doc_form"], session=session
                )

    redis_client.setex(indexing_cache_key, 600, "completed")
    end_at = time.perf_counter()
    logger.info(
        click.style(
            f"Segment batch created job: {job_id} latency: {end_at - start_at}",
            fg="green",
        )
    )
