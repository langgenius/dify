"""Keyword index processor."""
import uuid
from typing import List
import pandas as pd
from werkzeug.datastructures import FileStorage
from core.rag.datasource.retrieval_service import RetrievalService
from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.extractor.extract_processor import ExtractProcessor
from core.rag.index_processor.index_processor_base import BaseIndexProcessor
from core.rag.models.document import Document
from libs import helper
from models.dataset import Dataset


class KeywordIndexProcessor(BaseIndexProcessor):

    def format_by_file_path(self, file_path: str, **kwargs) -> List[Document]:

        text_docs = ExtractProcessor.load_from_file(file_path=file_path,
                                                    is_automatic=self._process_rule["mode"] == "automatic")
        splitter = self._get_splitter(processing_rule=self._process_rule,
                                      embedding_model_instance=None)

        # Split the text documents into nodes.
        all_documents = []
        for text_doc in text_docs:
            # document clean todo
            document_text = self._document_clean(text_doc.page_content, self._process_rule)
            text_doc.page_content = document_text

            # parse document to nodes
            documents = splitter.split_documents([text_doc])
            split_documents = []
            for document_node in documents:

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

    def format_by_template(self, file: FileStorage, **kwargs) -> List[Document]:
        # check file type
        if not file.filename.endswith('.csv'):
            raise ValueError("Invalid file type. Only CSV files are allowed")

        try:
            # Skip the first row
            df = pd.read_csv(file)
            text_docs = []
            for index, row in df.iterrows():
                data = Document(page_content=row[0])
                text_docs.append(data)
            if len(text_docs) == 0:
                raise ValueError("The CSV file is empty.")

        except Exception as e:
            raise ValueError(str(e))
        splitter = self._get_splitter(processing_rule=self._process_rule,
                                      embedding_model_instance=None)
        # Split the text documents into nodes.
        all_documents = []
        for text_doc in text_docs:
            # document clean todo
            document_text = self._document_clean(text_doc.page_content, self._process_rule)
            text_doc.page_content = document_text

            # parse document to nodes
            documents = splitter.split_documents([text_doc])
            split_documents = []
            for document_node in documents:

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
        else:
            keyword = IndexBuilder.get_index(dataset, 'economy')


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
