import json
from typing import Any

import pymongo
from pydantic import BaseModel
from pymongo.operations import SearchIndexModel

from configs import dify_config
from core.rag.datasource.entity.embedding import Embeddings
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.models.document import Document
from extensions.ext_redis import redis_client
from models.dataset import Dataset


class MongoDBConfig(BaseModel):
    connection_string: str
    database: str

    def to_mdb_params(self):
        return {"connection_string": self.connection_string, "database": self.database}


class MongoDBVector(BaseVector):
    def __init__(self, collection_name: str, config: MongoDBConfig):
        super().__init__(collection_name)
        self._client_config = config
        self._client = pymongo.MongoClient(self._client_config.connection_string)
        self.database = self._client[self._client_config.database]

    def get_type(self) -> str:
        return VectorType.MONGDB

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        if texts:
            # create collection
            self.create_collection(self._collection_name)
            self.add_texts(texts, embeddings, **kwargs)

    # not sure how much I got to change yet
    def create_collection(self, collection_name: str):
        lock_name = "vector_indexing_lock_{}".format(collection_name)
        with redis_client.lock(lock_name, timeout=20):
            collection_exist_cache_key = "vector_indexing_{}".format(self._collection_name)
            if redis_client.get(collection_exist_cache_key):
                return
            self._client[self._client_config.database].create_collection(name=collection_name)
            # index setup
            # Create your index model, then create the search index
            search_index_model = SearchIndexModel(
                definition={
                    "fields": [
                        {
                            "type": "vector",
                            "numDimensions": "<numDimensions>",
                            "path": "<fieldToIndex>",
                            "similarity": "euclidean | cosine | dotProduct",
                        },
                        {"type": "filter", "path": "<fieldToIndex>"},
                    ]
                },
                name="<indexName>",
                type="vectorSearch",
            )
            result = self.database[collection_name].create_search_index(model=search_index_model)
            redis_client.set(collection_exist_cache_key, 1, ex=3600)

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        uuids = self._get_uuids(documents)
        texts = [d.page_content for d in documents]
        metadatas = [d.metadata for d in documents]

        collection = self.database[self._collection_name]
        # mongodb upsert
        # (ids=uuids, documents=texts, embeddings=embeddings, metadatas=metadatas)

    def delete_by_metadata_field(self, key: str, value: str):
        collection = self.database[self._collection_name]
        collection.delete_many({key: {"$eq": value}})

    def delete(self):
        self.database.drop_collection(self._collection_name)

    def delete_by_ids(self, ids: list[str]) -> None:
        collection = self.database[self._collection_name]
        collection.delete_many({"_id": {"$in": ids}})

    def text_exists(self, id: str) -> bool:
        collection = self.database[self._collection_name]
        response = collection.find_one({"_id": id})  # todo: this may not work
        return len(response) > 0

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        # todo: mongodb search by vector
        return []

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        # todo: mongodb full text search!
        return []


class MongoDBVectorFactory(AbstractVectorFactory):
    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> BaseVector:
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            collection_name = class_prefix.lower()
        else:
            dataset_id = dataset.id
            collection_name = Dataset.gen_collection_name_by_id(dataset_id).lower()
            index_struct_dict = {"type": VectorType.MONGODB, "vector_store": {"class_prefix": collection_name}}
            dataset.index_struct = json.dumps(index_struct_dict)

        return MongoDBVector(
            collection_name=collection_name,
            config=MongoDBConfig(
                connection_string=dify_config.MONGODB_CONNECTION_STRING, database=dify_config.MONGODB_DATABASE
            ),
        )
