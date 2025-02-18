import logging
import time

import click
from celery import shared_task  # type: ignore

from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from core.tools.utils.rag_web_reader import get_image_upload_file_ids
from extensions.ext_database import db
from extensions.ext_storage import storage
from models.dataset import (
    AppDatasetJoin,
    Dataset,
    DatasetProcessRule,
    DatasetQuery,
    Document,
    DocumentSegment,
)
from models.model import UploadFile


# Add import statement for ValueError
@shared_task(queue="dataset")
def clean_dataset_task(
    dataset_id: str,
    tenant_id: str,
    indexing_technique: str,
    index_struct: str,
    collection_binding_id: str,
    doc_form: str,
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
    logging.info(click.style("Start clean dataset when dataset deleted: {}".format(dataset_id), fg="green"))
    start_at = time.perf_counter()

    try:
        dataset = Dataset(
            id=dataset_id,
            tenant_id=tenant_id,
            indexing_technique=indexing_technique,
            index_struct=index_struct,
            collection_binding_id=collection_binding_id,
        )
        documents = db.session.query(Document).filter(Document.dataset_id == dataset_id).all()
        segments = db.session.query(DocumentSegment).filter(DocumentSegment.dataset_id == dataset_id).all()

        if documents is None or len(documents) == 0:
            logging.info(click.style("No documents found for dataset: {}".format(dataset_id), fg="green"))
        else:
            logging.info(click.style("Cleaning documents for dataset: {}".format(dataset_id), fg="green"))
            # Specify the index type before initializing the index processor
            if doc_form is None:
                raise ValueError("Index type must be specified.")
            index_processor = IndexProcessorFactory(doc_form).init_index_processor()
            index_processor.clean(dataset, None, with_keywords=True, delete_child_chunks=True)

            for document in documents:
                db.session.delete(document)

            for segment in segments:
                image_upload_file_ids = get_image_upload_file_ids(segment.content)
                for upload_file_id in image_upload_file_ids:
                    image_file = db.session.query(UploadFile).filter(UploadFile.id == upload_file_id).first()
                    if image_file is None:
                        continue
                    try:
                        storage.delete(image_file.key)
                    except Exception:
                        logging.exception(
                            "Delete image_files failed when storage deleted, \
                                          image_upload_file_is: {}".format(upload_file_id)
                        )
                    db.session.delete(image_file)
                db.session.delete(segment)

        db.session.query(DatasetProcessRule).filter(DatasetProcessRule.dataset_id == dataset_id).delete()
        db.session.query(DatasetQuery).filter(DatasetQuery.dataset_id == dataset_id).delete()
        db.session.query(AppDatasetJoin).filter(AppDatasetJoin.dataset_id == dataset_id).delete()

        # delete files
        if documents:
            for document in documents:
                try:
                    if document.data_source_type == "upload_file":
                        if document.data_source_info:
                            data_source_info = document.data_source_info_dict
                            if data_source_info and "upload_file_id" in data_source_info:
                                file_id = data_source_info["upload_file_id"]
                                file = (
                                    db.session.query(UploadFile)
                                    .filter(UploadFile.tenant_id == document.tenant_id, UploadFile.id == file_id)
                                    .first()
                                )
                                if not file:
                                    continue
                                storage.delete(file.key)
                                db.session.delete(file)
                except Exception:
                    continue

        db.session.commit()
        end_at = time.perf_counter()
        logging.info(
            click.style(
                "Cleaned dataset when dataset deleted: {} latency: {}".format(dataset_id, end_at - start_at), fg="green"
            )
        )
    except Exception:
        logging.exception("Cleaned dataset when dataset deleted failed")
