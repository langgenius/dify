import logging
import time

import click
from celery import shared_task
from sqlalchemy import and_, delete, select

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
from services.vector_service import VectorService
from tasks.refresh_billing_vector_space_task import schedule_billing_vector_space_refresh

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
    vector_cleanup_succeeded = False
    storage_file_keys: list[str] = []

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
                .outerjoin(
                    UploadFile,
                    and_(
                        UploadFile.id == SegmentAttachmentBinding.attachment_id,
                        UploadFile.tenant_id == tenant_id,
                    ),
                )
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

            # Release the read transaction before contacting the vector backend.
            session.commit()

            # Add exception handling around IndexProcessorFactory.clean() to prevent single point of failure
            # This ensures Document/Segment deletion can continue even if vector database cleanup fails
            try:
                index_processor = IndexProcessorFactory(doc_form).init_index_processor()
                index_processor.clean(dataset, None, with_keywords=True, delete_child_chunks=True, session=session)
                session.commit()
                vector_cleanup_succeeded = True
                logger.info(click.style(f"Successfully cleaned vector database for dataset: {dataset_id}", fg="green"))
            except Exception:
                session.rollback()
                logger.exception(click.style(f"Failed to clean vector database for dataset {dataset_id}", fg="red"))
                # Continue with document and segment deletion even if vector cleanup fails
                logger.info(
                    click.style(f"Continuing with document and segment deletion for dataset: {dataset_id}", fg="yellow")
                )

            # In case index_processor.clean didn't clean fully
            VectorService.delete_segment_index_artifacts(
                session=session,
                dataset_id=dataset_id,
                segment_ids=None,
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
                image_files = session.scalars(
                    select(UploadFile).where(
                        UploadFile.id.in_(image_upload_file_ids),
                        UploadFile.tenant_id == tenant_id,
                    )
                ).all()
                storage_file_keys.extend(image_file.key for image_file in image_files)
                stmt = delete(UploadFile).where(
                    UploadFile.id.in_(image_upload_file_ids),
                    UploadFile.tenant_id == tenant_id,
                )
                session.execute(stmt)

            if segment_ids:
                segment_delete_stmt = delete(DocumentSegment).where(
                    DocumentSegment.id.in_(segment_ids),
                    DocumentSegment.dataset_id == dataset_id,
                )
                session.execute(segment_delete_stmt)
            # delete segment attachments
            if attachments_with_bindings:
                attachment_ids = [binding.attachment_id for binding, _ in attachments_with_bindings]
                binding_ids = [binding.id for binding, _ in attachments_with_bindings]
                storage_file_keys.extend(
                    attachment_file.key
                    for _, attachment_file in attachments_with_bindings
                    if attachment_file is not None
                )
                attachment_file_delete_stmt = delete(UploadFile).where(
                    UploadFile.id.in_(attachment_ids),
                    UploadFile.tenant_id == tenant_id,
                )
                session.execute(attachment_file_delete_stmt)

                binding_delete_stmt = delete(SegmentAttachmentBinding).where(
                    SegmentAttachmentBinding.id.in_(binding_ids)
                )
                session.execute(binding_delete_stmt)

            session.execute(delete(DatasetProcessRule).where(DatasetProcessRule.dataset_id == dataset_id))
            session.execute(delete(DatasetQuery).where(DatasetQuery.dataset_id == dataset_id))
            session.execute(delete(AppDatasetJoin).where(AppDatasetJoin.dataset_id == dataset_id))
            # delete dataset metadata
            session.execute(delete(DatasetMetadata).where(DatasetMetadata.dataset_id == dataset_id))
            session.execute(delete(DatasetMetadataBinding).where(DatasetMetadataBinding.dataset_id == dataset_id))
            # delete pipeline and workflow
            if pipeline_id:
                session.execute(delete(Pipeline).where(Pipeline.id == pipeline_id))
                session.execute(
                    delete(Workflow).where(
                        Workflow.tenant_id == tenant_id,
                        Workflow.app_id == pipeline_id,
                        Workflow.type == WorkflowType.RAG_PIPELINE,
                    )
                )
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
                files = session.scalars(
                    select(UploadFile).where(
                        UploadFile.id.in_(file_ids),
                        UploadFile.tenant_id == tenant_id,
                    )
                ).all()
                storage_file_keys.extend(file.key for file in files)

                file_delete_stmt = delete(UploadFile).where(
                    UploadFile.id.in_(file_ids),
                    UploadFile.tenant_id == tenant_id,
                )
                session.execute(file_delete_stmt)

            session.commit()
            # Do this after DB commits because dangling reference in DB is less
            # acceptable than uncleaned storaged files (?)
            for storage_file_key in dict.fromkeys(storage_file_keys):
                try:
                    storage.delete(storage_file_key)
                except Exception:
                    logger.exception(
                        "Delete file failed when dataset deleted, storage_file_key: %s",
                        storage_file_key,
                    )
            if vector_cleanup_succeeded:
                schedule_billing_vector_space_refresh(dataset.tenant_id)
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
