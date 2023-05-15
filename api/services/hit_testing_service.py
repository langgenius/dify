import logging
import time
from typing import List

import numpy as np
from llama_index.data_structs.node_v2 import NodeWithScore
from llama_index.indices.query.schema import QueryBundle
from llama_index.indices.vector_store import GPTVectorStoreIndexQuery
from sklearn.manifold import TSNE

from core.docstore.empty_docstore import EmptyDocumentStore
from core.index.vector_index import VectorIndex
from extensions.ext_database import db
from models.account import Account
from models.dataset import Dataset, DocumentSegment, DatasetQuery
from services.errors.index import IndexNotInitializedError


class HitTestingService:
    @classmethod
    def retrieve(cls, dataset: Dataset, query: str, account: Account, limit: int = 10) -> dict:
        index = VectorIndex(dataset=dataset).query_index

        if not index:
            raise IndexNotInitializedError()

        index_query = GPTVectorStoreIndexQuery(
            index_struct=index.index_struct,
            service_context=index.service_context,
            vector_store=index.query_context.get('vector_store'),
            docstore=EmptyDocumentStore(),
            response_synthesizer=None,
            similarity_top_k=limit
        )

        query_bundle = QueryBundle(
            query_str=query,
            custom_embedding_strs=[query],
        )

        query_bundle.embedding = index.service_context.embed_model.get_agg_embedding_from_queries(
            query_bundle.embedding_strs
        )

        start = time.perf_counter()
        nodes = index_query.retrieve(query_bundle=query_bundle)
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

        return cls.compact_retrieve_response(dataset, query_bundle, nodes)

    @classmethod
    def compact_retrieve_response(cls, dataset: Dataset, query_bundle: QueryBundle, nodes: List[NodeWithScore]):
        embeddings = [
            query_bundle.embedding
        ]

        for node in nodes:
            embeddings.append(node.node.embedding)

        tsne_position_data = cls.get_tsne_positions_from_embeddings(embeddings)

        query_position = tsne_position_data.pop(0)

        i = 0
        records = []
        for node in nodes:
            index_node_id = node.node.doc_id

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
                "score": node.score,
                "tsne_position": tsne_position_data[i]
            }

            records.append(record)

            i += 1

        return {
            "query": {
                "content": query_bundle.query_str,
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
