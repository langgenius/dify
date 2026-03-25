import logging
import time

import click
from celery import shared_task  # type: ignore

from core.db.session_factory import session_factory
from core.rag.index_processor.constant.doc_type import DocType
from core.rag.index_processor.constant.index_type import IndexStructureType
from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from core.rag.models.document import AttachmentDocument, ChildDocument, Document
from models.dataset import Dataset, DocumentSegment
from models.dataset import Document as DatasetDocument


@shared_task(queue="dataset")
def deal_dataset_index_update_task(dataset_id: str, action: str):
    """
    Async deal dataset from index
    :param dataset_id: dataset_id
    :param action: action
    Usage: deal_dataset_index_update_task.delay(dataset_id, action)
    """
    logging.info(click.style("Start deal dataset index update: {}".format(dataset_id), fg="green"))
    start_at = time.perf_counter()

    with session_factory.create_session() as session:
        try:
            dataset = session.query(Dataset).filter_by(id=dataset_id).first()

            if not dataset:
                raise Exception("Dataset not found")
            index_type = dataset.doc_form or IndexStructureType.PARAGRAPH_INDEX
            index_processor = IndexProcessorFactory(index_type).init_index_processor()
            if action == "upgrade":
                dataset_documents = (
                    session.query(DatasetDocument)
                    .where(
                        DatasetDocument.dataset_id == dataset_id,
                        DatasetDocument.indexing_status == "completed",
                        DatasetDocument.enabled == True,
                        DatasetDocument.archived == False,
                    )
                    .all()
                )

                if dataset_documents:
                    dataset_documents_ids = [doc.id for doc in dataset_documents]
                    session.query(DatasetDocument).where(DatasetDocument.id.in_(dataset_documents_ids)).update(
                        {"indexing_status": "indexing"}, synchronize_session=False
                    )
                    session.commit()

                    for dataset_document in dataset_documents:
                        try:
                            # add from vector index
                            segments = (
                                session.query(DocumentSegment)
                                .where(
                                    DocumentSegment.document_id == dataset_document.id,
                                    DocumentSegment.enabled == True,
                                )
                                .order_by(DocumentSegment.position.asc())
                                .all()
                            )
                            if segments:
                                documents = []
                                for segment in segments:
                                    document = Document(
                                        page_content=segment.content,
                                        metadata={
                                            "doc_id": segment.index_node_id,
                                            "doc_hash": segment.index_node_hash,
                                            "document_id": segment.document_id,
                                            "dataset_id": segment.dataset_id,
                                        },
                                    )

                                    documents.append(document)
                                # save vector index
                                # clean keywords
                                index_processor.clean(dataset, None, with_keywords=True, delete_child_chunks=False)
                                index_processor.load(dataset, documents, with_keywords=False)
                            session.query(DatasetDocument).where(DatasetDocument.id == dataset_document.id).update(
                                {"indexing_status": "completed"}, synchronize_session=False
                            )
                            session.commit()
                        except Exception as e:
                            session.query(DatasetDocument).where(DatasetDocument.id == dataset_document.id).update(
                                {"indexing_status": "error", "error": str(e)}, synchronize_session=False
                            )
                            session.commit()
            elif action == "update":
                dataset_documents = (
                    session.query(DatasetDocument)
                    .where(
                        DatasetDocument.dataset_id == dataset_id,
                        DatasetDocument.indexing_status == "completed",
                        DatasetDocument.enabled == True,
                        DatasetDocument.archived == False,
                    )
                    .all()
                )
                # add new index
                if dataset_documents:
                    # update document status
                    dataset_documents_ids = [doc.id for doc in dataset_documents]
                    session.query(DatasetDocument).where(DatasetDocument.id.in_(dataset_documents_ids)).update(
                        {"indexing_status": "indexing"}, synchronize_session=False
                    )
                    session.commit()

                    # clean index
                    index_processor.clean(dataset, None, with_keywords=False, delete_child_chunks=False)

                    for dataset_document in dataset_documents:
                        # update from vector index
                        try:
                            segments = (
                                session.query(DocumentSegment)
                                .where(
                                    DocumentSegment.document_id == dataset_document.id,
                                    DocumentSegment.enabled == True,
                                )
                                .order_by(DocumentSegment.position.asc())
                                .all()
                            )
                            if segments:
                                documents = []
                                multimodal_documents = []
                                for segment in segments:
                                    document = Document(
                                        page_content=segment.content,
                                        metadata={
                                            "doc_id": segment.index_node_id,
                                            "doc_hash": segment.index_node_hash,
                                            "document_id": segment.document_id,
                                            "dataset_id": segment.dataset_id,
                                        },
                                    )
                                    if dataset_document.doc_form == IndexStructureType.PARENT_CHILD_INDEX:
                                        child_chunks = segment.get_child_chunks()
                                        if child_chunks:
                                            child_documents = []
                                            for child_chunk in child_chunks:
                                                child_document = ChildDocument(
                                                    page_content=child_chunk.content,
                                                    metadata={
                                                        "doc_id": child_chunk.index_node_id,
                                                        "doc_hash": child_chunk.index_node_hash,
                                                        "document_id": segment.document_id,
                                                        "dataset_id": segment.dataset_id,
                                                    },
                                                )
                                                child_documents.append(child_document)
                                            document.children = child_documents
                                    if dataset.is_multimodal:
                                        for attachment in segment.attachments:
                                            multimodal_documents.append(
                                                AttachmentDocument(
                                                    page_content=attachment["name"],
                                                    metadata={
                                                        "doc_id": attachment["id"],
                                                        "doc_hash": "",
                                                        "document_id": segment.document_id,
                                                        "dataset_id": segment.dataset_id,
                                                        "doc_type": DocType.IMAGE,
                                                    },
                                                )
                                            )
                                    documents.append(document)
                                # save vector index
                                index_processor.load(
                                    dataset, documents, multimodal_documents=multimodal_documents, with_keywords=False
                                )
                            session.query(DatasetDocument).where(DatasetDocument.id == dataset_document.id).update(
                                {"indexing_status": "completed"}, synchronize_session=False
                            )
                            session.commit()
                        except Exception as e:
                            session.query(DatasetDocument).where(DatasetDocument.id == dataset_document.id).update(
                                {"indexing_status": "error", "error": str(e)}, synchronize_session=False
                            )
                            session.commit()
                else:
                    # clean collection
                    index_processor.clean(dataset, None, with_keywords=False, delete_child_chunks=False)

            end_at = time.perf_counter()
            logging.info(
                click.style(
                    "Deal dataset vector index: {} latency: {}".format(dataset_id, end_at - start_at),
                    fg="green",
                )
            )
        except Exception:
            logging.exception("Deal dataset vector index failed")
