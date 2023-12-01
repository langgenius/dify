import logging
from typing import List, Optional

from core.model_providers.error import LLMBadRequestError
from core.model_providers.models.reranking.base import BaseReranking
from core.model_providers.providers.base import BaseModelProvider
from langchain.schema import Document
from xinference_client.client.restful.restful_client import Client


class XinferenceReranking(BaseReranking):

    def __init__(self, model_provider: BaseModelProvider, name: str):
        self.credentials = model_provider.get_model_credentials(
            model_name=name,
            model_type=self.type
        )

        client = Client(self.credentials['server_url'])

        super().__init__(model_provider, client, name)

    def rerank(self, query: str, documents: List[Document], score_threshold: Optional[float], top_k: Optional[int]) -> Optional[List[Document]]:
        docs = []
        doc_id = []
        unique_documents = []
        for document in documents:
            if document.metadata['doc_id'] not in doc_id:
                doc_id.append(document.metadata['doc_id'])
                docs.append(document.page_content)
                unique_documents.append(document)
        documents = unique_documents
        
        model = self.client.get_model(self.credentials['model_uid'])
        response = model.rerank(query=query, documents=docs, top_n=top_k)
        rerank_documents = []

        for idx, result in enumerate(response['results']):
            # format document
            index = result['index']
            rerank_document = Document(
                page_content=result['document'],
                metadata={
                    "doc_id": documents[index].metadata['doc_id'],
                    "doc_hash": documents[index].metadata['doc_hash'],
                    "document_id": documents[index].metadata['document_id'],
                    "dataset_id": documents[index].metadata['dataset_id'],
                    'score': result['relevance_score']
                }
            )
            # score threshold check
            if score_threshold is not None:
                if result['relevance_score'] >= score_threshold:
                    rerank_documents.append(rerank_document)
            else:
                rerank_documents.append(rerank_document)
        return rerank_documents

    def handle_exceptions(self, ex: Exception) -> Exception:
        return LLMBadRequestError(f"Xinference rerank: {str(ex)}")
