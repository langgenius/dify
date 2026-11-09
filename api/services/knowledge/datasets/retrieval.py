"""Supported dataset retrieval methods for each vector store."""

from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.retrieval.retrieval_methods import RetrievalMethod


def retrieval_methods(
    vector_type: str | None, *, is_mock: bool = False, tidb_fulltext: bool = False
) -> dict[str, list[str]]:
    """
    Get supported retrieval methods based on vector database type.

    Args:
        vector_type: Vector database type, can be None
        is_mock: Whether this is a Mock API, affects MILVUS handling
        tidb_fulltext: Whether TiDB full-text retrieval is enabled

    Returns:
        Dictionary containing supported retrieval methods

    Raises:
        ValueError: If vector_type is None or unsupported
    """
    if vector_type is None:
        raise ValueError("Vector store type is not configured.")

    # Define vector database types that only support semantic search
    semantic_only_types = {
        VectorType.RELYT,
        VectorType.CHROMA,
        VectorType.PGVECTO_RS,
        VectorType.VIKINGDB,
        VectorType.UPSTASH,
    }

    # Define vector database types that support all retrieval methods
    full_search_types = {
        VectorType.QDRANT,
        VectorType.WEAVIATE,
        VectorType.OPENSEARCH,
        VectorType.ANALYTICDB,
        VectorType.MYSCALE,
        VectorType.ORACLE,
        VectorType.ELASTICSEARCH,
        VectorType.ELASTICSEARCH_JA,
        VectorType.PGVECTOR,
        VectorType.VASTBASE,
        VectorType.TIDB_ON_QDRANT,
        VectorType.LINDORM,
        VectorType.COUCHBASE,
        VectorType.OPENGAUSS,
        VectorType.OCEANBASE,
        VectorType.SEEKDB,
        VectorType.TABLESTORE,
        VectorType.HUAWEI_CLOUD,
        VectorType.TENCENT,
        VectorType.MATRIXONE,
        VectorType.CLICKZETTA,
        VectorType.BAIDU,
        VectorType.ALIBABACLOUD_MYSQL,
        VectorType.IRIS,
        VectorType.HOLOGRES,
    }

    semantic_methods = {"retrieval_method": [RetrievalMethod.SEMANTIC_SEARCH.value]}
    full_methods = {
        "retrieval_method": [
            RetrievalMethod.SEMANTIC_SEARCH.value,
            RetrievalMethod.FULL_TEXT_SEARCH.value,
            RetrievalMethod.HYBRID_SEARCH.value,
        ]
    }

    if vector_type == VectorType.MILVUS:
        return semantic_methods if is_mock else full_methods

    if vector_type == VectorType.TIDB_VECTOR:
        return full_methods if tidb_fulltext else semantic_methods

    if vector_type in semantic_only_types:
        return semantic_methods
    elif vector_type in full_search_types:
        return full_methods
    else:
        raise ValueError(f"Unsupported vector db type {vector_type}.")
