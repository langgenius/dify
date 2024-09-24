import base64
import logging
from typing import Optional, cast

import numpy as np
from sqlalchemy.exc import IntegrityError

from core.embedding.embedding_constant import EmbeddingInputType
from core.model_manager import ModelInstance
from core.model_runtime.entities.model_entities import ModelPropertyKey
from core.model_runtime.model_providers.__base.text_embedding_model import TextEmbeddingModel
from core.rag.datasource.entity.embedding import Embeddings
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from libs import helper
from models.dataset import Embedding

logger = logging.getLogger(__name__)


class CacheEmbedding(Embeddings):
    def __init__(self, model_instance: ModelInstance, user: Optional[str] = None) -> None:
        self._model_instance = model_instance
        self._user = user

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        """Embed search docs in batches of 10."""
        # use doc embedding cache or store if not exists
        text_embeddings = [None for _ in range(len(texts))]
        embedding_queue_indices = []
        for i, text in enumerate(texts):
            hash = helper.generate_text_hash(text)
            embedding = (
                db.session.query(Embedding)
                .filter_by(
                    model_name=self._model_instance.model, hash=hash, provider_name=self._model_instance.provider
                )
                .first()
            )
            if embedding:
                text_embeddings[i] = embedding.get_embedding()
            else:
                embedding_queue_indices.append(i)
        if embedding_queue_indices:
            embedding_queue_texts = [texts[i] for i in embedding_queue_indices]
            embedding_queue_embeddings = []
            try:
                model_type_instance = cast(TextEmbeddingModel, self._model_instance.model_type_instance)
                model_schema = model_type_instance.get_model_schema(
                    self._model_instance.model, self._model_instance.credentials
                )
                max_chunks = (
                    model_schema.model_properties[ModelPropertyKey.MAX_CHUNKS]
                    if model_schema and ModelPropertyKey.MAX_CHUNKS in model_schema.model_properties
                    else 1
                )
                for i in range(0, len(embedding_queue_texts), max_chunks):
                    batch_texts = embedding_queue_texts[i : i + max_chunks]

                    embedding_result = self._model_instance.invoke_text_embedding(
                        texts=batch_texts, user=self._user, input_type=EmbeddingInputType.DOCUMENT
                    )

                    for vector in embedding_result.embeddings:
                        try:
                            normalized_embedding = (vector / np.linalg.norm(vector)).tolist()
                            embedding_queue_embeddings.append(normalized_embedding)
                        except IntegrityError:
                            db.session.rollback()
                        except Exception as e:
                            logging.exception("Failed transform embedding: %s", e)
                cache_embeddings = []
                try:
                    for i, embedding in zip(embedding_queue_indices, embedding_queue_embeddings):
                        text_embeddings[i] = embedding
                        hash = helper.generate_text_hash(texts[i])
                        if hash not in cache_embeddings:
                            embedding_cache = Embedding(
                                model_name=self._model_instance.model,
                                hash=hash,
                                provider_name=self._model_instance.provider,
                            )
                            embedding_cache.set_embedding(embedding)
                            db.session.add(embedding_cache)
                            cache_embeddings.append(hash)
                    db.session.commit()
                except IntegrityError:
                    db.session.rollback()
            except Exception as ex:
                db.session.rollback()
                logger.error("Failed to embed documents: %s", ex)
                raise ex

        return text_embeddings

    def embed_query(self, text: str) -> list[float]:
        """Embed query text."""
        # use doc embedding cache or store if not exists
        hash = helper.generate_text_hash(text)
        embedding_cache_key = f"{self._model_instance.provider}_{self._model_instance.model}_{hash}"
        embedding = redis_client.get(embedding_cache_key)
        if embedding:
            redis_client.expire(embedding_cache_key, 600)
            return list(np.frombuffer(base64.b64decode(embedding), dtype="float"))
        try:
            embedding_result = self._model_instance.invoke_text_embedding(
                texts=[text], user=self._user, input_type=EmbeddingInputType.QUERY
            )

            embedding_results = embedding_result.embeddings[0]
            embedding_results = (embedding_results / np.linalg.norm(embedding_results)).tolist()
        except Exception as ex:
            raise ex

        try:
            # encode embedding to base64
            embedding_vector = np.array(embedding_results)
            vector_bytes = embedding_vector.tobytes()
            # Transform to Base64
            encoded_vector = base64.b64encode(vector_bytes)
            # Transform to string
            encoded_str = encoded_vector.decode("utf-8")
            redis_client.setex(embedding_cache_key, 600, encoded_str)
        except Exception as ex:
            logging.exception("Failed to add embedding to redis %s", ex)

        return embedding_results
