from enum import Enum


class VectorType(str, Enum):
    CHROMA = 'chroma'
    MILVUS = 'milvus'
    PGVECTOR = 'pgvector'
    PGVECTO_RS = 'pgvecto-rs'
    QDRANT = 'qdrant'
    RELYT = 'relyt'
    TIDB_VECTOR = 'tidb_vector'
    WEAVIATE = 'weaviate'
    OPENSEARCH = 'opensearch'
    TENCENT = 'tencent'
