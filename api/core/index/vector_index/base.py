import json
import logging
from abc import abstractmethod
from typing import List, Any, cast

from langchain.embeddings.base import Embeddings
from langchain.schema import Document, BaseRetriever
from langchain.vectorstores import VectorStore
from weaviate import UnexpectedStatusCodeException

from core.index.base import BaseIndex
from extensions.ext_database import db
from models.dataset import Dataset, DocumentSegment
from models.dataset import Document as DatasetDocument


class BaseVectorIndex(BaseIndex):
    
    def __init__(self, dataset: Dataset, embeddings: Embeddings):
        super().__init__(dataset)
        self._embeddings = embeddings
        self._vector_store = None
        
    def get_type(self) -> str:
        raise NotImplementedError

    @abstractmethod
    def get_index_name(self, dataset: Dataset) -> str:
        raise NotImplementedError

    @abstractmethod
    def to_index_struct(self) -> dict:
        raise NotImplementedError

    @abstractmethod
    def _get_vector_store(self) -> VectorStore:
        raise NotImplementedError

    @abstractmethod
    def _get_vector_store_class(self) -> type:
        raise NotImplementedError

    def search(
            self, query: str,
            **kwargs: Any
    ) -> List[Document]:
        vector_store = self._get_vector_store()
        vector_store = cast(self._get_vector_store_class(), vector_store)

        search_type = kwargs.get('search_type') if kwargs.get('search_type') else 'similarity'
        search_kwargs = kwargs.get('search_kwargs') if kwargs.get('search_kwargs') else {}

        if search_type == 'similarity_score_threshold':
            score_threshold = search_kwargs.get("score_threshold")
            if (score_threshold is None) or (not isinstance(score_threshold, float)):
                search_kwargs['score_threshold'] = .0

            docs_with_similarity = vector_store.similarity_search_with_relevance_scores(
                query, **search_kwargs
            )

            docs = []
            for doc, similarity in docs_with_similarity:
                doc.metadata['score'] = similarity
                docs.append(doc)

            return docs

        # similarity k
        # mmr k, fetch_k, lambda_mult
        # similarity_score_threshold k
        return vector_store.as_retriever(
            search_type=search_type,
            search_kwargs=search_kwargs
        ).get_relevant_documents(query)

    def get_retriever(self, **kwargs: Any) -> BaseRetriever:
        vector_store = self._get_vector_store()
        vector_store = cast(self._get_vector_store_class(), vector_store)

        return vector_store.as_retriever(**kwargs)

    def add_texts(self, texts: list[Document], **kwargs):
        if self._is_origin():
            self.recreate_dataset(self.dataset)

        vector_store = self._get_vector_store()
        vector_store = cast(self._get_vector_store_class(), vector_store)

        if kwargs.get('duplicate_check', False):
            texts = self._filter_duplicate_texts(texts)

        uuids = self._get_uuids(texts)
        vector_store.add_documents(texts, uuids=uuids)

    def text_exists(self, id: str) -> bool:
        vector_store = self._get_vector_store()
        vector_store = cast(self._get_vector_store_class(), vector_store)

        return vector_store.text_exists(id)

    def delete_by_ids(self, ids: list[str]) -> None:
        if self._is_origin():
            self.recreate_dataset(self.dataset)
            return

        vector_store = self._get_vector_store()
        vector_store = cast(self._get_vector_store_class(), vector_store)

        for node_id in ids:
            vector_store.del_text(node_id)

    def delete(self) -> None:
        vector_store = self._get_vector_store()
        vector_store = cast(self._get_vector_store_class(), vector_store)

        vector_store.delete()

    def _is_origin(self):
        return False

    def recreate_dataset(self, dataset: Dataset):
        logging.info(f"Recreating dataset {dataset.id}")

        try:
            self.delete()
        except UnexpectedStatusCodeException as e:
            if e.status_code != 400:
                # 400 means index not exists
                raise e

        dataset_documents = db.session.query(DatasetDocument).filter(
            DatasetDocument.dataset_id == dataset.id,
            DatasetDocument.indexing_status == 'completed',
            DatasetDocument.enabled == True,
            DatasetDocument.archived == False,
        ).all()

        documents = []
        for dataset_document in dataset_documents:
            segments = db.session.query(DocumentSegment).filter(
                DocumentSegment.document_id == dataset_document.id,
                DocumentSegment.status == 'completed',
                DocumentSegment.enabled == True
            ).all()
            
            for segment in segments:
                document = Document(
                    page_content=segment.content,
                    metadata={
                        "doc_id": segment.index_node_id,
                        "doc_hash": segment.index_node_hash,
                        "document_id": segment.document_id,
                        "dataset_id": segment.dataset_id,
                    }
                )

                documents.append(document)

        origin_index_struct = self.dataset.index_struct[:]
        self.dataset.index_struct = None

        if documents:
            try:
                self.create(documents)
            except Exception as e:
                self.dataset.index_struct = origin_index_struct
                raise e

            dataset.index_struct = json.dumps(self.to_index_struct())

        db.session.commit()

        self.dataset = dataset
        logging.info(f"Dataset {dataset.id} recreate successfully.")
