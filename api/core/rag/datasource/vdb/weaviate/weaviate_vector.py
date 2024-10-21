import datetime
import json
from typing import Any, Optional

import requests
import weaviate
from pydantic import BaseModel, model_validator

from configs import dify_config
from core.rag.datasource.vdb.field import Field
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.datasource.vdb.vector_factory import AbstractVectorFactory
from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.embedding.embedding_base import Embeddings
from core.rag.models.document import Document
from extensions.ext_redis import redis_client
from models.dataset import Dataset


class WeaviateConfig(BaseModel):
    endpoint: str
    api_key: Optional[str] = None
    batch_size: int = 100

    @model_validator(mode="before")
    @classmethod
    def validate_config(cls, values: dict) -> dict:
        if not values["endpoint"]:
            raise ValueError("config WEAVIATE_ENDPOINT is required")
        return values


class WeaviateVector(BaseVector):
    def __init__(self, collection_name: str, config: WeaviateConfig, attributes: list):
        super().__init__(collection_name)
        self._client = self._init_client(config)
        self._attributes = attributes

    def _init_client(self, config: WeaviateConfig) -> weaviate.Client:
        auth_config = weaviate.auth.AuthApiKey(api_key=config.api_key)

        weaviate.connect.connection.has_grpc = False

        try:
            client = weaviate.Client(
                url=config.endpoint, auth_client_secret=auth_config, timeout_config=(5, 60), startup_period=None
            )
        except requests.exceptions.ConnectionError:
            raise ConnectionError("Vector database connection error")

        client.batch.configure(
            # `batch_size` takes an `int` value to enable auto-batching
            # (`None` is used for manual batching)
            batch_size=config.batch_size,
            # dynamically update the `batch_size` based on import speed
            dynamic=True,
            # `timeout_retries` takes an `int` value to retry on time outs
            timeout_retries=3,
        )

        return client

    def get_type(self) -> str:
        return VectorType.WEAVIATE

    def get_collection_name(self, dataset: Dataset) -> str:
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            if not class_prefix.endswith("_Node"):
                # original class_prefix
                class_prefix += "_Node"

            return class_prefix

        dataset_id = dataset.id
        return Dataset.gen_collection_name_by_id(dataset_id)

    def to_index_struct(self) -> dict:
        return {"type": self.get_type(), "vector_store": {"class_prefix": self._collection_name}}

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        # create collection
        self._create_collection()
        # create vector
        self.add_texts(texts, embeddings)

    def _create_collection(self):
        lock_name = "vector_indexing_lock_{}".format(self._collection_name)
        with redis_client.lock(lock_name, timeout=20):
            collection_exist_cache_key = "vector_indexing_{}".format(self._collection_name)
            if redis_client.get(collection_exist_cache_key):
                return
            schema = self._default_schema(self._collection_name)
            if not self._client.schema.contains(schema):
                # create collection
                self._client.schema.create_class(schema)
            redis_client.set(collection_exist_cache_key, 1, ex=3600)

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        uuids = self._get_uuids(documents)
        texts = [d.page_content for d in documents]
        metadatas = [d.metadata for d in documents]

        ids = []

        with self._client.batch as batch:
            for i, text in enumerate(texts):
                data_properties = {Field.TEXT_KEY.value: text}
                if metadatas is not None:
                    for key, val in metadatas[i].items():
                        data_properties[key] = self._json_serializable(val)

                batch.add_data_object(
                    data_object=data_properties,
                    class_name=self._collection_name,
                    uuid=uuids[i],
                    vector=embeddings[i] if embeddings else None,
                )
                ids.append(uuids[i])
        return ids

    def delete_by_metadata_field(self, key: str, value: str):
        # check whether the index already exists
        schema = self._default_schema(self._collection_name)
        if self._client.schema.contains(schema):
            where_filter = {"operator": "Equal", "path": [key], "valueText": value}

            self._client.batch.delete_objects(class_name=self._collection_name, where=where_filter, output="minimal")

    def delete(self):
        # check whether the index already exists
        schema = self._default_schema(self._collection_name)
        if self._client.schema.contains(schema):
            self._client.schema.delete_class(self._collection_name)

    def text_exists(self, id: str) -> bool:
        collection_name = self._collection_name
        schema = self._default_schema(self._collection_name)

        # check whether the index already exists
        if not self._client.schema.contains(schema):
            return False
        result = (
            self._client.query.get(collection_name)
            .with_additional(["id"])
            .with_where(
                {
                    "path": ["doc_id"],
                    "operator": "Equal",
                    "valueText": id,
                }
            )
            .with_limit(1)
            .do()
        )

        if "errors" in result:
            raise ValueError(f"Error during query: {result['errors']}")

        entries = result["data"]["Get"][collection_name]
        if len(entries) == 0:
            return False

        return True

    def delete_by_ids(self, ids: list[str]) -> None:
        # check whether the index already exists
        schema = self._default_schema(self._collection_name)
        if self._client.schema.contains(schema):
            for uuid in ids:
                try:
                    self._client.data_object.delete(
                        class_name=self._collection_name,
                        uuid=uuid,
                    )
                except weaviate.UnexpectedStatusCodeException as e:
                    # tolerate not found error
                    if e.status_code != 404:
                        raise e

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:
        """Look up similar documents by embedding vector in Weaviate."""
        collection_name = self._collection_name
        properties = self._attributes
        properties.append(Field.TEXT_KEY.value)
        query_obj = self._client.query.get(collection_name, properties)

        vector = {"vector": query_vector}
        if kwargs.get("where_filter"):
            query_obj = query_obj.with_where(kwargs.get("where_filter"))
        result = (
            query_obj.with_near_vector(vector)
            .with_limit(kwargs.get("top_k", 4))
            .with_additional(["vector", "distance"])
            .do()
        )
        if "errors" in result:
            raise ValueError(f"Error during query: {result['errors']}")

        docs_and_scores = []
        for res in result["data"]["Get"][collection_name]:
            text = res.pop(Field.TEXT_KEY.value)
            score = 1 - res["_additional"]["distance"]
            docs_and_scores.append((Document(page_content=text, metadata=res), score))

        docs = []
        for doc, score in docs_and_scores:
            score_threshold = float(kwargs.get("score_threshold") or 0.0)
            # check score threshold
            if score > score_threshold:
                doc.metadata["score"] = score
                docs.append(doc)
        # Sort the documents by score in descending order
        docs = sorted(docs, key=lambda x: x.metadata["score"], reverse=True)
        return docs

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        """Return docs using BM25F.

        Args:
            query: Text to look up documents similar to.
            k: Number of Documents to return. Defaults to 4.

        Returns:
            List of Documents most similar to the query.
        """
        collection_name = self._collection_name
        content: dict[str, Any] = {"concepts": [query]}
        properties = self._attributes
        properties.append(Field.TEXT_KEY.value)
        if kwargs.get("search_distance"):
            content["certainty"] = kwargs.get("search_distance")
        query_obj = self._client.query.get(collection_name, properties)
        if kwargs.get("where_filter"):
            query_obj = query_obj.with_where(kwargs.get("where_filter"))
        query_obj = query_obj.with_additional(["vector"])
        properties = ["text"]
        result = query_obj.with_bm25(query=query, properties=properties).with_limit(kwargs.get("top_k", 4)).do()
        if "errors" in result:
            raise ValueError(f"Error during query: {result['errors']}")
        docs = []
        for res in result["data"]["Get"][collection_name]:
            text = res.pop(Field.TEXT_KEY.value)
            additional = res.pop("_additional")
            docs.append(Document(page_content=text, vector=additional["vector"], metadata=res))
        return docs

    def _default_schema(self, index_name: str) -> dict:
        return {
            "class": index_name,
            "properties": [
                {
                    "name": "text",
                    "dataType": ["text"],
                }
            ],
        }

    def _json_serializable(self, value: Any) -> Any:
        if isinstance(value, datetime.datetime):
            return value.isoformat()
        return value


class WeaviateVectorFactory(AbstractVectorFactory):
    def init_vector(self, dataset: Dataset, attributes: list, embeddings: Embeddings) -> WeaviateVector:
        if dataset.index_struct_dict:
            class_prefix: str = dataset.index_struct_dict["vector_store"]["class_prefix"]
            collection_name = class_prefix
        else:
            dataset_id = dataset.id
            collection_name = Dataset.gen_collection_name_by_id(dataset_id)
            dataset.index_struct = json.dumps(self.gen_index_struct_dict(VectorType.WEAVIATE, collection_name))

        return WeaviateVector(
            collection_name=collection_name,
            config=WeaviateConfig(
                endpoint=dify_config.WEAVIATE_ENDPOINT,
                api_key=dify_config.WEAVIATE_API_KEY,
                batch_size=dify_config.WEAVIATE_BATCH_SIZE,
            ),
            attributes=attributes,
        )
