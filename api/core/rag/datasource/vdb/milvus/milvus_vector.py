import logging
from typing import Any, Optional
from uuid import uuid4

from pydantic import BaseModel, root_validator
from pymilvus import MilvusClient, MilvusException, connections

from core.rag.datasource.vdb.field import Field
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.models.document import Document

logger = logging.getLogger(__name__)


class MilvusConfig(BaseModel):
    host: str
    port: int
    user: str
    password: str
    secure: bool = False
    batch_size: int = 100

    @root_validator()
    def validate_config(cls, values: dict) -> dict:
        if not values['host']:
            raise ValueError("config MILVUS_HOST is required")
        if not values['port']:
            raise ValueError("config MILVUS_PORT is required")
        if not values['user']:
            raise ValueError("config MILVUS_USER is required")
        if not values['password']:
            raise ValueError("config MILVUS_PASSWORD is required")
        return values

    def to_milvus_params(self):
        return {
            'host': self.host,
            'port': self.port,
            'user': self.user,
            'password': self.password,
            'secure': self.secure
        }


class MilvusVector(BaseVector):

    def __init__(self, collection_name: str, config: MilvusConfig):
        super().__init__(collection_name)
        self._client_config = config
        self._client = self._init_client(config)
        self._consistency_level = 'Session'
        self._fields = []

    def get_type(self) -> str:
        return 'milvus'

    def create(self, texts: list[Document], embeddings: list[list[float]], **kwargs):
        index_params = {
            'metric_type': 'IP',
            'index_type': "HNSW",
            'params': {"M": 8, "efConstruction": 64}
        }
        metadatas = [d.metadata for d in texts]

        # Grab the existing collection if it exists
        from pymilvus import utility
        alias = uuid4().hex
        if self._client_config.secure:
            uri = "https://" + str(self._client_config.host) + ":" + str(self._client_config.port)
        else:
            uri = "http://" + str(self._client_config.host) + ":" + str(self._client_config.port)
        connections.connect(alias=alias, uri=uri, user=self._client_config.user, password=self._client_config.password)
        if not utility.has_collection(self._collection_name, using=alias):
            self.create_collection(embeddings, metadatas, index_params)
        self.add_texts(texts, embeddings)

    def add_texts(self, documents: list[Document], embeddings: list[list[float]], **kwargs):
        insert_dict_list = []
        for i in range(len(documents)):
            insert_dict = {
                Field.CONTENT_KEY.value: documents[i].page_content,
                Field.VECTOR.value: embeddings[i],
                Field.METADATA_KEY.value: documents[i].metadata
            }
            insert_dict_list.append(insert_dict)
        # Total insert count
        total_count = len(insert_dict_list)

        pks: list[str] = []

        for i in range(0, total_count, 1000):
            batch_insert_list = insert_dict_list[i:i + 1000]
            # Insert into the collection.
            try:
                ids = self._client.insert(collection_name=self._collection_name, data=batch_insert_list)
                pks.extend(ids)
            except MilvusException as e:
                logger.error(
                    "Failed to insert batch starting at entity: %s/%s", i, total_count
                )
                raise e
        return pks

    def delete_by_document_id(self, document_id: str):

        ids = self.get_ids_by_metadata_field('document_id', document_id)
        if ids:
            self._client.delete(collection_name=self._collection_name, pks=ids)

    def get_ids_by_metadata_field(self, key: str, value: str):
        result = self._client.query(collection_name=self._collection_name,
                                    filter=f'metadata["{key}"] == "{value}"',
                                    output_fields=["id"])
        if result:
            return [item["id"] for item in result]
        else:
            return None

    def delete_by_metadata_field(self, key: str, value: str):

        ids = self.get_ids_by_metadata_field(key, value)
        if ids:
            self._client.delete(collection_name=self._collection_name, pks=ids)

    def delete_by_ids(self, doc_ids: list[str]) -> None:

        result = self._client.query(collection_name=self._collection_name,
                                    filter=f'metadata["doc_id"] in {doc_ids}',
                                    output_fields=["id"])
        if result:
            ids = [item["id"] for item in result]
            self._client.delete(collection_name=self._collection_name, pks=ids)

    def delete(self) -> None:
        alias = uuid4().hex
        if self._client_config.secure:
            uri = "https://" + str(self._client_config.host) + ":" + str(self._client_config.port)
        else:
            uri = "http://" + str(self._client_config.host) + ":" + str(self._client_config.port)
        connections.connect(alias=alias, uri=uri, user=self._client_config.user, password=self._client_config.password)

        from pymilvus import utility
        if utility.has_collection(self._collection_name, using=alias):
            utility.drop_collection(self._collection_name, None, using=alias)

    def text_exists(self, id: str) -> bool:

        result = self._client.query(collection_name=self._collection_name,
                                    filter=f'metadata["doc_id"] == "{id}"',
                                    output_fields=["id"])

        return len(result) > 0

    def search_by_vector(self, query_vector: list[float], **kwargs: Any) -> list[Document]:

        # Set search parameters.
        results = self._client.search(collection_name=self._collection_name,
                                      data=[query_vector],
                                      limit=kwargs.get('top_k', 4),
                                      output_fields=[Field.CONTENT_KEY.value, Field.METADATA_KEY.value],
                                      )
        # Organize results.
        docs = []
        for result in results[0]:
            metadata = result['entity'].get(Field.METADATA_KEY.value)
            metadata['score'] = result['distance']
            score_threshold = kwargs.get('score_threshold') if kwargs.get('score_threshold') else 0.0
            if result['distance'] > score_threshold:
                doc = Document(page_content=result['entity'].get(Field.CONTENT_KEY.value),
                               metadata=metadata)
                docs.append(doc)
        return docs

    def search_by_full_text(self, query: str, **kwargs: Any) -> list[Document]:
        # milvus/zilliz doesn't support bm25 search
        return []

    def create_collection(
            self, embeddings: list, metadatas: Optional[list[dict]] = None, index_params: Optional[dict] = None
    ) -> str:
        from pymilvus import CollectionSchema, DataType, FieldSchema
        from pymilvus.orm.types import infer_dtype_bydata

        # Determine embedding dim
        dim = len(embeddings[0])
        fields = []
        if metadatas:
            fields.append(FieldSchema(Field.METADATA_KEY.value, DataType.JSON, max_length=65_535))

        # Create the text field
        fields.append(
            FieldSchema(Field.CONTENT_KEY.value, DataType.VARCHAR, max_length=65_535)
        )
        # Create the primary key field
        fields.append(
            FieldSchema(
                Field.PRIMARY_KEY.value, DataType.INT64, is_primary=True, auto_id=True
            )
        )
        # Create the vector field, supports binary or float vectors
        fields.append(
            FieldSchema(Field.VECTOR.value, infer_dtype_bydata(embeddings[0]), dim=dim)
        )

        # Create the schema for the collection
        schema = CollectionSchema(fields)

        for x in schema.fields:
            self._fields.append(x.name)
        # Since primary field is auto-id, no need to track it
        self._fields.remove(Field.PRIMARY_KEY.value)

        # Create the collection
        collection_name = self._collection_name
        self._client.create_collection_with_schema(collection_name=collection_name,
                                                   schema=schema, index_param=index_params,
                                                   consistency_level=self._consistency_level)
        return collection_name

    def _init_client(self, config) -> MilvusClient:
        if config.secure:
            uri = "https://" + str(config.host) + ":" + str(config.port)
        else:
            uri = "http://" + str(config.host) + ":" + str(config.port)
        client = MilvusClient(uri=uri, user=config.user, password=config.password)
        return client
