import base64
import json
import logging
from typing import List, Optional

import numpy as np
from core.model_manager import ModelInstance
from extensions.ext_database import db
from langchain.embeddings.base import Embeddings

from extensions.ext_redis import redis_client
from libs import helper
from models.dataset import Embedding
from sqlalchemy.exc import IntegrityError

logger = logging.getLogger(__name__)


class CacheEmbedding(Embeddings):
    def __init__(self, model_instance: ModelInstance, user: Optional[str] = None) -> None:
        self._model_instance = model_instance
        self._user = user

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        """Embed search docs."""
        # use doc embedding cache or store if not exists
        text_embeddings = [None for _ in range(len(texts))]
        embedding_queue_indices = []
        for i, text in enumerate(texts):
            hash = helper.generate_text_hash(text)
            embedding_cache_key = f'{self._model_instance.provider}_{self._model_instance.model}_{hash}'
            embedding = redis_client.get(embedding_cache_key)
            if embedding:
                redis_client.expire(embedding_cache_key, 3600)
                text_embeddings[i] = list(np.frombuffer(base64.b64decode(embedding), dtype="float"))

            else:
                embedding_queue_indices.append(i)

        if embedding_queue_indices:
            try:
                embedding_result = self._model_instance.invoke_text_embedding(
                    texts=[texts[i] for i in embedding_queue_indices],
                    user=self._user
                )

                embedding_results = embedding_result.embeddings
            except Exception as ex:
                logger.error('Failed to embed documents: ', ex)
                raise ex

            for i, indice in enumerate(embedding_queue_indices):
                hash = helper.generate_text_hash(texts[indice])

                try:
                    embedding_cache_key = f'{self._model_instance.provider}_{self._model_instance.model}_{hash}'
                    vector = embedding_results[i]
                    normalized_embedding = (vector / np.linalg.norm(vector)).tolist()
                    text_embeddings[indice] = normalized_embedding
                    # encode embedding to base64
                    embedding_vector = np.array(normalized_embedding)
                    vector_bytes = embedding_vector.tobytes()
                    # Transform to Base64
                    encoded_vector = base64.b64encode(vector_bytes)
                    # Transform to string
                    encoded_str = encoded_vector.decode("utf-8")
                    redis_client.setex(embedding_cache_key, 3600, encoded_str)

                except IntegrityError:
                    db.session.rollback()
                    continue
                except:
                    logging.exception('Failed to add embedding to redis')
                    continue

        return text_embeddings

    def embed_query(self, text: str) -> List[float]:
        """Embed query text."""
        # use doc embedding cache or store if not exists
        hash = helper.generate_text_hash(text)
        embedding_cache_key = f'{self._model_instance.provider}_{self._model_instance.model}_{hash}'
        embedding = redis_client.get(embedding_cache_key)
        if embedding:
            redis_client.expire(embedding_cache_key, 3600)
            return list(np.frombuffer(base64.b64decode(embedding), dtype="float"))


        try:
            embedding_result = self._model_instance.invoke_text_embedding(
                texts=[text],
                user=self._user
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
            redis_client.setex(embedding_cache_key, 3600, encoded_str)

        except IntegrityError:
            db.session.rollback()
        except:
            logging.exception('Failed to add embedding to redis')

        return embedding_results
