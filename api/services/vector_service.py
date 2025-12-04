import logging

from core.model_manager import ModelInstance, ModelManager
from core.model_runtime.entities.model_entities import ModelType
from core.rag.datasource.keyword.keyword_factory import Keyword
from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.index_processor.constant.doc_type import DocType
from core.rag.index_processor.constant.index_type import IndexStructureType
from core.rag.index_processor.index_processor_base import BaseIndexProcessor
from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from core.rag.models.document import AttachmentDocument, Document
from extensions.ext_database import db
from models import UploadFile
from models.dataset import ChildChunk, Dataset, DatasetProcessRule, DocumentSegment, SegmentAttachmentBinding
from models.dataset import Document as DatasetDocument
from services.entities.knowledge_entities.knowledge_entities import ParentMode

logger = logging.getLogger(__name__)


class VectorService:
    @classmethod
    def create_segments_vector(
        cls, keywords_list: list[list[str]] | None, segments: list[DocumentSegment], dataset: Dataset, doc_form: str
    ):
        documents: list[Document] = []
        multimodal_documents: list[AttachmentDocument] = []

        for segment in segments:
            if doc_form == IndexStructureType.PARENT_CHILD_INDEX:
                dataset_document = db.session.query(DatasetDocument).filter_by(id=segment.document_id).first()
                if not dataset_document:
                    logger.warning(
                        "Expected DatasetDocument record to exist, but none was found, document_id=%s, segment_id=%s",
                        segment.document_id,
                        segment.id,
                    )
                    continue
                # get the process rule
                processing_rule = (
                    db.session.query(DatasetProcessRule)
                    .where(DatasetProcessRule.id == dataset_document.dataset_process_rule_id)
                    .first()
                )
                if not processing_rule:
                    raise ValueError("No processing rule found.")
                # get embedding model instance
                if dataset.indexing_technique == "high_quality":
                    # check embedding model setting
                    model_manager = ModelManager()

                    if dataset.embedding_model_provider:
                        embedding_model_instance = model_manager.get_model_instance(
                            tenant_id=dataset.tenant_id,
                            provider=dataset.embedding_model_provider,
                            model_type=ModelType.TEXT_EMBEDDING,
                            model=dataset.embedding_model,
                        )
                    else:
                        embedding_model_instance = model_manager.get_default_model_instance(
                            tenant_id=dataset.tenant_id,
                            model_type=ModelType.TEXT_EMBEDDING,
                        )
                else:
                    raise ValueError("The knowledge base index technique is not high quality!")
                cls.generate_child_chunks(
                    segment, dataset_document, dataset, embedding_model_instance, processing_rule, False
                )
            else:
                rag_document = Document(
                    page_content=segment.content,
                    metadata={
                        "doc_id": segment.index_node_id,
                        "doc_hash": segment.index_node_hash,
                        "document_id": segment.document_id,
                        "dataset_id": segment.dataset_id,
                        "doc_type": DocType.TEXT,
                    },
                )
                documents.append(rag_document)
            if dataset.is_multimodal:
                for attachment in segment.attachments:
                    multimodal_document: AttachmentDocument = AttachmentDocument(
                        page_content=attachment["name"],
                        metadata={
                            "doc_id": attachment["id"],
                            "doc_hash": "",
                            "document_id": segment.document_id,
                            "dataset_id": segment.dataset_id,
                            "doc_type": DocType.IMAGE,
                        },
                    )
                    multimodal_documents.append(multimodal_document)
        index_processor: BaseIndexProcessor = IndexProcessorFactory(doc_form).init_index_processor()

        if len(documents) > 0:
            index_processor.load(dataset, documents, None, with_keywords=True, keywords_list=keywords_list)
        if len(multimodal_documents) > 0:
            index_processor.load(dataset, [], multimodal_documents, with_keywords=False)

    @classmethod
    def update_segment_vector(cls, keywords: list[str] | None, segment: DocumentSegment, dataset: Dataset):
        # update segment index task

        # format new index
        document = Document(
            page_content=segment.content,
            metadata={
                "doc_id": segment.index_node_id,
                "doc_hash": segment.index_node_hash,
                "document_id": segment.document_id,
                "dataset_id": segment.dataset_id,
            },
        )
        if dataset.indexing_technique == "high_quality":
            # update vector index
            vector = Vector(dataset=dataset)
            vector.delete_by_ids([segment.index_node_id])
            vector.add_texts([document], duplicate_check=True)
        else:
            # update keyword index
            keyword = Keyword(dataset)
            keyword.delete_by_ids([segment.index_node_id])

            # save keyword index
            if keywords and len(keywords) > 0:
                keyword.add_texts([document], keywords_list=[keywords])
            else:
                keyword.add_texts([document])

    @classmethod
    def generate_child_chunks(
        cls,
        segment: DocumentSegment,
        dataset_document: DatasetDocument,
        dataset: Dataset,
        embedding_model_instance: ModelInstance,
        processing_rule: DatasetProcessRule,
        regenerate: bool = False,
    ):
        index_processor = IndexProcessorFactory(dataset.doc_form).init_index_processor()
        if regenerate:
            # delete child chunks
            index_processor.clean(dataset, [segment.index_node_id], with_keywords=True, delete_child_chunks=True)

        # generate child chunks
        document = Document(
            page_content=segment.content,
            metadata={
                "doc_id": segment.index_node_id,
                "doc_hash": segment.index_node_hash,
                "document_id": segment.document_id,
                "dataset_id": segment.dataset_id,
                "doc_type": DocType.TEXT,
            },
        )
        # use full doc mode to generate segment's child chunk
        processing_rule_dict = processing_rule.to_dict()
        processing_rule_dict["rules"]["parent_mode"] = ParentMode.FULL_DOC
        documents = index_processor.transform(
            [document],
            embedding_model_instance=embedding_model_instance,
            process_rule=processing_rule_dict,
            tenant_id=dataset.tenant_id,
            doc_language=dataset_document.doc_language,
        )
        # save child chunks
        if documents and documents[0].children:
            index_processor.load(dataset, documents)

            for position, child_chunk in enumerate(documents[0].children, start=1):
                child_segment = ChildChunk(
                    tenant_id=dataset.tenant_id,
                    dataset_id=dataset.id,
                    document_id=dataset_document.id,
                    segment_id=segment.id,
                    position=position,
                    index_node_id=child_chunk.metadata["doc_id"],
                    index_node_hash=child_chunk.metadata["doc_hash"],
                    content=child_chunk.page_content,
                    word_count=len(child_chunk.page_content),
                    type="automatic",
                    created_by=dataset_document.created_by,
                )
                db.session.add(child_segment)
        db.session.commit()

    @classmethod
    def create_child_chunk_vector(cls, child_segment: ChildChunk, dataset: Dataset):
        child_document = Document(
            page_content=child_segment.content,
            metadata={
                "doc_id": child_segment.index_node_id,
                "doc_hash": child_segment.index_node_hash,
                "document_id": child_segment.document_id,
                "dataset_id": child_segment.dataset_id,
            },
        )
        if dataset.indexing_technique == "high_quality":
            # save vector index
            vector = Vector(dataset=dataset)
            vector.add_texts([child_document], duplicate_check=True)

    @classmethod
    def update_child_chunk_vector(
        cls,
        new_child_chunks: list[ChildChunk],
        update_child_chunks: list[ChildChunk],
        delete_child_chunks: list[ChildChunk],
        dataset: Dataset,
    ):
        documents = []
        delete_node_ids = []
        for new_child_chunk in new_child_chunks:
            new_child_document = Document(
                page_content=new_child_chunk.content,
                metadata={
                    "doc_id": new_child_chunk.index_node_id,
                    "doc_hash": new_child_chunk.index_node_hash,
                    "document_id": new_child_chunk.document_id,
                    "dataset_id": new_child_chunk.dataset_id,
                },
            )
            documents.append(new_child_document)
        for update_child_chunk in update_child_chunks:
            child_document = Document(
                page_content=update_child_chunk.content,
                metadata={
                    "doc_id": update_child_chunk.index_node_id,
                    "doc_hash": update_child_chunk.index_node_hash,
                    "document_id": update_child_chunk.document_id,
                    "dataset_id": update_child_chunk.dataset_id,
                },
            )
            documents.append(child_document)
            delete_node_ids.append(update_child_chunk.index_node_id)
        for delete_child_chunk in delete_child_chunks:
            delete_node_ids.append(delete_child_chunk.index_node_id)
        if dataset.indexing_technique == "high_quality":
            # update vector index
            vector = Vector(dataset=dataset)
            if delete_node_ids:
                vector.delete_by_ids(delete_node_ids)
            if documents:
                vector.add_texts(documents, duplicate_check=True)

    @classmethod
    def delete_child_chunk_vector(cls, child_chunk: ChildChunk, dataset: Dataset):
        vector = Vector(dataset=dataset)
        vector.delete_by_ids([child_chunk.index_node_id])

    @classmethod
    def update_multimodel_vector(cls, segment: DocumentSegment, attachment_ids: list[str], dataset: Dataset):
        if dataset.indexing_technique != "high_quality":
            return

        attachments = segment.attachments
        old_attachment_ids = [attachment["id"] for attachment in attachments] if attachments else []

        # Check if there's any actual change needed
        if set(attachment_ids) == set(old_attachment_ids):
            return

        try:
            vector = Vector(dataset=dataset)
            if dataset.is_multimodal:
                # Delete old vectors if they exist
                if old_attachment_ids:
                    vector.delete_by_ids(old_attachment_ids)

            # Delete existing segment attachment bindings in one operation
            db.session.query(SegmentAttachmentBinding).where(SegmentAttachmentBinding.segment_id == segment.id).delete(
                synchronize_session=False
            )

            if not attachment_ids:
                db.session.commit()
                return

            # Bulk fetch upload files - only fetch needed fields
            upload_file_list = db.session.query(UploadFile).where(UploadFile.id.in_(attachment_ids)).all()

            if not upload_file_list:
                db.session.commit()
                return

            # Create a mapping for quick lookup
            upload_file_map = {upload_file.id: upload_file for upload_file in upload_file_list}

            # Prepare batch operations
            bindings = []
            documents = []

            # Create common metadata base to avoid repetition
            base_metadata = {
                "doc_hash": "",
                "document_id": segment.document_id,
                "dataset_id": segment.dataset_id,
                "doc_type": DocType.IMAGE,
            }

            # Process attachments in the order specified by attachment_ids
            for attachment_id in attachment_ids:
                upload_file = upload_file_map.get(attachment_id)
                if not upload_file:
                    logger.warning("Upload file not found for attachment_id: %s", attachment_id)
                    continue

                # Create segment attachment binding
                bindings.append(
                    SegmentAttachmentBinding(
                        tenant_id=segment.tenant_id,
                        dataset_id=segment.dataset_id,
                        document_id=segment.document_id,
                        segment_id=segment.id,
                        attachment_id=upload_file.id,
                    )
                )

                # Create document for vector indexing
                documents.append(
                    Document(page_content=upload_file.name, metadata={**base_metadata, "doc_id": upload_file.id})
                )

            # Bulk insert all bindings at once
            if bindings:
                db.session.add_all(bindings)

            # Add documents to vector store if any
            if documents and dataset.is_multimodal:
                vector.add_texts(documents, duplicate_check=True)

            # Single commit for all operations
            db.session.commit()

        except Exception:
            logger.exception("Failed to update multimodal vector for segment %s", segment.id)
            db.session.rollback()
            raise
