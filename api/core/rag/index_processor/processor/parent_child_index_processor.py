"""Paragraph index processor."""

import uuid
from typing import Optional

from core.model_manager import ModelInstance
from core.rag.cleaner.clean_processor import CleanProcessor
from core.rag.datasource.retrieval_service import RetrievalService
from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.extractor.entity.extract_setting import ExtractSetting
from core.rag.extractor.extract_processor import ExtractProcessor
from core.rag.index_processor.index_processor_base import BaseIndexProcessor
from core.rag.models.document import ChildDocument, Document
from extensions.ext_database import db
from libs import helper
from models.dataset import ChildChunk, Dataset, DocumentSegment
from services.entities.knowledge_entities.knowledge_entities import ParentMode, Rule


class ParentChildIndexProcessor(BaseIndexProcessor):
    def extract(self, extract_setting: ExtractSetting, **kwargs) -> list[Document]:
        text_docs = ExtractProcessor.extract(
            extract_setting=extract_setting,
            is_automatic=(
                kwargs.get("process_rule_mode") == "automatic" or kwargs.get("process_rule_mode") == "hierarchical"
            ),
        )

        return text_docs

    def transform(self, documents: list[Document], **kwargs) -> list[Document]:
        process_rule = kwargs.get("process_rule")
        if not process_rule:
            raise ValueError("No process rule found.")
        if not process_rule.get("rules"):
            raise ValueError("No rules found in process rule.")
        rules = Rule(**process_rule.get("rules"))
        all_documents = []  # type: ignore
        if rules.parent_mode == ParentMode.PARAGRAPH:
            # Split the text documents into nodes.
            splitter = self._get_splitter(
                processing_rule_mode=process_rule.get("mode"),
                max_tokens=rules.segmentation.max_tokens,
                chunk_overlap=rules.segmentation.chunk_overlap,
                separator=rules.segmentation.separator,
                embedding_model_instance=kwargs.get("embedding_model_instance"),
            )
            for document in documents:
                # document clean
                document_text = CleanProcessor.clean(document.page_content, process_rule)
                document.page_content = document_text
                # parse document to nodes
                document_nodes = splitter.split_documents([document])
                split_documents = []
                for document_node in document_nodes:
                    if document_node.page_content.strip():
                        doc_id = str(uuid.uuid4())
                        hash = helper.generate_text_hash(document_node.page_content)
                        document_node.metadata["doc_id"] = doc_id
                        document_node.metadata["doc_hash"] = hash
                        # delete Splitter character
                        page_content = document_node.page_content
                        if page_content.startswith(".") or page_content.startswith("。"):
                            page_content = page_content[1:].strip()
                        else:
                            page_content = page_content
                        if len(page_content) > 0:
                            document_node.page_content = page_content
                            # parse document to child nodes
                            child_nodes = self._split_child_nodes(
                                document_node, rules, process_rule.get("mode"), kwargs.get("embedding_model_instance")
                            )
                            document_node.children = child_nodes
                            split_documents.append(document_node)
                all_documents.extend(split_documents)
        elif rules.parent_mode == ParentMode.FULL_DOC:
            page_content = "\n".join([document.page_content for document in documents])
            document = Document(page_content=page_content, metadata=documents[0].metadata)
            # parse document to child nodes
            child_nodes = self._split_child_nodes(
                document, rules, process_rule.get("mode"), kwargs.get("embedding_model_instance")
            )
            document.children = child_nodes
            doc_id = str(uuid.uuid4())
            hash = helper.generate_text_hash(document.page_content)
            document.metadata["doc_id"] = doc_id
            document.metadata["doc_hash"] = hash
            all_documents.append(document)

        return all_documents

    def load(self, dataset: Dataset, documents: list[Document], with_keywords: bool = True, **kwargs):
        if dataset.indexing_technique == "high_quality":
            vector = Vector(dataset)
            for document in documents:
                child_documents = document.children
                if child_documents:
                    formatted_child_documents = [
                        Document(**child_document.model_dump()) for child_document in child_documents
                    ]
                    vector.create(formatted_child_documents)

    def clean(self, dataset: Dataset, node_ids: Optional[list[str]], with_keywords: bool = True, **kwargs):
        # node_ids is segment's node_ids
        if dataset.indexing_technique == "high_quality":
            delete_child_chunks = kwargs.get("delete_child_chunks") or False
            vector = Vector(dataset)
            if node_ids:
                child_node_ids = (
                    db.session.query(ChildChunk.index_node_id)
                    .join(DocumentSegment, ChildChunk.segment_id == DocumentSegment.id)
                    .filter(
                        DocumentSegment.dataset_id == dataset.id,
                        DocumentSegment.index_node_id.in_(node_ids),
                        ChildChunk.dataset_id == dataset.id,
                    )
                    .all()
                )
                child_node_ids = [child_node_id[0] for child_node_id in child_node_ids]
                vector.delete_by_ids(child_node_ids)
                if delete_child_chunks:
                    db.session.query(ChildChunk).filter(
                        ChildChunk.dataset_id == dataset.id, ChildChunk.index_node_id.in_(child_node_ids)
                    ).delete()
                    db.session.commit()
            else:
                vector.delete()

                if delete_child_chunks:
                    db.session.query(ChildChunk).filter(ChildChunk.dataset_id == dataset.id).delete()
                    db.session.commit()

    def retrieve(
        self,
        retrieval_method: str,
        query: str,
        dataset: Dataset,
        top_k: int,
        score_threshold: float,
        reranking_model: dict,
    ) -> list[Document]:
        # Set search parameters.
        results = RetrievalService.retrieve(
            retrieval_method=retrieval_method,
            dataset_id=dataset.id,
            query=query,
            top_k=top_k,
            score_threshold=score_threshold,
            reranking_model=reranking_model,
        )
        # Organize results.
        docs = []
        for result in results:
            metadata = result.metadata
            metadata["score"] = result.score
            if result.score > score_threshold:
                doc = Document(page_content=result.page_content, metadata=metadata)
                docs.append(doc)
        return docs

    def _split_child_nodes(
        self,
        document_node: Document,
        rules: Rule,
        process_rule_mode: str,
        embedding_model_instance: Optional[ModelInstance],
    ) -> list[ChildDocument]:
        if not rules.subchunk_segmentation:
            raise ValueError("No subchunk segmentation found in rules.")
        child_splitter = self._get_splitter(
            processing_rule_mode=process_rule_mode,
            max_tokens=rules.subchunk_segmentation.max_tokens,
            chunk_overlap=rules.subchunk_segmentation.chunk_overlap,
            separator=rules.subchunk_segmentation.separator,
            embedding_model_instance=embedding_model_instance,
        )
        # parse document to child nodes
        child_nodes = []
        child_documents = child_splitter.split_documents([document_node])
        for child_document_node in child_documents:
            if child_document_node.page_content.strip():
                doc_id = str(uuid.uuid4())
                hash = helper.generate_text_hash(child_document_node.page_content)
                child_document = ChildDocument(
                    page_content=child_document_node.page_content, metadata=document_node.metadata
                )
                child_document.metadata["doc_id"] = doc_id
                child_document.metadata["doc_hash"] = hash
                child_page_content = child_document.page_content
                if child_page_content.startswith(".") or child_page_content.startswith("。"):
                    child_page_content = child_page_content[1:].strip()
                if len(child_page_content) > 0:
                    child_document.page_content = child_page_content
                    child_nodes.append(child_document)
        return child_nodes
