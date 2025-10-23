"""Paragraph index processor."""

import uuid
from collections.abc import Mapping
from typing import Any

from core.rag.cleaner.clean_processor import CleanProcessor
from core.rag.datasource.keyword.keyword_factory import Keyword
from core.rag.datasource.retrieval_service import RetrievalService
from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.docstore.dataset_docstore import DatasetDocumentStore
from core.rag.extractor.entity.extract_setting import ExtractSetting
from core.rag.extractor.extract_processor import ExtractProcessor
from core.rag.index_processor.constant.index_type import IndexType
from core.rag.index_processor.index_processor_base import BaseIndexProcessor
from core.rag.models.document import Document
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from core.tools.utils.text_processing_utils import remove_leading_symbols
from libs import helper
from models.dataset import Dataset, DatasetProcessRule
from models.dataset import Document as DatasetDocument
from services.entities.knowledge_entities.knowledge_entities import Rule


class ParagraphIndexProcessor(BaseIndexProcessor):
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
        if process_rule.get("mode") == "automatic":
            automatic_rule = DatasetProcessRule.AUTOMATIC_RULES
            rules = Rule.model_validate(automatic_rule)
        else:
            if not process_rule.get("rules"):
                raise ValueError("No rules found in process rule.")
            rules = Rule.model_validate(process_rule.get("rules"))
        # Split the text documents into nodes.
        if not rules.segmentation:
            raise ValueError("No segmentation found in rules.")
        splitter = self._get_splitter(
            processing_rule_mode=process_rule.get("mode"),
            max_tokens=rules.segmentation.max_tokens,
            chunk_overlap=rules.segmentation.chunk_overlap,
            separator=rules.segmentation.separator,
            embedding_model_instance=kwargs.get("embedding_model_instance"),
        )
        all_documents = []
        for document in documents:
            # document clean
            document_text = CleanProcessor.clean(document.page_content, kwargs.get("process_rule", {}))
            document.page_content = document_text
            # parse document to nodes
            document_nodes = splitter.split_documents([document])
            split_documents = []
            for document_node in document_nodes:
                if document_node.page_content.strip():
                    doc_id = str(uuid.uuid4())
                    hash = helper.generate_text_hash(document_node.page_content)
                    if document_node.metadata is not None:
                        document_node.metadata["doc_id"] = doc_id
                        document_node.metadata["doc_hash"] = hash
                    # delete Splitter character
                    page_content = remove_leading_symbols(document_node.page_content).strip()
                    if len(page_content) > 0:
                        document_node.page_content = page_content
                        split_documents.append(document_node)
            all_documents.extend(split_documents)
        return all_documents

    def load(self, dataset: Dataset, documents: list[Document], with_keywords: bool = True, **kwargs):
        if dataset.indexing_technique == "high_quality":
            vector = Vector(dataset)
            vector.create(documents)
            with_keywords = False
        if with_keywords:
            keywords_list = kwargs.get("keywords_list")
            keyword = Keyword(dataset)
            if keywords_list and len(keywords_list) > 0:
                keyword.add_texts(documents, keywords_list=keywords_list)
            else:
                keyword.add_texts(documents)

    def clean(self, dataset: Dataset, node_ids: list[str] | None, with_keywords: bool = True, **kwargs):
        if dataset.indexing_technique == "high_quality":
            vector = Vector(dataset)
            if node_ids:
                vector.delete_by_ids(node_ids)
            else:
                vector.delete()
            with_keywords = False
        if with_keywords:
            keyword = Keyword(dataset)
            if node_ids:
                keyword.delete_by_ids(node_ids)
            else:
                keyword.delete()

    def retrieve(
        self,
        retrieval_method: RetrievalMethod,
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
            if result.score >= score_threshold:
                doc = Document(page_content=result.page_content, metadata=metadata)
                docs.append(doc)
        return docs

    def index(self, dataset: Dataset, document: DatasetDocument, chunks: Any):
        if isinstance(chunks, list):
            documents = []
            for content in chunks:
                metadata = {
                    "dataset_id": dataset.id,
                    "document_id": document.id,
                    "doc_id": str(uuid.uuid4()),
                    "doc_hash": helper.generate_text_hash(content),
                }
                doc = Document(page_content=content, metadata=metadata)
                documents.append(doc)
            if documents:
                # save node to document segment
                doc_store = DatasetDocumentStore(dataset=dataset, user_id=document.created_by, document_id=document.id)
                # add document segments
                doc_store.add_documents(docs=documents, save_child=False)
                if dataset.indexing_technique == "high_quality":
                    vector = Vector(dataset)
                    vector.create(documents)
                elif dataset.indexing_technique == "economy":
                    keyword = Keyword(dataset)
                    keyword.add_texts(documents)
        else:
            raise ValueError("Chunks is not a list")

    def format_preview(self, chunks: Any) -> Mapping[str, Any]:
        if isinstance(chunks, list):
            preview = []
            for content in chunks:
                preview.append({"content": content})
            return {"chunk_structure": IndexType.PARAGRAPH_INDEX, "preview": preview, "total_segments": len(chunks)}
        else:
            raise ValueError("Chunks is not a list")
