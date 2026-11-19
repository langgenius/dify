import base64
import logging
import pickle
from typing import Any, cast, override

import numpy as np
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from configs import dify_config
from core.db.session_factory import session_factory
from core.entities.embedding_type import EmbeddingInputType
from core.model_manager import ModelInstance
from core.rag.embedding.embedding_base import Embeddings
from extensions.ext_redis import redis_client
from graphon.model_runtime.entities.model_entities import ModelPropertyKey
from graphon.model_runtime.model_providers.base.text_embedding_model import TextEmbeddingModel
from libs import helper
from models.dataset import Embedding

logger = logging.getLogger(__name__)


class CacheEmbedding(Embeddings):
    QUERY_CACHE_TTL = 600

    def __init__(self, model_instance: ModelInstance):
        self._model_instance = model_instance

    @staticmethod
    def _query_cache_key(provider: str, model_name: str, query_hash: str) -> str:
        return f"{provider}_{model_name}_{query_hash}"

    @classmethod
    def get_cached_query_embedding(cls, provider: str, model_name: str, text: str) -> list[float] | None:
        """Return a cached query vector without requiring a model instance."""
        query_hash = helper.generate_text_hash(text)
        embedding_cache_key = cls._query_cache_key(provider, model_name, query_hash)
        embedding = redis_client.get(embedding_cache_key)
        if not embedding:
            return None

        redis_client.expire(embedding_cache_key, cls.QUERY_CACHE_TTL)
        decoded_embedding = np.frombuffer(base64.b64decode(embedding), dtype="float")
        return [float(x) for x in decoded_embedding]

    @override
    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        """Embed search docs in batches of 10."""
        # use doc embedding cache or store if not exists
        text_embeddings: list[Any] = [None for _ in range(len(texts))]
        embedding_queue_indices = []
        with session_factory.create_session() as session:
            for i, text in enumerate(texts):
                hash = helper.generate_text_hash(text)
                embedding = session.scalar(
                    select(Embedding)
                    .where(
                        Embedding.model_name == self._model_instance.model_name,
                        Embedding.hash == hash,
                        Embedding.provider_name == self._model_instance.provider,
                    )
                    .limit(1)
                )
                if embedding:
                    text_embeddings[i] = embedding.get_embedding()
                else:
                    embedding_queue_indices.append(i)

        if embedding_queue_indices:
            embedding_queue_texts = [texts[i] for i in embedding_queue_indices]
            try:
                model_type_instance = cast(TextEmbeddingModel, self._model_instance.model_type_instance)
                model_schema = model_type_instance.get_model_schema(
                    self._model_instance.model_name, self._model_instance.credentials
                )
                max_chunks = (
                    model_schema.model_properties[ModelPropertyKey.MAX_CHUNKS]
                    if model_schema and ModelPropertyKey.MAX_CHUNKS in model_schema.model_properties
                    else 1
                )
                for i in range(0, len(embedding_queue_texts), max_chunks):
                    batch_texts = embedding_queue_texts[i : i + max_chunks]

                    embedding_result = self._model_instance.invoke_text_embedding(
                        texts=batch_texts, input_type=EmbeddingInputType.DOCUMENT
                    )

                    # Each vector belongs to a specific text. A vector that cannot be used
                    # is dropped where it was produced, so collecting the usable vectors in a
                    # separate list and zipping that list with the indices afterwards would
                    # pair every later text with its neighbour's vector.
                    batch_indices = embedding_queue_indices[i : i + len(batch_texts)]
                    for queue_index, vector in zip(batch_indices, embedding_result.embeddings, strict=False):
                        try:
                            # FIXME: type ignore for numpy here
                            normalized_embedding = (vector / np.linalg.norm(vector)).tolist()  # type: ignore
                            # stackoverflow best way: https://stackoverflow.com/questions/20319813/how-to-check-list-containing-nan
                            if np.isnan(normalized_embedding).any():
                                # for issue #11827  float values are not json compliant
                                logger.warning("Normalized embedding is nan: %s", normalized_embedding)
                                continue
                            text_embeddings[queue_index] = normalized_embedding
                        except Exception:
                            logger.exception("Failed transform embedding")
                cache_embeddings = []
                with session_factory.create_session() as session:
                    try:
                        for queue_index in embedding_queue_indices:
                            n_embedding = text_embeddings[queue_index]
                            if n_embedding is None:
                                continue
                            hash = helper.generate_text_hash(texts[queue_index])
                            if hash not in cache_embeddings:
                                embedding_cache = Embedding(
                                    model_name=self._model_instance.model_name,
                                    hash=hash,
                                    provider_name=self._model_instance.provider,
                                    embedding=pickle.dumps(n_embedding, protocol=pickle.HIGHEST_PROTOCOL),
                                )
                                session.add(embedding_cache)
                                cache_embeddings.append(hash)
                        session.commit()
                    except IntegrityError:
                        session.rollback()
            except Exception as ex:
                logger.exception("Failed to embed documents")
                raise ex

        return text_embeddings

    @override
    def embed_multimodal_documents(self, multimodel_documents: list[dict[str, Any]]) -> list[list[float]]:
        """Embed file documents."""
        # use doc embedding cache or store if not exists
        multimodel_embeddings: list[Any] = [None for _ in range(len(multimodel_documents))]
        embedding_queue_indices = []
        with session_factory.create_session() as session:
            for i, multimodel_document in enumerate(multimodel_documents):
                file_id = multimodel_document["file_id"]
                embedding = session.scalar(
                    select(Embedding)
                    .where(
                        Embedding.model_name == self._model_instance.model_name,
                        Embedding.hash == file_id,
                        Embedding.provider_name == self._model_instance.provider,
                    )
                    .limit(1)
                )
                if embedding:
                    multimodel_embeddings[i] = embedding.get_embedding()
                else:
                    embedding_queue_indices.append(i)

        if embedding_queue_indices:
            embedding_queue_multimodel_documents = [multimodel_documents[i] for i in embedding_queue_indices]
            try:
                model_type_instance = cast(TextEmbeddingModel, self._model_instance.model_type_instance)
                model_schema = model_type_instance.get_model_schema(
                    self._model_instance.model_name, self._model_instance.credentials
                )
                max_chunks = (
                    model_schema.model_properties[ModelPropertyKey.MAX_CHUNKS]
                    if model_schema and ModelPropertyKey.MAX_CHUNKS in model_schema.model_properties
                    else 1
                )
                for i in range(0, len(embedding_queue_multimodel_documents), max_chunks):
                    batch_multimodel_documents = embedding_queue_multimodel_documents[i : i + max_chunks]

                    embedding_result = self._model_instance.invoke_multimodal_embedding(
                        multimodel_documents=batch_multimodel_documents,
                        input_type=EmbeddingInputType.DOCUMENT,
                    )

                    # Each vector belongs to a specific file. A vector that cannot be used is
                    # dropped where it was produced; collecting the usable vectors separately
                    # and zipping them with the indices afterwards would shift every later file.
                    batch_indices = embedding_queue_indices[i : i + len(batch_multimodel_documents)]
                    for queue_index, vector in zip(batch_indices, embedding_result.embeddings, strict=False):
                        try:
                            # FIXME: type ignore for numpy here
                            normalized_embedding = (vector / np.linalg.norm(vector)).tolist()  # type: ignore
                            # stackoverflow best way: https://stackoverflow.com/questions/20319813/how-to-check-list-containing-nan
                            if np.isnan(normalized_embedding).any():
                                # for issue #11827  float values are not json compliant
                                logger.warning("Normalized embedding is nan: %s", normalized_embedding)
                                continue
                            multimodel_embeddings[queue_index] = normalized_embedding
                        except Exception:
                            logger.exception("Failed transform embedding")
                cache_embeddings = []
                with session_factory.create_session() as session:
                    try:
                        for queue_index in embedding_queue_indices:
                            n_embedding = multimodel_embeddings[queue_index]
                            if n_embedding is None:
                                continue
                            file_id = multimodel_documents[queue_index]["file_id"]
                            if file_id not in cache_embeddings:
                                embedding_cache = Embedding(
                                    model_name=self._model_instance.model_name,
                                    hash=file_id,
                                    provider_name=self._model_instance.provider,
                                    embedding=pickle.dumps(n_embedding, protocol=pickle.HIGHEST_PROTOCOL),
                                )
                                embedding_cache.set_embedding(n_embedding)
                                session.add(embedding_cache)
                                cache_embeddings.append(file_id)
                        session.commit()
                    except IntegrityError:
                        session.rollback()
            except Exception as ex:
                logger.exception("Failed to embed documents")
                raise ex

        return multimodel_embeddings

    @override
    def embed_query(self, text: str) -> list[float]:
        """Embed query text."""
        # use doc embedding cache or store if not exists
        hash = helper.generate_text_hash(text)
        embedding_cache_key = self._query_cache_key(
            self._model_instance.provider, self._model_instance.model_name, hash
        )
        cached_embedding = self.get_cached_query_embedding(
            self._model_instance.provider, self._model_instance.model_name, text
        )
        if cached_embedding is not None:
            return cached_embedding
        try:
            embedding_result = self._model_instance.invoke_text_embedding(
                texts=[text], input_type=EmbeddingInputType.QUERY
            )

            embedding_results = embedding_result.embeddings[0]
            # FIXME: type ignore for numpy here
            embedding_results = (embedding_results / np.linalg.norm(embedding_results)).tolist()  # type: ignore
            if np.isnan(embedding_results).any():
                raise ValueError("Normalized embedding is nan please try again")
        except Exception as ex:
            if dify_config.DEBUG:
                logger.exception("Failed to embed query text '%s...(%s chars)'", text[:10], len(text))
            raise ex

        try:
            # encode embedding to base64
            embedding_vector = np.array(embedding_results)
            vector_bytes = embedding_vector.tobytes()
            # Transform to Base64
            encoded_vector = base64.b64encode(vector_bytes)
            # Transform to string
            encoded_str = encoded_vector.decode("utf-8")
            redis_client.setex(embedding_cache_key, self.QUERY_CACHE_TTL, encoded_str)
        except Exception as ex:
            if dify_config.DEBUG:
                logger.exception(
                    "Failed to add embedding to redis for the text '%s...(%s chars)'", text[:10], len(text)
                )
            raise ex

        return embedding_results  # type: ignore

    @override
    def embed_multimodal_query(self, multimodel_document: dict[str, Any]) -> list[float]:
        """Embed multimodal documents."""
        # use doc embedding cache or store if not exists
        file_id = multimodel_document["file_id"]
        embedding_cache_key = f"{self._model_instance.provider}_{self._model_instance.model_name}_{file_id}"
        embedding = redis_client.get(embedding_cache_key)
        if embedding:
            redis_client.expire(embedding_cache_key, 600)
            decoded_embedding = np.frombuffer(base64.b64decode(embedding), dtype="float")
            return [float(x) for x in decoded_embedding]
        try:
            embedding_result = self._model_instance.invoke_multimodal_embedding(
                multimodel_documents=[multimodel_document], input_type=EmbeddingInputType.QUERY
            )

            embedding_results = embedding_result.embeddings[0]
            # FIXME: type ignore for numpy here
            embedding_results = (embedding_results / np.linalg.norm(embedding_results)).tolist()  # type: ignore
            if np.isnan(embedding_results).any():
                raise ValueError("Normalized embedding is nan please try again")
        except Exception as ex:
            if dify_config.DEBUG:
                logger.exception("Failed to embed multimodal document '%s'", multimodel_document["file_id"])
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
                logger.exception(
                    "Failed to add embedding to redis for the multimodal document '%s'", multimodel_document["file_id"]
                )
            raise ex

        return embedding_results  # type: ignore
