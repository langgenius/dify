import logging
import time

import click
from celery import shared_task
from sqlalchemy import delete, select

from core.db.session_factory import session_factory
from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from core.tools.utils.web_reader_tool import get_image_upload_file_ids
from extensions.ext_storage import storage
from models.dataset import Dataset, DatasetMetadataBinding, DocumentSegment, SegmentAttachmentBinding
from models.model import UploadFile

logger = logging.getLogger(__name__)


@shared_task(queue="dataset")
def clean_document_task(document_id: str, dataset_id: str, doc_form: str, file_id: str | None):
    """
    Clean document when document deleted.
    :param document_id: document id
    :param dataset_id: dataset id
    :param doc_form: doc_form
    :param file_id: file id

    Usage: clean_document_task.delay(document_id, dataset_id)
    """
    logger.info(click.style(f"Start clean document when document deleted: {document_id}", fg="green"))
    start_at = time.perf_counter()

    with session_factory.create_session() as session:
        try:
            dataset = session.query(Dataset).where(Dataset.id == dataset_id).first()

            if not dataset:
                raise Exception("Document has no dataset")

            segments = session.scalars(select(DocumentSegment).where(DocumentSegment.document_id == document_id)).all()
            # Use JOIN to fetch attachments with bindings in a single query
            attachments_with_bindings = session.execute(
                select(SegmentAttachmentBinding, UploadFile)
                .join(UploadFile, UploadFile.id == SegmentAttachmentBinding.attachment_id)
                .where(
                    SegmentAttachmentBinding.tenant_id == dataset.tenant_id,
                    SegmentAttachmentBinding.dataset_id == dataset_id,
                    SegmentAttachmentBinding.document_id == document_id,
                )
            ).all()
            # check segment is exist
            if segments:
                index_node_ids = [segment.index_node_id for segment in segments]
                index_processor = IndexProcessorFactory(doc_form).init_index_processor()
                index_processor.clean(dataset, index_node_ids, with_keywords=True, delete_child_chunks=True)

                for segment in segments:
                    image_upload_file_ids = get_image_upload_file_ids(segment.content)
                    image_files = session.scalars(
                        select(UploadFile).where(UploadFile.id.in_(image_upload_file_ids))
                    ).all()
                    for image_file in image_files:
                        if image_file is None:
                            continue
                        try:
                            storage.delete(image_file.key)
                        except Exception:
                            logger.exception(
                                "Delete image_files failed when storage deleted, \
                                                  image_upload_file_is: %s",
                                image_file.id,
                            )

                    image_file_delete_stmt = delete(UploadFile).where(UploadFile.id.in_(image_upload_file_ids))
                    session.execute(image_file_delete_stmt)
                    session.delete(segment)

                session.commit()
            if file_id:
                file = session.query(UploadFile).where(UploadFile.id == file_id).first()
                if file:
                    try:
                        storage.delete(file.key)
                    except Exception:
                        logger.exception("Delete file failed when document deleted, file_id: %s", file_id)
                    session.delete(file)
            # delete segment attachments
            if attachments_with_bindings:
                attachment_ids = [attachment_file.id for _, attachment_file in attachments_with_bindings]
                binding_ids = [binding.id for binding, _ in attachments_with_bindings]
                for binding, attachment_file in attachments_with_bindings:
                    try:
                        storage.delete(attachment_file.key)
                    except Exception:
                        logger.exception(
                            "Delete attachment_file failed when storage deleted, \
                                            attachment_file_id: %s",
                            binding.attachment_id,
                        )
                attachment_file_delete_stmt = delete(UploadFile).where(UploadFile.id.in_(attachment_ids))
                session.execute(attachment_file_delete_stmt)

                binding_delete_stmt = delete(SegmentAttachmentBinding).where(
                    SegmentAttachmentBinding.id.in_(binding_ids)
                )
                session.execute(binding_delete_stmt)

            # delete dataset metadata binding
            session.query(DatasetMetadataBinding).where(
                DatasetMetadataBinding.dataset_id == dataset_id,
                DatasetMetadataBinding.document_id == document_id,
            ).delete()
            session.commit()

            end_at = time.perf_counter()
            logger.info(
                click.style(
                    f"Cleaned document when document deleted: {document_id} latency: {end_at - start_at}",
                    fg="green",
                )
            )
        except Exception:
            logger.exception("Cleaned document when document deleted failed")
