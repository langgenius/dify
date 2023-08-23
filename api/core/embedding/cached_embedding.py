import logging
from typing import List

import numpy as np
from langchain.embeddings.base import Embeddings
from sqlalchemy.exc import IntegrityError

from core.model_providers.models.embedding.base import BaseEmbedding
from extensions.ext_database import db
from libs import helper
from models.dataset import Embedding


class CacheEmbedding(Embeddings):
    def __init__(self, embeddings: BaseEmbedding):
        self._embeddings = embeddings

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        """Embed search docs."""
        # use doc embedding cache or store if not exists
        text_embeddings = []
        embedding_queue_texts = []
        for text in texts:
            hash = helper.generate_text_hash(text)
            embedding = db.session.query(Embedding).filter_by(model_name=self._embeddings.name, hash=hash).first()
            if embedding:
                text_embeddings.append(embedding.get_embedding())
            else:
                embedding_queue_texts.append(text)

        if embedding_queue_texts:
            try:
                embedding_results = self._embeddings.client.embed_documents(embedding_queue_texts)
            except Exception as ex:
                raise self._embeddings.handle_exceptions(ex)
            i = 0
            normalized_embedding_results = []
            for text in embedding_queue_texts:
                hash = helper.generate_text_hash(text)

                try:
                    embedding = Embedding(model_name=self._embeddings.name, hash=hash)
                    vector = embedding_results[i]
                    normalized_embedding = (vector / np.linalg.norm(vector)).tolist()
                    normalized_embedding_results.append(normalized_embedding)
                    embedding.set_embedding(normalized_embedding)
                    db.session.add(embedding)
                    db.session.commit()
                except IntegrityError:
                    db.session.rollback()
                    continue
                except:
                    logging.exception('Failed to add embedding to db')
                    continue
                finally:
                    i += 1

            text_embeddings.extend(normalized_embedding_results)
        return text_embeddings

    def embed_query(self, text: str) -> List[float]:
        """Embed query text."""
        # use doc embedding cache or store if not exists
        hash = helper.generate_text_hash(text)
        embedding = db.session.query(Embedding).filter_by(model_name=self._embeddings.name, hash=hash).first()
        if embedding:
            return embedding.get_embedding()

        try:
            embedding_results = self._embeddings.client.embed_query(text)
            embedding_results = (embedding_results / np.linalg.norm(embedding_results)).tolist()
        except Exception as ex:
            raise self._embeddings.handle_exceptions(ex)

        try:
            embedding = Embedding(model_name=self._embeddings.name, hash=hash)
            embedding.set_embedding(embedding_results)
            db.session.add(embedding)
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
        except:
            logging.exception('Failed to add embedding to db')

        return embedding_results

