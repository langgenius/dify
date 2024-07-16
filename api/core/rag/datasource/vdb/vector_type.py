from enum import Enum


class VectorType(str, Enum):
    ANALYTICDB = 'analyticdb'
    CHROMA = 'chroma'
    MILVUS = 'milvus'
    MYSCALE = 'myscale'
    PGVECTOR = 'pgvector'
    PGVECTO_RS = 'pgvecto-rs'
    QDRANT = 'qdrant'
    RELYT = 'relyt'
    TIDB_VECTOR = 'tidb_vector'
    WEAVIATE = 'weaviate'
    OPENSEARCH = 'opensearch'
    TENCENT = 'tencent'
    ORACLE = 'oracle'
