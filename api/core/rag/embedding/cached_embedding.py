import base64
import logging
import random
import time
from typing import Any, Optional, cast

import numpy as np
from sqlalchemy.exc import IntegrityError

from configs import dify_config
from core.entities.embedding_type import EmbeddingInputType
from core.model_manager import ModelInstance
from core.model_runtime.entities.model_entities import ModelPropertyKey
from core.model_runtime.model_providers.__base.text_embedding_model import TextEmbeddingModel
from core.rag.embedding.embedding_base import Embeddings
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from libs import helper
from models.dataset import Embedding

logger = logging.getLogger(__name__)


def retry(max_retries: int, base_delay: int, max_wait_time: int = 16):
    """
    A retry decorator that uses an exponential backoff algorithm.
    :param max_retries: The maximum number of retries.
    :param base_delay: The base delay time in seconds.
    :param max_wait_time: The maximum wait time in seconds.
    :return: The decorated function.
    """

    def decorator(func):
        def wrapper(*args, **kwargs):
            retries = 0
            while retries <= max_retries:
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    if retries == max_retries:
                        raise e
                    logger.warning(f"Attempt {retries + 1} failed: {e}")
                    retries += 1
                    delay = base_delay * 2**retries
                    if delay > max_wait_time:
                        delay = max_wait_time
                    delay += random.uniform(0, 1)
                    logger.info(f"Retrying in {delay:.2f} seconds...")
                    time.sleep(delay)

        return wrapper

    return decorator


class CacheEmbedding(Embeddings):
    def __init__(self, model_instance: ModelInstance, user: Optional[str] = None) -> None:
        self._model_instance = model_instance
        self._user = user

    @retry(max_retries=10, base_delay=1, max_wait_time=16)
    def text_embedding(self, texts: list[str]):
        return self._model_instance.invoke_text_embedding(
            texts=texts, user=self._user, input_type=EmbeddingInputType.DOCUMENT
        )

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        """Embed search docs in batches of 10."""
        # use doc embedding cache or store if not exists
        text_embeddings: list[Any] = [None for _ in range(len(texts))]
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

                    embedding_result = self.text_embedding(batch_texts)

                    for vector in embedding_result.embeddings:
                        try:
                            # FIXME: type ignore for numpy here
                            normalized_embedding = (vector / np.linalg.norm(vector)).tolist()  # type: ignore
                            # stackoverflow best way: https://stackoverflow.com/questions/20319813/how-to-check-list-containing-nan
                            if np.isnan(normalized_embedding).any():
                                # for issue #11827  float values are not json compliant
                                logger.warning(f"Normalized embedding is nan: {normalized_embedding}")
                                continue
                            embedding_queue_embeddings.append(normalized_embedding)
                        except IntegrityError:
                            db.session.rollback()
                        except Exception:
                            logging.exception("Failed transform embedding")
                cache_embeddings = []
                try:
                    for i, n_embedding in zip(embedding_queue_indices, embedding_queue_embeddings):
                        text_embeddings[i] = n_embedding
                        hash = helper.generate_text_hash(texts[i])
                        if hash not in cache_embeddings:
                            embedding_cache = Embedding(
                                model_name=self._model_instance.model,
                                hash=hash,
                                provider_name=self._model_instance.provider,
                            )
                            embedding_cache.set_embedding(n_embedding)
                            db.session.add(embedding_cache)
                            cache_embeddings.append(hash)
                    db.session.commit()
                except IntegrityError:
                    db.session.rollback()
            except Exception as ex:
                db.session.rollback()
                logger.exception("Failed to embed documents: %s")
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
            decoded_embedding = np.frombuffer(base64.b64decode(embedding), dtype="float")
            return [float(x) for x in decoded_embedding]
        try:
            embedding_result = self._model_instance.invoke_text_embedding(
                texts=[text], user=self._user, input_type=EmbeddingInputType.QUERY
            )

            embedding_results = embedding_result.embeddings[0]
            # FIXME: type ignore for numpy here
            embedding_results = (embedding_results / np.linalg.norm(embedding_results)).tolist()  # type: ignore
            if np.isnan(embedding_results).any():
                raise ValueError("Normalized embedding is nan please try again")
        except Exception as ex:
            if dify_config.DEBUG:
                logging.exception(f"Failed to embed query text '{text[:10]}...({len(text)} chars)'")
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
            if dify_config.DEBUG:
                logging.exception(f"Failed to add embedding to redis for the text '{text[:10]}...({len(text)} chars)'")
            raise ex

        return embedding_results
