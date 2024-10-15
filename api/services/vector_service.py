from typing import Optional

from core.errors.error import LLMBadRequestError
from core.model_manager import ModelManager
from core.model_runtime.entities.model_entities import ModelType
from core.rag.datasource.keyword.keyword_factory import Keyword
from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from core.rag.models.document import Document
from models.dataset import Dataset, DatasetProcessRule, DocumentSegment, ChildChunk, Document as DatasetDocument
from extensions.ext_database import db



class VectorService:
    @classmethod
    def create_segments_vector(
        cls, keywords_list: Optional[list[list[str]]], segments: list[DocumentSegment], dataset: Dataset
    ):
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
        if dataset.indexing_technique == "high_quality":
            # save vector index
            vector = Vector(dataset=dataset)
            vector.add_texts(documents, duplicate_check=True)

        # save keyword index
        keyword = Keyword(dataset)

        if keywords_list and len(keywords_list) > 0:
            keyword.add_texts(documents, keywords_list=keywords_list)
        else:
            keyword.add_texts(documents)

    @classmethod
    def update_segment_vector(cls, keywords: Optional[list[str]], segment: DocumentSegment, dataset: Dataset):
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

        # update keyword index
        keyword = Keyword(dataset)
        keyword.delete_by_ids([segment.index_node_id])

        # save keyword index
        if keywords and len(keywords) > 0:
            keyword.add_texts([document], keywords_list=[keywords])
        else:
            keyword.add_texts([document])

    @classmethod
    def regenerate_child_chunks(cls, segment: DocumentSegment, dataset_document: Document, dataset: Dataset):
        # delete child chunks
        db.session.query(ChildChunk).filter(ChildChunk.dataset_id == dataset.id, ChildChunk.document_id == dataset_document.id,
                ChildChunk.segment_id == segment.id,
            ).delete()
        # regenerate child chunks
        index_processor = IndexProcessorFactory(dataset.doc_form).init_index_processor()
        index_processor.create_child_chunks(dataset, [segment.index_node_id])
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
        # get the process rule
        processing_rule = (
            db.session.query(DatasetProcessRule)
            .filter(DatasetProcessRule.id == dataset_document.dataset_process_rule_id)
                .first()
            )
        document = Document(
            page_content=segment.content,
            metadata={
                "doc_id": segment.index_node_id,
                "doc_hash": segment.index_node_hash,
                "document_id": segment.document_id,
                "dataset_id": segment.dataset_id,
            },
        )

        documents = index_processor.transform(
            [document],
            embedding_model_instance=embedding_model_instance,
            process_rule=processing_rule,
            tenant_id=dataset.tenant_id,
            doc_language=dataset_document.doc_language,
        )
        # save child chunks
        if len(documents) > 0 and len(documents[0].child_chunks) > 0:
            index_processor.load(dataset, documents)

            for child_chunk in documents[0].child_chunks:
                child_segment = ChildChunk(
                    tenant_id=dataset.tenant_id,
                    dataset_id=dataset.id,
                    document_id=dataset_document.id,
                    segment_id=segment.id,
                    index_node_id=child_chunk.metadata["doc_id"],
                    index_node_hash=child_chunk.metadata["doc_hash"],
                    content=child_chunk.page_content,
                    word_count=len(child_chunk.page_content),
                    type="automatic",
                    created_by=dataset_document.created_by,
                )
                db.session.add(child_segment)
        db.session.commit()
