from typing import Any, Optional
from urllib.parse import quote_plus

from pydantic import Field, NonNegativeInt, PositiveFloat, PositiveInt, computed_field
from pydantic_settings import BaseSettings

from configs.middleware.cache.redis_config import RedisConfig
from configs.middleware.storage.aliyun_oss_storage_config import AliyunOSSStorageConfig
from configs.middleware.storage.amazon_s3_storage_config import S3StorageConfig
from configs.middleware.storage.azure_blob_storage_config import AzureBlobStorageConfig
from configs.middleware.storage.baidu_obs_storage_config import BaiduOBSStorageConfig
from configs.middleware.storage.google_cloud_storage_config import GoogleCloudStorageConfig
from configs.middleware.storage.huawei_obs_storage_config import HuaweiCloudOBSStorageConfig
from configs.middleware.storage.oci_storage_config import OCIStorageConfig
from configs.middleware.storage.supabase_storage_config import SupabaseStorageConfig
from configs.middleware.storage.tencent_cos_storage_config import TencentCloudCOSStorageConfig
from configs.middleware.storage.volcengine_tos_storage_config import VolcengineTOSStorageConfig
from configs.middleware.vdb.analyticdb_config import AnalyticdbConfig
from configs.middleware.vdb.chroma_config import ChromaConfig
from configs.middleware.vdb.couchbase_config import CouchbaseConfig
from configs.middleware.vdb.elasticsearch_config import ElasticsearchConfig
from configs.middleware.vdb.milvus_config import MilvusConfig
from configs.middleware.vdb.myscale_config import MyScaleConfig
from configs.middleware.vdb.oceanbase_config import OceanBaseVectorConfig
from configs.middleware.vdb.opensearch_config import OpenSearchConfig
from configs.middleware.vdb.oracle_config import OracleConfig
from configs.middleware.vdb.pgvector_config import PGVectorConfig
from configs.middleware.vdb.pgvectors_config import PGVectoRSConfig
from configs.middleware.vdb.qdrant_config import QdrantConfig
from configs.middleware.vdb.relyt_config import RelytConfig
from configs.middleware.vdb.tencent_vector_config import TencentVectorDBConfig
from configs.middleware.vdb.tidb_on_qdrant_config import TidbOnQdrantConfig
from configs.middleware.vdb.tidb_vector_config import TiDBVectorConfig
from configs.middleware.vdb.upstash_config import UpstashConfig
from configs.middleware.vdb.vikingdb_config import VikingDBConfig
from configs.middleware.vdb.weaviate_config import WeaviateConfig


class StorageConfig(BaseSettings):
    STORAGE_TYPE: str = Field(
        description="Type of storage to use."
        " Options: 'local', 's3', 'aliyun-oss', 'azure-blob', 'baidu-obs', 'google-storage', 'huawei-obs', "
        "'oci-storage', 'tencent-cos', 'volcengine-tos', 'supabase'. Default is 'local'.",
        default="local",
    )

    STORAGE_LOCAL_PATH: str = Field(
        description="Path for local storage when STORAGE_TYPE is set to 'local'.",
        default="storage",
    )


class VectorStoreConfig(BaseSettings):
    VECTOR_STORE: Optional[str] = Field(
        description="Type of vector store to use for efficient similarity search."
        " Set to None if not using a vector store.",
        default=None,
    )

    VECTOR_STORE_WHITELIST_ENABLE: Optional[bool] = Field(
        description="Enable whitelist for vector store.",
        default=False,
    )


class KeywordStoreConfig(BaseSettings):
    KEYWORD_STORE: str = Field(
        description="Method for keyword extraction and storage."
        " Default is 'jieba', a Chinese text segmentation library.",
        default="jieba",
    )


class DatabaseConfig:
    DB_HOST: str = Field(
        description="Hostname or IP address of the database server.",
        default="localhost",
    )

    DB_PORT: PositiveInt = Field(
        description="Port number for database connection.",
        default=5432,
    )

    DB_USERNAME: str = Field(
        description="Username for database authentication.",
        default="postgres",
    )

    DB_PASSWORD: str = Field(
        description="Password for database authentication.",
        default="",
    )

    DB_DATABASE: str = Field(
        description="Name of the database to connect to.",
        default="dify",
    )

    DB_CHARSET: str = Field(
        description="Character set for database connection.",
        default="",
    )

    DB_EXTRAS: str = Field(
        description="Additional database connection parameters. Example: 'keepalives_idle=60&keepalives=1'",
        default="",
    )

    SQLALCHEMY_DATABASE_URI_SCHEME: str = Field(
        description="Database URI scheme for SQLAlchemy connection.",
        default="postgresql",
    )

    @computed_field
    @property
    def SQLALCHEMY_DATABASE_URI(self) -> str:
        db_extras = (
            f"{self.DB_EXTRAS}&client_encoding={self.DB_CHARSET}" if self.DB_CHARSET else self.DB_EXTRAS
        ).strip("&")
        db_extras = f"?{db_extras}" if db_extras else ""
        return (
            f"{self.SQLALCHEMY_DATABASE_URI_SCHEME}://"
            f"{quote_plus(self.DB_USERNAME)}:{quote_plus(self.DB_PASSWORD)}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_DATABASE}"
            f"{db_extras}"
        )

    SQLALCHEMY_POOL_SIZE: NonNegativeInt = Field(
        description="Maximum number of database connections in the pool.",
        default=30,
    )

    SQLALCHEMY_MAX_OVERFLOW: NonNegativeInt = Field(
        description="Maximum number of connections that can be created beyond the pool_size.",
        default=10,
    )

    SQLALCHEMY_POOL_RECYCLE: NonNegativeInt = Field(
        description="Number of seconds after which a connection is automatically recycled.",
        default=3600,
    )

    SQLALCHEMY_POOL_PRE_PING: bool = Field(
        description="If True, enables connection pool pre-ping feature to check connections.",
        default=False,
    )

    SQLALCHEMY_ECHO: bool | str = Field(
        description="If True, SQLAlchemy will log all SQL statements.",
        default=False,
    )

    @computed_field
    @property
    def SQLALCHEMY_ENGINE_OPTIONS(self) -> dict[str, Any]:
        return {
            "pool_size": self.SQLALCHEMY_POOL_SIZE,
            "max_overflow": self.SQLALCHEMY_MAX_OVERFLOW,
            "pool_recycle": self.SQLALCHEMY_POOL_RECYCLE,
            "pool_pre_ping": self.SQLALCHEMY_POOL_PRE_PING,
            "connect_args": {"options": "-c timezone=UTC"},
        }


class CeleryConfig(DatabaseConfig):
    CELERY_BACKEND: str = Field(
        description="Backend for Celery task results. Options: 'database', 'redis'.",
        default="database",
    )

    CELERY_BROKER_URL: Optional[str] = Field(
        description="URL of the message broker for Celery tasks.",
        default=None,
    )

    CELERY_USE_SENTINEL: Optional[bool] = Field(
        description="Whether to use Redis Sentinel for high availability.",
        default=False,
    )

    CELERY_SENTINEL_MASTER_NAME: Optional[str] = Field(
        description="Name of the Redis Sentinel master.",
        default=None,
    )

    CELERY_SENTINEL_SOCKET_TIMEOUT: Optional[PositiveFloat] = Field(
        description="Timeout for Redis Sentinel socket operations in seconds.",
        default=0.1,
    )

    @computed_field
    @property
    def CELERY_RESULT_BACKEND(self) -> str | None:
        return (
            "db+{}".format(self.SQLALCHEMY_DATABASE_URI)
            if self.CELERY_BACKEND == "database"
            else self.CELERY_BROKER_URL
        )

    @computed_field
    @property
    def BROKER_USE_SSL(self) -> bool:
        return self.CELERY_BROKER_URL.startswith("rediss://") if self.CELERY_BROKER_URL else False


class InternalTestConfig(BaseSettings):
    """
    Configuration settings for Internal Test
    """

    AWS_SECRET_ACCESS_KEY: Optional[str] = Field(
        description="Internal test AWS secret access key",
        default=None,
    )

    AWS_ACCESS_KEY_ID: Optional[str] = Field(
        description="Internal test AWS access key ID",
        default=None,
    )


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
    BaiduOBSStorageConfig,
    GoogleCloudStorageConfig,
    HuaweiCloudOBSStorageConfig,
    OCIStorageConfig,
    S3StorageConfig,
    SupabaseStorageConfig,
    TencentCloudCOSStorageConfig,
    VolcengineTOSStorageConfig,
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
    ElasticsearchConfig,
    CouchbaseConfig,
    InternalTestConfig,
    VikingDBConfig,
    UpstashConfig,
    TidbOnQdrantConfig,
    OceanBaseVectorConfig,
):
    pass
