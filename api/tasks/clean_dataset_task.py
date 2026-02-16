import logging
import time

import click
from celery import shared_task
from sqlalchemy import delete, select

from core.db.session_factory import session_factory
from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from core.tools.utils.web_reader_tool import get_image_upload_file_ids
from extensions.ext_storage import storage
from models import WorkflowType
from models.dataset import (
    AppDatasetJoin,
    Dataset,
    DatasetMetadata,
    DatasetMetadataBinding,
    DatasetProcessRule,
    DatasetQuery,
    Document,
    DocumentSegment,
    Pipeline,
    SegmentAttachmentBinding,
)
from models.model import UploadFile
from models.workflow import Workflow

logger = logging.getLogger(__name__)


# Add import statement for ValueError
@shared_task(queue="dataset")
def clean_dataset_task(
    dataset_id: str,
    tenant_id: str,
    indexing_technique: str,
    index_struct: str,
    collection_binding_id: str,
    doc_form: str,
    pipeline_id: str | None = None,
):
    """
    Clean dataset when dataset deleted.
    :param dataset_id: dataset id
    :param tenant_id: tenant id
    :param indexing_technique: indexing technique
    :param index_struct: index struct dict
    :param collection_binding_id: collection binding id
    :param doc_form: dataset form

    Usage: clean_dataset_task.delay(dataset_id, tenant_id, indexing_technique, index_struct)
    """
    logger.info(click.style(f"Start clean dataset when dataset deleted: {dataset_id}", fg="green"))
    start_at = time.perf_counter()

    with session_factory.create_session() as session:
        try:
            dataset = Dataset(
                id=dataset_id,
                tenant_id=tenant_id,
                indexing_technique=indexing_technique,
                index_struct=index_struct,
                collection_binding_id=collection_binding_id,
            )
            documents = session.scalars(select(Document).where(Document.dataset_id == dataset_id)).all()
            segments = session.scalars(select(DocumentSegment).where(DocumentSegment.dataset_id == dataset_id)).all()
            # Use JOIN to fetch attachments with bindings in a single query
            attachments_with_bindings = session.execute(
                select(SegmentAttachmentBinding, UploadFile)
                .join(UploadFile, UploadFile.id == SegmentAttachmentBinding.attachment_id)
                .where(
                    SegmentAttachmentBinding.tenant_id == tenant_id,
                    SegmentAttachmentBinding.dataset_id == dataset_id,
                )
            ).all()

            # Enhanced validation: Check if doc_form is None, empty string, or contains only whitespace
            # This ensures all invalid doc_form values are properly handled
            if doc_form is None or (isinstance(doc_form, str) and not doc_form.strip()):
                # Use default paragraph index type for empty/invalid datasets to enable vector database cleanup
                from core.rag.index_processor.constant.index_type import IndexStructureType

                doc_form = IndexStructureType.PARAGRAPH_INDEX
                logger.info(
                    click.style(
                        f"Invalid doc_form detected, using default index type for cleanup: {doc_form}",
                        fg="yellow",
                    )
                )

            # Add exception handling around IndexProcessorFactory.clean() to prevent single point of failure
            # This ensures Document/Segment deletion can continue even if vector database cleanup fails
            try:
                index_processor = IndexProcessorFactory(doc_form).init_index_processor()
                index_processor.clean(dataset, None, with_keywords=True, delete_child_chunks=True)
                logger.info(click.style(f"Successfully cleaned vector database for dataset: {dataset_id}", fg="green"))
            except Exception:
                logger.exception(click.style(f"Failed to clean vector database for dataset {dataset_id}", fg="red"))
                # Continue with document and segment deletion even if vector cleanup fails
                logger.info(
                    click.style(f"Continuing with document and segment deletion for dataset: {dataset_id}", fg="yellow")
                )

            if documents is None or len(documents) == 0:
                logger.info(click.style(f"No documents found for dataset: {dataset_id}", fg="green"))
            else:
                logger.info(click.style(f"Cleaning documents for dataset: {dataset_id}", fg="green"))

                for document in documents:
                    session.delete(document)

                segment_ids = [segment.id for segment in segments]
                for segment in segments:
                    image_upload_file_ids = get_image_upload_file_ids(segment.content)
                    image_files = session.query(UploadFile).where(UploadFile.id.in_(image_upload_file_ids)).all()
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
                    stmt = delete(UploadFile).where(UploadFile.id.in_(image_upload_file_ids))
                    session.execute(stmt)

                segment_delete_stmt = delete(DocumentSegment).where(DocumentSegment.id.in_(segment_ids))
                session.execute(segment_delete_stmt)
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

            session.query(DatasetProcessRule).where(DatasetProcessRule.dataset_id == dataset_id).delete()
            session.query(DatasetQuery).where(DatasetQuery.dataset_id == dataset_id).delete()
            session.query(AppDatasetJoin).where(AppDatasetJoin.dataset_id == dataset_id).delete()
            # delete dataset metadata
            session.query(DatasetMetadata).where(DatasetMetadata.dataset_id == dataset_id).delete()
            session.query(DatasetMetadataBinding).where(DatasetMetadataBinding.dataset_id == dataset_id).delete()
            # delete pipeline and workflow
            if pipeline_id:
                session.query(Pipeline).where(Pipeline.id == pipeline_id).delete()
                session.query(Workflow).where(
                    Workflow.tenant_id == tenant_id,
                    Workflow.app_id == pipeline_id,
                    Workflow.type == WorkflowType.RAG_PIPELINE,
                ).delete()
            # delete files
            if documents:
                file_ids = []
                for document in documents:
                    if document.data_source_type == "upload_file":
                        if document.data_source_info:
                            data_source_info = document.data_source_info_dict
                            if data_source_info and "upload_file_id" in data_source_info:
                                file_id = data_source_info["upload_file_id"]
                                file_ids.append(file_id)
                files = session.query(UploadFile).where(UploadFile.id.in_(file_ids)).all()
                for file in files:
                    storage.delete(file.key)

                file_delete_stmt = delete(UploadFile).where(UploadFile.id.in_(file_ids))
                session.execute(file_delete_stmt)

            session.commit()
            end_at = time.perf_counter()
            logger.info(
                click.style(
                    f"Cleaned dataset when dataset deleted: {dataset_id} latency: {end_at - start_at}",
                    fg="green",
                )
            )
        except Exception:
            # Add rollback to prevent dirty session state in case of exceptions
            # This ensures the database session is properly cleaned up
            try:
                session.rollback()
                logger.info(click.style(f"Rolled back database session for dataset: {dataset_id}", fg="yellow"))
            except Exception:
                logger.exception("Failed to rollback database session")

            logger.exception("Cleaned dataset when dataset deleted failed")
        finally:
            # Explicitly close the session for test expectations and safety
            try:
                session.close()
            except Exception:
                logger.exception("Failed to close database session")
