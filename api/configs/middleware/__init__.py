from typing import Optional

from pydantic import BaseModel, Field

from configs.middleware.redis_configs import RedisConfigs
from configs.middleware.vdb.chroma_configs import ChromaConfigs
from configs.middleware.vdb.milvus_configs import MilvusConfigs
from configs.middleware.vdb.opensearch_configs import OpenSearchConfigs
from configs.middleware.vdb.pgvector_configs import PGVectorConfigs
from configs.middleware.vdb.pgvectors_configs import PGVectoRSConfigs
from configs.middleware.vdb.qdrant_configs import QdrantConfigs
from configs.middleware.vdb.relyt_configs import RelytConfigs
from configs.middleware.vdb.tencent_vector_configs import TencentVectorDBConfigs
from configs.middleware.vdb.tidb_vector_configs import TiDBVectorConfigs
from configs.middleware.vdb.weaviate_configs import WeaviateConfigs


class StorageConfigs(BaseModel):
    STORAGE_TYPE: str = Field(
        description='storage type,'
                    ' default to `local`,'
                    ' available values are `local`, `s3`, `azure-blob`, `aliyun-oss`, `google-storage`.',
        default='local',
    )

    STORAGE_LOCAL_PATH: str = Field(
        description='local storage path',
        default='storage',
    )


class VectorStoreConfigs(BaseModel):
    VECTOR_STORE: Optional[str] = Field(
        description='vector store type',
        default=None,
    )


class KeywordStoreConfigs(BaseModel):
    KEYWORD_STORE: str = Field(
        description='keyword store type',
        default='jieba',
    )


class MiddlewareConfigs(
    # place the configs in alphabet order
    KeywordStoreConfigs,
    RedisConfigs,
    StorageConfigs,

    # configs of vdb and vdb providers
    VectorStoreConfigs,
    ChromaConfigs,
    MilvusConfigs,
    OpenSearchConfigs,
    PGVectorConfigs,
    PGVectoRSConfigs,
    QdrantConfigs,
    RelytConfigs,
    TencentVectorDBConfigs,
    TiDBVectorConfigs,
    WeaviateConfigs,
):
    pass
