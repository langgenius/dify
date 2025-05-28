import json
import logging
from typing import Any, Optional

from flask import current_app

from core.rag.datasource.vdb.elasticsearch.elasticsearch_vector import (
    ElasticSearchConfig,
    ElasticSearchVector,
    ElasticSearchVectorFactory,
)
from core.rag.datasource.vdb.field import Field
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.embedding_base import Embeddings
from extensions.ext_redis import redis_client
from models.dataset import Dataset

logger = logging.getLogger(__name__)


class ElasticSearchJaVector(ElasticSearchVector):
    def create_collection(
        self,
        embeddings: list[list[float]],
        metadatas: Optional[list[dict[Any, Any]]] = None,
        index_params: Optional[dict] = None,
    ):
        lock_name = f"vector_indexing_lock_{self._collection_name}"
        with redis_client.lock(lock_name, timeout=20):
            collection_exist_cache_key = f"vector_indexing_{self._collection_name}"
            if redis_client.get(collection_exist_cache_key):
                logger.info(f"Collection {self._collection_name} already exists.")
                return

            if not self._client.indices.exists(index=self._collection_name):
                dim = len(embeddings[0])
                settings = {
                    "analysis": {
                        "analyzer": {
                            "ja_analyzer": {
                                "type": "custom",
                                "char_filter": [
                                    "icu_normalizer",
                                    "kuromoji_iteration_mark",
                                ],
                                "tokenizer": "kuromoji_tokenizer",
                                "filter": [
                                    "kuromoji_baseform",
                                    "kuromoji_part_of_speech",
                                    "ja_stop",
                                    "kuromoji_number",
                                    "kuromoji_stemmer",
                                ],
                            }
                        }
                    }
                }
                mappings = {
                    "properties": {
                        Field.CONTENT_KEY.value: {
                            "type": "text",
                            "analyzer": "ja_analyzer",
                            "search_analyzer": "ja_analyzer",
                        },
                        Field.VECTOR.value: {  # Make sure the dimension is correct here
                            "type": "dense_vector",
                            "dims": dim,
                            "index": True,
                            "similarity": "cosine",
                        },
                        Field.METADATA_KEY.value: {
                            "type": "object",
                            "properties": {
                                "doc_id": {"type": "keyword"}  # Map doc_id to keyword type
                            },
                        },
                    }
                }
                self._client.indices.create(index=self._collection_name, settings=settings, mappings=mappings)

            redis_client.set(collection_exist_cache_key, 1, ex=3600)


class ElasticSearchJaVectorFactory(ElasticSearchVectorFactory):
    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> ElasticSearchJaVector:
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            collection_name = class_prefix
        else:
            dataset_id = dataset.id
            collection_name = Dataset.gen_collection_name_by_id(dataset_id)
            dataset.index_struct = json.dumps(self.gen_index_struct_dict(VectorType.ELASTICSEARCH, collection_name))

        config = current_app.config
        return ElasticSearchJaVector(
            index_name=collection_name,
            config=ElasticSearchConfig(
                host=config.get("ELASTICSEARCH_HOST", "localhost"),
                port=config.get("ELASTICSEARCH_PORT", 9200),
                username=config.get("ELASTICSEARCH_USERNAME", ""),
                password=config.get("ELASTICSEARCH_PASSWORD", ""),
            ),
            attributes=[],
        )
