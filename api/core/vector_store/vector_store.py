from flask import Flask
from llama_index import ServiceContext, GPTVectorStoreIndex
from requests import ReadTimeout
from tenacity import retry, retry_if_exception_type, stop_after_attempt

from core.vector_store.qdrant_vector_store_client import QdrantVectorStoreClient
from core.vector_store.weaviate_vector_store_client import WeaviateVectorStoreClient

SUPPORTED_VECTOR_STORES = ['weaviate', 'qdrant']


class VectorStore:

    def __init__(self):
        self._vector_store = None
        self._client = None

    def init_app(self, app: Flask):
        if not app.config['VECTOR_STORE']:
            return

        self._vector_store = app.config['VECTOR_STORE']
        if self._vector_store not in SUPPORTED_VECTOR_STORES:
            raise ValueError(f"Vector store {self._vector_store} is not supported.")

        if self._vector_store == 'weaviate':
            self._client = WeaviateVectorStoreClient(
                endpoint=app.config['WEAVIATE_ENDPOINT'],
                api_key=app.config['WEAVIATE_API_KEY'],
                grpc_enabled=app.config['WEAVIATE_GRPC_ENABLED'],
                batch_size=app.config['WEAVIATE_BATCH_SIZE']
            )
        elif self._vector_store == 'qdrant':
            self._client = QdrantVectorStoreClient(
                url=app.config['QDRANT_URL'],
                api_key=app.config['QDRANT_API_KEY'],
                root_path=app.root_path
            )

        app.extensions['vector_store'] = self

    @retry(reraise=True, retry=retry_if_exception_type(ReadTimeout), stop=stop_after_attempt(3))
    def get_index(self, service_context: ServiceContext, index_struct: dict) -> GPTVectorStoreIndex:
        vector_store_config: dict = index_struct.get('vector_store')
        index = self.get_client().get_index(
            service_context=service_context,
            config=vector_store_config
        )

        return index

    def to_index_struct(self, index_id: str) -> dict:
        return {
            "type": self._vector_store,
            "vector_store": self.get_client().to_index_config(index_id)
        }

    def get_client(self):
        if not self._client:
            raise Exception("Vector store client is not initialized.")

        return self._client
