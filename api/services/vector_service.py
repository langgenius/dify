import logging

from core.model_manager import ModelInstance, ModelManager
from core.model_runtime.entities.model_entities import ModelType
from core.rag.datasource.keyword.keyword_factory import Keyword
from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.index_processor.constant.index_type import IndexType
from core.rag.index_processor.index_processor_factory import IndexProcessorFactory
from core.rag.models.document import Document
from extensions.ext_database import db
from models.dataset import ChildChunk, Dataset, DatasetProcessRule, DocumentSegment
from models.dataset import Document as DatasetDocument
from services.entities.knowledge_entities.knowledge_entities import ParentMode

logger = logging.getLogger(__name__)


class VectorService:
    @classmethod
    def create_segments_vector(
        cls, keywords_list: list[list[str]] | None, segments: list[DocumentSegment], dataset: Dataset, doc_form: str
    ):
        documents: list[Document] = []

        for segment in segments:
            if doc_form == IndexType.PARENT_CHILD_INDEX:
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
                    },
                )
                documents.append(rag_document)
        if len(documents) > 0:
            index_processor = IndexProcessorFactory(doc_form).init_index_processor()
            index_processor.load(dataset, documents, with_keywords=True, keywords_list=keywords_list)

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
