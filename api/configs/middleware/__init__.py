from typing import Any, Optional
from urllib.parse import quote_plus

from pydantic import Field, NonNegativeInt, PositiveInt, computed_field
from pydantic_settings import BaseSettings

from configs.middleware.cache.redis_config import RedisConfig
from configs.middleware.storage.aliyun_oss_storage_config import AliyunOSSStorageConfig
from configs.middleware.storage.amazon_s3_storage_config import S3StorageConfig
from configs.middleware.storage.azure_blob_storage_config import AzureBlobStorageConfig
from configs.middleware.storage.google_cloud_storage_config import GoogleCloudStorageConfig
from configs.middleware.storage.oci_storage_config import OCIStorageConfig
from configs.middleware.storage.tencent_cos_storage_config import TencentCloudCOSStorageConfig
from configs.middleware.vdb.analyticdb_config import AnalyticdbConfig
from configs.middleware.vdb.chroma_config import ChromaConfig
from configs.middleware.vdb.milvus_config import MilvusConfig
from configs.middleware.vdb.myscale_config import MyScaleConfig
from configs.middleware.vdb.opensearch_config import OpenSearchConfig
from configs.middleware.vdb.oracle_config import OracleConfig
from configs.middleware.vdb.pgvector_config import PGVectorConfig
from configs.middleware.vdb.pgvectors_config import PGVectoRSConfig
from configs.middleware.vdb.qdrant_config import QdrantConfig
from configs.middleware.vdb.relyt_config import RelytConfig
from configs.middleware.vdb.tencent_vector_config import TencentVectorDBConfig
from configs.middleware.vdb.tidb_vector_config import TiDBVectorConfig
from configs.middleware.vdb.weaviate_config import WeaviateConfig


class StorageConfig(BaseSettings):
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


class VectorStoreConfig(BaseSettings):
    VECTOR_STORE: Optional[str] = Field(
        description='vector store type',
        default=None,
    )


class KeywordStoreConfig(BaseSettings):
    KEYWORD_STORE: str = Field(
        description='keyword store type',
        default='jieba',
    )


class DatabaseConfig:
    DB_HOST: str = Field(
        description='db host',
        default='localhost',
    )

    DB_PORT: PositiveInt = Field(
        description='db port',
        default=5432,
    )

    DB_USERNAME: str = Field(
        description='db username',
        default='postgres',
    )

    DB_PASSWORD: str = Field(
        description='db password',
        default='',
    )

    DB_DATABASE: str = Field(
        description='db database',
        default='dify',
    )

    DB_CHARSET: str = Field(
        description='db charset',
        default='',
    )

    DB_EXTRAS: str = Field(
        description='db extras options. Example: keepalives_idle=60&keepalives=1',
        default='',
    )

    SQLALCHEMY_DATABASE_URI_SCHEME: str = Field(
        description='db uri scheme',
        default='postgresql',
    )

    @computed_field
    @property
    def SQLALCHEMY_DATABASE_URI(self) -> str:
        db_extras = (
            f"{self.DB_EXTRAS}&client_encoding={self.DB_CHARSET}"
            if self.DB_CHARSET
            else self.DB_EXTRAS
        ).strip("&")
        db_extras = f"?{db_extras}" if db_extras else ""
        return (f"{self.SQLALCHEMY_DATABASE_URI_SCHEME}://"
                f"{quote_plus(self.DB_USERNAME)}:{quote_plus(self.DB_PASSWORD)}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_DATABASE}" 
                f"{db_extras}")

    SQLALCHEMY_POOL_SIZE: NonNegativeInt = Field(
        description='pool size of SqlAlchemy',
        default=30,
    )

    SQLALCHEMY_MAX_OVERFLOW: NonNegativeInt = Field(
        description='max overflows for SqlAlchemy',
        default=10,
    )

    SQLALCHEMY_POOL_RECYCLE: NonNegativeInt = Field(
        description='SqlAlchemy pool recycle',
        default=3600,
    )

    SQLALCHEMY_POOL_PRE_PING: bool = Field(
        description='whether to enable pool pre-ping in SqlAlchemy',
        default=False,
    )

    SQLALCHEMY_ECHO: bool | str = Field(
        description='whether to enable SqlAlchemy echo',
        default=False,
    )

    @computed_field
    @property
    def SQLALCHEMY_ENGINE_OPTIONS(self) -> dict[str, Any]:
        return {
            'pool_size': self.SQLALCHEMY_POOL_SIZE,
            'max_overflow': self.SQLALCHEMY_MAX_OVERFLOW,
            'pool_recycle': self.SQLALCHEMY_POOL_RECYCLE,
            'pool_pre_ping': self.SQLALCHEMY_POOL_PRE_PING,
            'connect_args': {'options': '-c timezone=UTC'},
        }


class CeleryConfig(DatabaseConfig):
    CELERY_BACKEND: str = Field(
        description='Celery backend, available values are `database`, `redis`',
        default='database',
    )

    CELERY_BROKER_URL: Optional[str] = Field(
        description='CELERY_BROKER_URL',
        default=None,
    )

    @computed_field
    @property
    def CELERY_RESULT_BACKEND(self) -> str | None:
        return 'db+{}'.format(self.SQLALCHEMY_DATABASE_URI) \
            if self.CELERY_BACKEND == 'database' else self.CELERY_BROKER_URL

    @computed_field
    @property
    def BROKER_USE_SSL(self) -> bool:
        return self.CELERY_BROKER_URL.startswith('rediss://') if self.CELERY_BROKER_URL else False


class MiddlewareConfig(
    # place the configs in alphabet order
    CeleryConfig,
    DatabaseConfig,
    KeywordStoreConfig,
    RedisConfig,

    # configs of storage and storage providers
    StorageConfig,
    AliyunOSSStorageConfig,
    AzureBlobStorageConfig,
    GoogleCloudStorageConfig,
    TencentCloudCOSStorageConfig,
    S3StorageConfig,
    OCIStorageConfig,

    # configs of vdb and vdb providers
    VectorStoreConfig,
    AnalyticdbConfig,
    ChromaConfig,
    MilvusConfig,
    MyScaleConfig,
    OpenSearchConfig,
    OracleConfig,
    PGVectorConfig,
    PGVectoRSConfig,
    QdrantConfig,
    RelytConfig,
    TencentVectorDBConfig,
    TiDBVectorConfig,
    WeaviateConfig,
):
    pass
