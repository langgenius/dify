"""Supported dataset retrieval methods for each vector store."""

from collections.abc import Callable, Iterable

from core.rag.datasource.vdb.vector_type import VectorType
from core.rag.retrieval.retrieval_methods import RetrievalMethod

DeclaredRetrievalMethods = Callable[[str], Iterable[str] | None]
"""Looks up the retrieval methods an installed, non-built-in backend declares (``None``: nothing declared)."""


def retrieval_methods(
    vector_type: str | None,
    *,
    is_mock: bool = False,
    tidb_fulltext: bool = False,
    declared_methods: DeclaredRetrievalMethods | None = None,
) -> dict[str, list[str]]:
    """
    Get supported retrieval methods based on vector database type.

    Args:
        vector_type: Vector database type, can be None
        is_mock: Whether this is a Mock API, affects MILVUS handling
        tidb_fulltext: Whether TiDB full-text retrieval is enabled
        declared_methods: Lookup for backends that are not built in, such as packages registered
            under the ``dify.vector_backends`` entry-point group. Only consulted after every
            built-in rule, so it can't change what a built-in backend reports.

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
        declared = declared_methods(vector_type) if declared_methods is not None else None
        if declared is None:
            raise ValueError(f"Unsupported vector db type {vector_type}.")
        return {"retrieval_method": _validate_declared_methods(vector_type, declared)}


# Methods the dataset vector path implements. Keyword search runs on the keyword table, not the vector store.
_DECLARABLE_METHODS = (
    RetrievalMethod.SEMANTIC_SEARCH,
    RetrievalMethod.FULL_TEXT_SEARCH,
    RetrievalMethod.HYBRID_SEARCH,
)
# Hybrid search runs the semantic and the full-text search and fuses the results.
_HYBRID_PARTS = {RetrievalMethod.SEMANTIC_SEARCH, RetrievalMethod.FULL_TEXT_SEARCH}


def _validate_declared_methods(vector_type: str, declared: Iterable[str]) -> list[str]:
    if isinstance(declared, str):
        raise ValueError(f"Vector store {vector_type!r} must declare a list of retrieval methods, not a string.")
    methods = set(declared)
    invalid = sorted(str(m) for m in methods - set(_DECLARABLE_METHODS))
    if invalid:
        raise ValueError(
            f"Vector store {vector_type!r} declares unsupported retrieval methods {invalid}; "
            f"expected a subset of {[m.value for m in _DECLARABLE_METHODS]}."
        )
    if not methods:
        raise ValueError(f"Vector store {vector_type!r} declares no retrieval methods.")
    if RetrievalMethod.HYBRID_SEARCH in methods and not methods >= _HYBRID_PARTS:
        raise ValueError(
            f"Vector store {vector_type!r} declares hybrid search, which also needs semantic and full-text search."
        )
    return [m.value for m in _DECLARABLE_METHODS if m in methods]
