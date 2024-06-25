import logging
import time

import numpy as np
from sklearn.manifold import TSNE

from core.embedding.cached_embedding import CacheEmbedding
from core.model_manager import ModelManager
from core.model_runtime.entities.model_entities import ModelType
from core.rag.datasource.entity.embedding import Embeddings
from core.rag.datasource.retrieval_service import RetrievalService
from core.rag.models.document import Document
from core.rag.retrieval.retrival_methods import RetrievalMethod
from extensions.ext_database import db
from models.account import Account
from models.dataset import Dataset, DatasetQuery, DocumentSegment

default_retrieval_model = {
    'search_method': RetrievalMethod.SEMANTIC_SEARCH,
    'reranking_enable': False,
    'reranking_model': {
        'reranking_provider_name': '',
        'reranking_model_name': ''
    },
    'top_k': 2,
    'score_threshold_enabled': False
}


class HitTestingService:
    @classmethod
    def retrieve(cls, dataset: Dataset, query: str, account: Account, retrieval_model: dict, limit: int = 10) -> dict:
        if dataset.available_document_count == 0 or dataset.available_segment_count == 0:
            return {
                "query": {
                    "content": query,
                    "tsne_position": {'x': 0, 'y': 0},
                },
                "records": []
            }

        start = time.perf_counter()

        # get retrieval model , if the model is not setting , using default
        if not retrieval_model:
            retrieval_model = dataset.retrieval_model if dataset.retrieval_model else default_retrieval_model

        # get embedding model
        model_manager = ModelManager()
        embedding_model = model_manager.get_model_instance(
            tenant_id=dataset.tenant_id,
            model_type=ModelType.TEXT_EMBEDDING,
            provider=dataset.embedding_model_provider,
            model=dataset.embedding_model
        )

        embeddings = CacheEmbedding(embedding_model)

        all_documents = RetrievalService.retrieve(retrival_method=retrieval_model['search_method'],
                                                  dataset_id=dataset.id,
                                                  query=query,
                                                  top_k=retrieval_model['top_k'],
                                                  score_threshold=retrieval_model['score_threshold']
                                                  if retrieval_model['score_threshold_enabled'] else None,
                                                  reranking_model=retrieval_model['reranking_model']
                                                  if retrieval_model['reranking_enable'] else None
                                                  )

        end = time.perf_counter()
        logging.debug(f"Hit testing retrieve in {end - start:0.4f} seconds")

        dataset_query = DatasetQuery(
            dataset_id=dataset.id,
            content=query,
            source='hit_testing',
            created_by_role='account',
            created_by=account.id
        )

        db.session.add(dataset_query)
        db.session.commit()

        return cls.compact_retrieve_response(dataset, embeddings, query, all_documents)

    @classmethod
    def compact_retrieve_response(cls, dataset: Dataset, embeddings: Embeddings, query: str, documents: list[Document]):
        text_embeddings = [
            embeddings.embed_query(query)
        ]

        text_embeddings.extend(embeddings.embed_documents([document.page_content for document in documents]))

        tsne_position_data = cls.get_tsne_positions_from_embeddings(text_embeddings)

        query_position = tsne_position_data.pop(0)

        i = 0
        records = []
        for document in documents:
            index_node_id = document.metadata['doc_id']

            segment = db.session.query(DocumentSegment).filter(
                DocumentSegment.dataset_id == dataset.id,
                DocumentSegment.enabled == True,
                DocumentSegment.status == 'completed',
                DocumentSegment.index_node_id == index_node_id
            ).first()

            if not segment:
                i += 1
                continue

            record = {
                "segment": segment,
                "score": document.metadata.get('score', None),
                "tsne_position": tsne_position_data[i]
            }

            records.append(record)

            i += 1

        return {
            "query": {
                "content": query,
                "tsne_position": query_position,
            },
            "records": records
        }

    @classmethod
    def get_tsne_positions_from_embeddings(cls, embeddings: list):
        embedding_length = len(embeddings)
        if embedding_length <= 1:
            return [{'x': 0, 'y': 0}]

        noise = np.random.normal(0, 1e-4, np.array(embeddings).shape)
        concatenate_data = np.array(embeddings) + noise
        concatenate_data = concatenate_data.reshape(embedding_length, -1)

        perplexity = embedding_length / 2 + 1
        if perplexity >= embedding_length:
            perplexity = max(embedding_length - 1, 1)

        tsne = TSNE(n_components=2, perplexity=perplexity, early_exaggeration=12.0)
        data_tsne = tsne.fit_transform(concatenate_data)

        tsne_position_data = []
        for i in range(len(data_tsne)):
            tsne_position_data.append({'x': float(data_tsne[i][0]), 'y': float(data_tsne[i][1])})

        return tsne_position_data

    @classmethod
    def hit_testing_args_check(cls, args):
        query = args['query']

        if not query or len(query) > 250:
            raise ValueError('Query is required and cannot exceed 250 characters')
