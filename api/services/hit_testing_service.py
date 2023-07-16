import logging
import time
from typing import List

import numpy as np
from flask import current_app
from langchain.embeddings import OpenAIEmbeddings
from langchain.embeddings.base import Embeddings
from langchain.schema import Document
from sklearn.manifold import TSNE

from core.embedding.cached_embedding import CacheEmbedding
from core.index.vector_index.vector_index import VectorIndex
from core.llm.llm_builder import LLMBuilder
from extensions.ext_database import db
from models.account import Account
from models.dataset import Dataset, DocumentSegment, DatasetQuery


class HitTestingService:
    @classmethod
    def retrieve(cls, dataset: Dataset, query: str, account: Account, limit: int = 10) -> dict:
        if dataset.available_document_count == 0 or dataset.available_document_count == 0:
            return {
                "query": {
                    "content": query,
                    "tsne_position": {'x': 0, 'y': 0},
                },
                "records": []
            }

        model_credentials = LLMBuilder.get_model_credentials(
            tenant_id=dataset.tenant_id,
            model_provider=LLMBuilder.get_default_provider(dataset.tenant_id, 'text-embedding-ada-002'),
            model_name='text-embedding-ada-002'
        )

        embeddings = CacheEmbedding(OpenAIEmbeddings(
            **model_credentials
        ))

        vector_index = VectorIndex(
            dataset=dataset,
            config=current_app.config,
            embeddings=embeddings
        )

        start = time.perf_counter()
        documents = vector_index.search(
            query,
            search_type='similarity_score_threshold',
            search_kwargs={
                'k': 10
            }
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

        return cls.compact_retrieve_response(dataset, embeddings, query, documents)

    @classmethod
    def compact_retrieve_response(cls, dataset: Dataset, embeddings: Embeddings, query: str, documents: List[Document]):
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
                "score": document.metadata['score'],
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

        concatenate_data = np.array(embeddings).reshape(embedding_length, -1)
        # concatenate_data = np.concatenate(embeddings)

        perplexity = embedding_length / 2 + 1
        if perplexity >= embedding_length:
            perplexity = max(embedding_length - 1, 1)

        tsne = TSNE(n_components=2, perplexity=perplexity, early_exaggeration=12.0)
        data_tsne = tsne.fit_transform(concatenate_data)

        tsne_position_data = []
        for i in range(len(data_tsne)):
            tsne_position_data.append({'x': float(data_tsne[i][0]), 'y': float(data_tsne[i][1])})

        return tsne_position_data
