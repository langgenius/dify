import logging
from typing import List

from langchain.embeddings.base import Embeddings
from sqlalchemy.exc import IntegrityError

from core.llm.wrappers.openai_wrapper import handle_openai_exceptions
from extensions.ext_database import db
from libs import helper
from models.dataset import Embedding


class CacheEmbedding(Embeddings):
    def __init__(self, embeddings: Embeddings):
        self._embeddings = embeddings

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        """Embed search docs."""
        # use doc embedding cache or store if not exists
        text_embeddings = []
        embedding_queue_texts = []
        for text in texts:
            hash = helper.generate_text_hash(text)
            embedding = db.session.query(Embedding).filter_by(hash=hash).first()
            if embedding:
                text_embeddings.append(embedding.get_embedding())
            else:
                embedding_queue_texts.append(text)

        embedding_results = self._embeddings.embed_documents(embedding_queue_texts)

        i = 0
        for text in embedding_queue_texts:
            hash = helper.generate_text_hash(text)

            try:
                embedding = Embedding(hash=hash)
                embedding.set_embedding(embedding_results[i])
                db.session.add(embedding)
                db.session.commit()
            except IntegrityError:
                db.session.rollback()
                continue
            except:
                logging.exception('Failed to add embedding to db')
                continue

            i += 1

        text_embeddings.extend(embedding_results)
        return text_embeddings

    @handle_openai_exceptions
    def embed_query(self, text: str) -> List[float]:
        """Embed query text."""
        # use doc embedding cache or store if not exists
        hash = helper.generate_text_hash(text)
        embedding = db.session.query(Embedding).filter_by(hash=hash).first()
        if embedding:
            return embedding.get_embedding()

        embedding_results = self._embeddings.embed_query(text)

        try:
            embedding = Embedding(hash=hash)
            embedding.set_embedding(embedding_results)
            db.session.add(embedding)
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
        except:
            logging.exception('Failed to add embedding to db')

        return embedding_results
