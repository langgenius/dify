"""Paragraph index processor."""
import uuid
from typing import List
import pandas as pd
from werkzeug.datastructures import FileStorage

from core.rag.cleaner.clean_processor import CleanProcessor
from core.rag.datasource.keyword.keyword_init import Keyword
from core.rag.datasource.retrieval_service import RetrievalService
from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.extractor.entity.extract_setting import ExtractSetting
from core.rag.extractor.extract_processor import ExtractProcessor
from core.rag.index_processor.index_processor_base import BaseIndexProcessor
from core.rag.models.document import Document
from libs import helper
from models.dataset import Dataset


class ParagraphIndexProcessor(BaseIndexProcessor):

    def extract(self, extract_setting: ExtractSetting) -> List[Document]:

        text_docs = ExtractProcessor.extract(extract_setting=extract_setting,
                                             is_automatic=self._process_rule["mode"] == "automatic")

        return text_docs

    def transform(self,  documents: List[Document], **kwargs) -> List[Document]:
        # Split the text documents into nodes.
        splitter = self._get_splitter(processing_rule=self._process_rule,
                                      embedding_model_instance=kwargs.get('embedding_model_instance'))
        all_documents = []
        for document in documents:
            # document clean
            document_text = CleanProcessor.clean(document.page_content, self._process_rule)
            document.page_content = document_text
            # parse document to nodes
            document_nodes = splitter.split_documents([document])
            split_documents = []
            for document_node in document_nodes:

                if document_node.page_content.strip():
                    doc_id = str(uuid.uuid4())
                    hash = helper.generate_text_hash(document_node.page_content)
                    document_node.metadata['doc_id'] = doc_id
                    document_node.metadata['doc_hash'] = hash
                    # delete Spliter character
                    page_content = document_node.page_content
                    if page_content.startswith(".") or page_content.startswith("。"):
                        page_content = page_content[1:]
                    else:
                        page_content = page_content
                    document_node.page_content = page_content
                    split_documents.append(document_node)
            all_documents.extend(split_documents)
        return all_documents

    def load(self, dataset: Dataset, documents: List[Document]):
        if dataset.indexing_technique == 'high_quality':
            vector = Vector(dataset)
            vector.create(documents)

        keyword = Keyword(dataset)
        keyword.create(documents)

    def retrieve(self, retrival_method: str, query: str, dataset: Dataset, top_k: int,
                 score_threshold: float, reranking_model: dict) -> List[Document]:
        # Set search parameters.
        results = RetrievalService.retrieve(retrival_method=retrival_method, dataset_id=dataset.id, query=query,
                                            top_k=top_k, score_threshold=score_threshold,
                                            reranking_model=reranking_model)
        # Organize results.
        docs = []
        for result in results:
            metadata = result.metadata
            metadata['score'] = result.score
            if result.score > score_threshold:
                doc = Document(page_content=result.page_content, metadata=metadata)
                docs.append(doc)
        return docs
