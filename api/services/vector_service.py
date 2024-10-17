from typing import Optional

from core.errors.error import LLMBadRequestError
from core.model_manager import ModelInstance, ModelManager
from core.model_runtime.entities.model_entities import ModelType
from core.rag.datasource.keyword.keyword_factory import Keyword
from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.index_processor.constant.index_type import IndexType
from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from core.rag.models.document import ChildDocument, Document
from models.dataset import Dataset, DatasetProcessRule, DocumentSegment, ChildChunk, Document as DatasetDocument
from extensions.ext_database import db



class VectorService:
    @classmethod
    def create_segments_vector(
        cls, keywords_list: Optional[list[list[str]]], segments: list[DocumentSegment], dataset: Dataset, doc_form: str
    ):
        documents = []
        if doc_form == IndexType.PARENT_CHILD_INDEX:
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
            # get the process rule
            processing_rule = (
                db.session.query(DatasetProcessRule)
                .filter(DatasetProcessRule.id == document.dataset_process_rule_id)
                    .first()
                )
        for segment in segments:

            if doc_form == IndexType.PARENT_CHILD_INDEX:
                cls.generate_child_chunks(segment, document, dataset, embedding_model_instance, processing_rule, False)
            else:
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
        if len(documents) > 0:
            index_processor = IndexProcessorFactory(doc_form).init_index_processor()
            index_processor.load(dataset, documents, with_keywords=True, keywords_list=keywords_list)

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
    def generate_child_chunks(cls, segment: DocumentSegment, dataset_document: Document, dataset: Dataset, 
                              embedding_model_instance: ModelInstance, processing_rule: DatasetProcessRule, 
                              regenerate: bool = False):
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
    def update_child_chunk_vector(cls, child_chunk: ChildChunk, dataset: Dataset):
        child_document = Document(
            page_content=child_chunk.content,
            metadata={
                "doc_id": child_chunk.index_node_id,
                "doc_hash": child_chunk.index_node_hash,
                "document_id": child_chunk.document_id,
                "dataset_id": child_chunk.dataset_id,
            },
        )
        if dataset.indexing_technique == "high_quality":
            # update vector index
            vector = Vector(dataset=dataset)
            vector.delete_by_ids([child_chunk.index_node_id])
            vector.add_texts([child_document], duplicate_check=True)

    @classmethod
    def delete_child_chunk_vector(cls, child_chunk: ChildChunk, dataset: Dataset):
        vector = Vector(dataset=dataset)
        vector.delete_by_ids([child_chunk.index_node_id])
