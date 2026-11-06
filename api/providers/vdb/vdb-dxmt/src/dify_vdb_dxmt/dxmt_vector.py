"""DXMT as a Dify vector store.

One dataset is one DXMT table, named after the dataset as every other backend names its
collection. A chunk is one record: its id is the chunk's ``doc_id``, its vector the
embedding, and its payload the chunk text under ``page_content`` beside every metadata key
Dify sets (``doc_id``, ``document_id``, ``dataset_id``, ``doc_hash``, ...). Every metadata key
is a filterable field on the server, which is what ``delete_by_metadata_field`` and the
``document_ids_filter`` of a search rely on.

The table is created with a BM25 index over ``page_content``, so ``search_by_full_text`` is a
real keyword search and the dataset can use all three of Dify's retrieval methods: semantic,
full-text and hybrid (Dify runs the two searches itself and reranks the union).
"""

import json
import logging
from typing import Any, override

from dxmt import DXMTClient
from dxmt.exceptions import DXMTError
from pydantic import BaseModel
from sqlalchemy.orm import Session

from configs import dify_config
from core.rag.datasource.vdb.vector_base import BaseVector, VectorIndexStructDict
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document
from extensions.ext_redis import redis_client
from models.dataset import Dataset

logger = logging.getLogger(__name__)

TEXT_FIELD = "page_content"


class DXMTVectorConfig(BaseModel):
    host: str
    port: int
    ssl: bool = False
    api_key: str | None = None
    text_analyzer: str = "standard"


def _not_found(e: Exception) -> bool:
    return "TABLE_NOT_FOUND" in str(e) or "NOT_FOUND" in str(e)


def _cond(key: str, type_: str, value: Any) -> dict[str, Any]:
    return {"key": key, "operation": {"type": type_, "value": value}}


class DXMTVector(BaseVector):
    def __init__(self, collection_name: str, config: DXMTVectorConfig):
        super().__init__(collection_name)
        self._config = config
        self._client = DXMTClient(host=config.host, port=config.port, ssl=config.ssl, api_key=config.api_key)

    @override
    def get_type(self) -> str:
        return VectorType.DXMT

    # ---- lifecycle ---------------------------------------------------------------------

    @override
    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        if texts:
            self._create_table(len(embeddings[0]))
            self.add_texts(texts, embeddings, **kwargs)

    def _create_table(self, dimension: int) -> None:
        lock_name = f"vector_indexing_lock_{self._collection_name}"
        with redis_client.lock(lock_name, timeout=20):
            exist_cache_key = f"vector_indexing_{self._collection_name}"
            if redis_client.get(exist_cache_key):
                return
            if not self._table_exists():
                self._client.create_table(
                    name=self._collection_name,
                    dimension=dimension,
                    distance_metric="cosine",
                    enable_full_text_search=True,
                    # The index field has to be called `content`: the server's full-text
                    # schema has fixed field names (content, title, description, tags) and
                    # only `content` is the BM25-ranked body. The source is the payload key.
                    text_fields=[
                        {
                            "name": "content",
                            "source": {"metadata_field": TEXT_FIELD},
                            "analyzer": self._config.text_analyzer,
                            "boost": 1.0,
                        }
                    ],
                )
            redis_client.set(exist_cache_key, 1, ex=3600)

    def _table_exists(self) -> bool:
        try:
            self._client.get_table(self._collection_name)
            return True
        except DXMTError as e:
            if _not_found(e):
                return False
            raise

    @override
    def delete(self):
        try:
            self._client.delete_table(self._collection_name)
        except DXMTError as e:
            if not _not_found(e):
                raise

    # ---- writes ------------------------------------------------------------------------

    @override
    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs) -> list[str]:
        uuids = self._get_uuids(documents)
        records = [
            {
                "id": doc_id,
                "vector": list(vector),
                "payload": {TEXT_FIELD: doc.page_content, **(doc.metadata or {})},
            }
            for doc_id, doc, vector in zip(uuids, documents, embeddings, strict=True)
        ]
        if records:
            self._client.insert_records(self._collection_name, records)
        return uuids

    @override
    def delete_by_ids(self, ids: list[str]):
        if not ids:
            return
        try:
            self._client.delete_records(self._collection_name, ids)
        except DXMTError as e:
            if not _not_found(e):
                raise

    @override
    def delete_by_metadata_field(self, key: str, value: str):
        try:
            self._client.delete_records(self._collection_name, filter={"must": [_cond(key, "Equal", value)]})
        except DXMTError as e:
            if not _not_found(e):
                raise

    # ---- reads -------------------------------------------------------------------------

    @override
    def text_exists(self, id: str) -> bool:
        try:
            return len(self._client.get_records(self._collection_name, [id])) > 0
        except DXMTError as e:
            if _not_found(e):
                return False
            raise

    @staticmethod
    def _filter(kwargs: dict[str, Any]) -> dict[str, Any] | None:
        document_ids_filter = kwargs.get("document_ids_filter")
        if document_ids_filter:
            return {"must": [_cond("document_id", "In", list(document_ids_filter))]}
        return None

    @staticmethod
    def _to_document(hit: dict[str, Any], score: float) -> Document:
        payload = hit.get("payload") or hit.get("metadata") or {}
        if isinstance(payload, str):
            payload = json.loads(payload)
        metadata = {k: v for k, v in payload.items() if k != TEXT_FIELD}
        metadata["score"] = score
        return Document(page_content=payload.get(TEXT_FIELD, ""), metadata=metadata)

    @override
    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        top_k = kwargs.get("top_k", 4)
        score_threshold = float(kwargs.get("score_threshold") or 0.0)
        try:
            hits = self._client.search(
                self._collection_name, vector=list(query_vector), k=top_k, filter=self._filter(kwargs)
            )
        except DXMTError as e:
            if _not_found(e):
                return []
            raise
        docs = []
        for hit in hits:
            # The server's score is a similarity: 1.0 is identical under cosine.
            score = float(hit.get("score", 0.0))
            if score >= score_threshold:
                docs.append(self._to_document(hit, score))
        docs.sort(key=lambda d: d.metadata["score"], reverse=True)
        return docs

    @override
    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        top_k = kwargs.get("top_k", 4)
        try:
            hits = self._client.full_text_search(
                self._collection_name, query=query, k=top_k, filter=self._filter(kwargs)
            )
        except DXMTError as e:
            if _not_found(e):
                return []
            raise
        return [self._to_document(hit, float(hit.get("score", 0.0))) for hit in hits]


class DXMTVectorFactory(AbstractVectorFactory):
    @override
    def init_vector(
        self, dataset: Dataset, attributes: list, embeddings: Embeddings, *, session: Session | None
    ) -> BaseVector:
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            collection_name = class_prefix.lower()
        else:
            collection_name = Dataset.gen_collection_name_by_id(dataset.id).lower()
            index_struct_dict: VectorIndexStructDict = {
                "type": VectorType.DXMT,
                "vector_store": {"class_prefix": collection_name},
            }
            dataset.index_struct = json.dumps(index_struct_dict)

        return DXMTVector(
            collection_name=collection_name,
            config=DXMTVectorConfig(
                host=dify_config.DXMT_HOST or "localhost",
                port=dify_config.DXMT_PORT,
                ssl=dify_config.DXMT_SSL,
                api_key=dify_config.DXMT_API_KEY,
                text_analyzer=dify_config.DXMT_TEXT_ANALYZER,
            ),
        )
