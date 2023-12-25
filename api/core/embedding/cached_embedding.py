import logging
from typing import List, Optional

import numpy as np
from langchain.embeddings.base import Embeddings
from sqlalchemy.exc import IntegrityError

from core.model_manager import ModelInstance
from extensions.ext_database import db
from libs import helper
from models.dataset import Embedding

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
            embedding = db.session.query(Embedding).filter_by(model_name=self._model_instance.model, hash=hash).first()
            if embedding:
                text_embeddings[i] = embedding.get_embedding()
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
                    embedding = Embedding(model_name=self._model_instance.model, hash=hash)
                    vector = embedding_results[i]
                    normalized_embedding = (vector / np.linalg.norm(vector)).tolist()
                    text_embeddings[indice] = normalized_embedding
                    embedding.set_embedding(normalized_embedding)
                    db.session.add(embedding)
                    db.session.commit()
                except IntegrityError:
                    db.session.rollback()
                    continue
                except:
                    logging.exception('Failed to add embedding to db')
                    continue

        return text_embeddings

    def embed_query(self, text: str) -> List[float]:
        """Embed query text."""
        # use doc embedding cache or store if not exists
        hash = helper.generate_text_hash(text)
        embedding = db.session.query(Embedding).filter_by(model_name=self._model_instance.model, hash=hash).first()
        if embedding:
            return embedding.get_embedding()

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
            embedding = Embedding(model_name=self._model_instance.model, hash=hash)
            embedding.set_embedding(embedding_results)
            db.session.add(embedding)
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
        except:
            logging.exception('Failed to add embedding to db')

        return embedding_results
