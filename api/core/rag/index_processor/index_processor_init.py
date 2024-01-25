"""Abstract interface for document loader implementations."""

from core.rag.index_processor.index_processor_base import BaseIndexProcessor
from core.rag.index_processor.constant.index_type import IndexType
from models.dataset import DatasetProcessRule


class IndexProcessorInit:
    """IndexProcessorInit.
    """

    def __init__(self, index_type: str, file_path: str, process_rule: DatasetProcessRule):
        self._file_path = file_path
        self._process_rule = process_rule
        self._index_type = index_type

    def _init_index_processor(self) -> BaseIndexProcessor:
        """Init index processor."""

        if not self._index_type:
            raise ValueError(f"Index type must be specified.")

        if self._index_type == IndexType.PARAGRAPH_INDEX.value:
            return WeaviateVector(
                dataset=dataset,
                config=WeaviateConfig(
                    endpoint=config.get('WEAVIATE_ENDPOINT'),
                    api_key=config.get('WEAVIATE_API_KEY'),
                    batch_size=int(config.get('WEAVIATE_BATCH_SIZE'))
                ),
                embeddings=embeddings,
                attributes=attributes
            )
        elif vector_type == "qdrant":
            from core.rag.datasource.vdb.qdrant.qdrant_vector import QdrantConfig, QdrantVector

            return QdrantVector(
                dataset=dataset,
                config=QdrantConfig(
                    endpoint=config.get('QDRANT_URL'),
                    api_key=config.get('QDRANT_API_KEY'),
                    root_path=current_app.root_path,
                    timeout=config.get('QDRANT_CLIENT_TIMEOUT')
                ),
                embeddings=embeddings
            )
        elif vector_type == "milvus":
            from core.rag.datasource.vdb.qdrant.qdrant_vector import MilvusConfig, MilvusVector

            return MilvusVector(
                dataset=dataset,
                config=MilvusConfig(
                    host=config.get('MILVUS_HOST'),
                    port=config.get('MILVUS_PORT'),
                    user=config.get('MILVUS_USER'),
                    password=config.get('MILVUS_PASSWORD'),
                    secure=config.get('MILVUS_SECURE'),
                ),
                embeddings=embeddings
            )
        else:
            raise ValueError(f"Vector store {config.get('VECTOR_STORE')} is not supported.")
