from enum import Enum


class VectorType(str, Enum):
    MILVUS = 'milvus'
    PGVECTOR = 'pgvector'
    PGVECTO_RS = 'pgvecto-rs'
    QDRANT = 'qdrant'
    RELYT = 'relyt'
    TIDB_VECTOR = 'tidb_vector'
    WEAVIATE = 'weaviate'
