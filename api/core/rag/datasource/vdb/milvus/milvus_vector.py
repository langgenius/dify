from typing import Any, List, cast, Optional

from core.rag.datasource.entity.embedding import Embeddings
from core.rag.datasource.vdb.field import Field
from core.rag.datasource.vdb.vector_base import BaseVector
from core.rag.models.document import Document
from models.dataset import Dataset
from pydantic import BaseModel, root_validator
from pymilvus import MilvusClient


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

    def __init__(self, dataset: Dataset, config: MilvusConfig, embeddings: Embeddings):
        super().__init__(dataset, embeddings)
        self._client_config = config
        self._client = self._init_client(config)
        self._consistency_level = 'Session'

    def get_type(self) -> str:
        return 'milvus'

    def get_collection_name(self, dataset: Dataset) -> str:
        if self.dataset.index_struct_dict:
            class_prefix: str = self.dataset.index_struct_dict['vector_store']['class_prefix']
            if not class_prefix.endswith('_Node'):
                # original class_prefix
                class_prefix += '_Node'

            return class_prefix

        dataset_id = dataset.id
        return "Vector_index_" + dataset_id.replace("-", "_") + '_Node'

    def to_index_struct(self) -> dict:
        return {
            "type": self.get_type(),
            "vector_store": {"class_prefix": self.get_collection_name(self.dataset)}
        }

    def create(self, texts: list[Document], **kwargs) -> BaseVector:
        index_params = {
            'metric_type': 'IP',
            'index_type': "HNSW",
            'params': {"M": 8, "efConstruction": 64}
        }
        embeddings = self._embeddings.embed_documents([texts[0].page_content])
        metadatas = [d.metadata for d in texts]

        collection_name = self.create_collection(embeddings, metadatas, index_params)

        self.add_texts(texts, collection_name)

        return self

    def add_texts(self, documents: list[Document], collection_name: str, **kwargs):
        texts = [d.page_content for d in documents]
        metadatas = [d.metadata for d in documents]

        embeddings: Optional[List[List[float]]] = None
        if self._embeddings:
            if not isinstance(texts, list):
                texts = list(texts)
            embeddings = self._embeddings.embed_documents(texts)

        # Dict to hold all insert columns
        insert_dict: dict[str, list] = {
            Field.CONTENT_KEY.value: texts,
            Field.VECTOR.value: embeddings,
        }
        if metadatas is not None:
            for d in metadatas:
                insert_dict.setdefault(Field.METADATA_KEY.value, []).append(d)
        ids = self._client.insert(collection_name=collection_name, data=insert_dict)
        return ids

    def delete_by_document_id(self, document_id: str):

        ids = self.get_ids_by_metadata_field('document_id', document_id)
        if ids:
            self._client.delete(collection_name=self.get_collection_name(self.dataset), pks=ids)

    def get_ids_by_metadata_field(self, key: str, value: str):
        result = self._client.query(collection_name=self.get_collection_name(self.dataset),
                                    filter=f'metadata["{key}"] == "{value}"',
                                    output_fields=["id"])
        if result:
            return [item["id"] for item in result]
        else:
            return None

    def delete_by_metadata_field(self, key: str, value: str):

        ids = self.get_ids_by_metadata_field(key, value)
        if ids:
            self._client.delete(collection_name=self.get_collection_name(self.dataset), pks=ids)

    def delete_by_ids(self, doc_ids: list[str]) -> None:

        self._client.delete(collection_name=self.get_collection_name(self.dataset), pks=doc_ids)

    def delete(self) -> None:

        from pymilvus import utility
        utility.drop_collection(self.get_collection_name(self.dataset), None)

    def text_exists(self, id: str) -> bool:

        result = self._client.query(collection_name=self.get_collection_name(self.dataset),
                                    filter=f'metadata["doc_id"] == "{id}"',
                                    output_fields=["id"])

        return len(result) > 0

    def search_by_vector(self, query: str, **kwargs: Any) -> List[Document]:
        # Embed the query text.
        embedding = self._embeddings.embed_query(query)

        # Set search parameters.
        results = self._client.search(collection_name=self.get_collection_name(self.dataset),
                                      query_records=[embedding],
                                      anns_field=Field.VECTOR.value,
                                      limit=kwargs.get('top_k', 4),
                                      **kwargs,
                                      )
        # Organize results.
        docs = []
        for result in results[0]:
            metadata = result.entity.get(Field.METADATA_KEY.value)
            metadata['score'] = result.score
            if result.score > kwargs.get('threshold', 0.0):
                doc = Document(page_content=result.entity.get(Field.CONTENT_KEY.value),
                               metadata=metadata)
                docs.append(doc)
        return docs

    def search_by_full_text(self, query: str, **kwargs: Any) -> List[Document]:
        # milvus/zilliz doesn't support bm25 search
        return []

    def create_collection(
            self, embeddings: list, metadatas: Optional[list[dict]] = None, index_params: Optional[dict] = None
    ) -> str:
        from pymilvus import Collection, CollectionSchema, DataType, FieldSchema
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

        # Create the collection
        collection_name = self.get_collection_name(self.dataset)
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
