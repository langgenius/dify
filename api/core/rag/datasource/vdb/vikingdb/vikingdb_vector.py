import json
from typing import Any

from pydantic import BaseModel
from volcengine.viking_db import (  # type: ignore
    Data,
    DistanceType,
    Field,
    FieldType,
    IndexType,
    QuantType,
    VectorIndexParams,
    VikingDBService,
)

from configs import dify_config
from core.rag.datasource.vdb.field import Field as vdb_Field
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document
from extensions.ext_redis import redis_client
from models.dataset import Dataset


class VikingDBConfig(BaseModel):
    access_key: str
    secret_key: str
    host: str
    region: str
    scheme: str
    connection_timeout: int
    socket_timeout: int
    index_type: str = str(IndexType.HNSW)
    distance: str = str(DistanceType.L2)
    quant: str = str(QuantType.Float)


class VikingDBVector(BaseVector):
    def __init__(self, collection_name: str, group_id: str, config: VikingDBConfig):
        super().__init__(collection_name)
        self._group_id = group_id
        self._client_config = config
        self._index_name = f"{self._collection_name}_idx"
        self._client = VikingDBService(
            host=config.host,
            region=config.region,
            scheme=config.scheme,
            connection_timeout=config.connection_timeout,
            socket_timeout=config.socket_timeout,
            ak=config.access_key,
            sk=config.secret_key,
        )

    def _has_collection(self) -> bool:
        try:
            self._client.get_collection(self._collection_name)
        except Exception:
            return False
        return True

    def _has_index(self) -> bool:
        try:
            self._client.get_index(self._collection_name, self._index_name)
        except Exception:
            return False
        return True

    def _create_collection(self, dimension: int):
        lock_name = f"vector_indexing_lock_{self._collection_name}"
        with redis_client.lock(lock_name, timeout=20):
            collection_exist_cache_key = f"vector_indexing_{self._collection_name}"
            if redis_client.get(collection_exist_cache_key):
                return

            if not self._has_collection():
                fields = [
                    Field(field_name=vdb_Field.PRIMARY_KEY, field_type=FieldType.String, is_primary_key=True),
                    Field(field_name=vdb_Field.METADATA_KEY, field_type=FieldType.String),
                    Field(field_name=vdb_Field.GROUP_KEY, field_type=FieldType.String),
                    Field(field_name=vdb_Field.CONTENT_KEY, field_type=FieldType.Text),
                    Field(field_name=vdb_Field.VECTOR, field_type=FieldType.Vector, dim=dimension),
                ]

                self._client.create_collection(
                    collection_name=self._collection_name,
                    fields=fields,
                    description="Collection For Dify",
                )

            if not self._has_index():
                vector_index = VectorIndexParams(
                    distance=self._client_config.distance,
                    index_type=self._client_config.index_type,
                    quant=self._client_config.quant,
                )

                self._client.create_index(
                    collection_name=self._collection_name,
                    index_name=self._index_name,
                    vector_index=vector_index,
                    partition_by=vdb_Field.GROUP_KEY,
                    description="Index For Dify",
                )
            redis_client.set(collection_exist_cache_key, 1, ex=3600)

    def get_type(self) -> str:
        return VectorType.VIKINGDB

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        dimension = len(embeddings[0])
        self._create_collection(dimension)
        self.add_texts(texts, embeddings, **kwargs)

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        page_contents = [doc.page_content for doc in documents]
        metadatas = [doc.metadata for doc in documents]
        docs = []

        for i, page_content in enumerate(page_contents):
            metadata = {}
            if metadatas is not None:
                for key, val in (metadatas[i] or {}).items():
                    metadata[key] = val
            # FIXME: fix the type of metadata later
            doc = Data(
                {
                    vdb_Field.PRIMARY_KEY: metadatas[i]["doc_id"],  # type: ignore
                    vdb_Field.VECTOR: embeddings[i] if embeddings else None,
                    vdb_Field.CONTENT_KEY: page_content,
                    vdb_Field.METADATA_KEY: json.dumps(metadata),
                    vdb_Field.GROUP_KEY: self._group_id,
                }
            )
            docs.append(doc)

        self._client.get_collection(self._collection_name).upsert_data(docs)

    def text_exists(self, id: str) -> bool:
        docs = self._client.get_collection(self._collection_name).fetch_data(id)
        not_exists_str = "data does not exist"
        if docs is not None and not_exists_str not in docs.fields.get("message", ""):
            return True
        return False

    def delete_by_ids(self, ids: list[str]):
        self._client.get_collection(self._collection_name).delete_data(ids)

    def get_ids_by_metadata_field(self, key: str, value: str):
        # Note: Metadata field value is an dict, but vikingdb field
        # not support json type
        results = self._client.get_index(self._collection_name, self._index_name).search(
            filter={"op": "must", "field": vdb_Field.GROUP_KEY, "conds": [self._group_id]},
            # max value is 5000
            limit=5000,
        )

        if not results:
            return []

        ids = []
        for result in results:
            metadata = result.fields.get(vdb_Field.METADATA_KEY)
            if metadata is not None:
                metadata = json.loads(metadata)
                if metadata.get(key) == value:
                    ids.append(result.id)
        return ids

    def delete_by_metadata_field(self, key: str, value: str):
        ids = self.get_ids_by_metadata_field(key, value)
        self.delete_by_ids(ids)

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        results = self._client.get_index(self._collection_name, self._index_name).search_by_vector(
            query_vector, limit=kwargs.get("top_k", 4)
        )
        score_threshold = float(kwargs.get("score_threshold") or 0.0)
        docs = self._get_search_res(results, score_threshold)
        document_ids_filter = kwargs.get("document_ids_filter")
        if document_ids_filter:
            docs = [doc for doc in docs if doc.metadata.get("document_id") in document_ids_filter]
        return docs

    def _get_search_res(self, results, score_threshold) -> list[Document]:
        if len(results) == 0:
            return []

        docs = []
        for result in results:
            metadata = result.fields.get(vdb_Field.METADATA_KEY)
            if metadata is not None:
                metadata = json.loads(metadata)
            if result.score >= score_threshold:
                metadata["score"] = result.score
                doc = Document(page_content=result.fields.get(vdb_Field.CONTENT_KEY), metadata=metadata)
                docs.append(doc)
        docs = sorted(docs, key=lambda x: x.metadata.get("score", 0) if x.metadata else 0, reverse=True)
        return docs

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        return []

    def delete(self):
        if self._has_index():
            self._client.drop_index(self._collection_name, self._index_name)
        if self._has_collection():
            self._client.drop_collection(self._collection_name)


class VikingDBVectorFactory(AbstractVectorFactory):
    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> VikingDBVector:
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            collection_name = class_prefix.lower()
        else:
            dataset_id = dataset.id
            collection_name = Dataset.gen_collection_name_by_id(dataset_id).lower()
            dataset.index_struct = json.dumps(self.gen_index_struct_dict(VectorType.VIKINGDB, collection_name))

        if dify_config.VIKINGDB_ACCESS_KEY is None:
            raise ValueError("VIKINGDB_ACCESS_KEY should not be None")
        if dify_config.VIKINGDB_SECRET_KEY is None:
            raise ValueError("VIKINGDB_SECRET_KEY should not be None")
        if dify_config.VIKINGDB_HOST is None:
            raise ValueError("VIKINGDB_HOST should not be None")
        if dify_config.VIKINGDB_REGION is None:
            raise ValueError("VIKINGDB_REGION should not be None")
        if dify_config.VIKINGDB_SCHEME is None:
            raise ValueError("VIKINGDB_SCHEME should not be None")
        return VikingDBVector(
            collection_name=collection_name,
            group_id=dataset.id,
            config=VikingDBConfig(
                access_key=dify_config.VIKINGDB_ACCESS_KEY,
                secret_key=dify_config.VIKINGDB_SECRET_KEY,
                host=dify_config.VIKINGDB_HOST,
                region=dify_config.VIKINGDB_REGION,
                scheme=dify_config.VIKINGDB_SCHEME,
                connection_timeout=dify_config.VIKINGDB_CONNECTION_TIMEOUT,
                socket_timeout=dify_config.VIKINGDB_SOCKET_TIMEOUT,
            ),
        )
