import os
from typing import Any, Literal
from urllib.parse import parse_qsl, quote_plus

from pydantic import Field, NonNegativeFloat, NonNegativeInt, PositiveFloat, PositiveInt, computed_field
from pydantic_settings import BaseSettings

from .cache.redis_config import RedisConfig
from .storage.aliyun_oss_storage_config import AliyunOSSStorageConfig
from .storage.amazon_s3_storage_config import S3StorageConfig
from .storage.azure_blob_storage_config import AzureBlobStorageConfig
from .storage.baidu_obs_storage_config import BaiduOBSStorageConfig
from .storage.clickzetta_volume_storage_config import ClickZettaVolumeStorageConfig
from .storage.google_cloud_storage_config import GoogleCloudStorageConfig
from .storage.huawei_obs_storage_config import HuaweiCloudOBSStorageConfig
from .storage.oci_storage_config import OCIStorageConfig
from .storage.opendal_storage_config import OpenDALStorageConfig
from .storage.supabase_storage_config import SupabaseStorageConfig
from .storage.tencent_cos_storage_config import TencentCloudCOSStorageConfig
from .storage.volcengine_tos_storage_config import VolcengineTOSStorageConfig
from .vdb.alibabacloud_mysql_config import AlibabaCloudMySQLConfig
from .vdb.analyticdb_config import AnalyticdbConfig
from .vdb.baidu_vector_config import BaiduVectorDBConfig
from .vdb.chroma_config import ChromaConfig
from .vdb.clickzetta_config import ClickzettaConfig
from .vdb.couchbase_config import CouchbaseConfig
from .vdb.elasticsearch_config import ElasticsearchConfig
from .vdb.huawei_cloud_config import HuaweiCloudConfig
from .vdb.lindorm_config import LindormConfig
from .vdb.matrixone_config import MatrixoneConfig
from .vdb.milvus_config import MilvusConfig
from .vdb.myscale_config import MyScaleConfig
from .vdb.oceanbase_config import OceanBaseVectorConfig
from .vdb.opengauss_config import OpenGaussConfig
from .vdb.opensearch_config import OpenSearchConfig
from .vdb.oracle_config import OracleConfig
from .vdb.pgvector_config import PGVectorConfig
from .vdb.pgvectors_config import PGVectoRSConfig
from .vdb.qdrant_config import QdrantConfig
from .vdb.relyt_config import RelytConfig
from .vdb.tablestore_config import TableStoreConfig
from .vdb.tencent_vector_config import TencentVectorDBConfig
from .vdb.tidb_on_qdrant_config import TidbOnQdrantConfig
from .vdb.tidb_vector_config import TiDBVectorConfig
from .vdb.upstash_config import UpstashConfig
from .vdb.vastbase_vector_config import VastbaseVectorConfig
from .vdb.vikingdb_config import VikingDBConfig
from .vdb.weaviate_config import WeaviateConfig


class StorageConfig(BaseSettings):
    STORAGE_TYPE: Literal[
        "opendal",
        "s3",
        "aliyun-oss",
        "azure-blob",
        "baidu-obs",
        "clickzetta-volume",
        "google-storage",
        "huawei-obs",
        "oci-storage",
        "tencent-cos",
        "volcengine-tos",
        "supabase",
        "local",
    ] = Field(
        description="Type of storage to use."
        " Options: 'opendal', '(deprecated) local', 's3', 'aliyun-oss', 'azure-blob', 'baidu-obs', "
        "'clickzetta-volume', 'google-storage', 'huawei-obs', 'oci-storage', 'tencent-cos', "
        "'volcengine-tos', 'supabase'. Default is 'opendal'.",
        default="opendal",
    )

    STORAGE_LOCAL_PATH: str = Field(
        description="Path for local storage when STORAGE_TYPE is set to 'local'.",
        default="storage",
        deprecated=True,
    )


class VectorStoreConfig(BaseSettings):
    VECTOR_STORE: str | None = Field(
        description="Type of vector store to use for efficient similarity search."
        " Set to None if not using a vector store.",
        default=None,
    )

    VECTOR_STORE_WHITELIST_ENABLE: bool | None = Field(
        description="Enable whitelist for vector store.",
        default=False,
    )

    VECTOR_INDEX_NAME_PREFIX: str | None = Field(
        description="Prefix used to create collection name in vector database",
        default="Vector_index",
    )


class KeywordStoreConfig(BaseSettings):
    KEYWORD_STORE: str = Field(
        description="Method for keyword extraction and storage."
        " Default is 'jieba', a Chinese text segmentation library.",
        default="jieba",
    )


class DatabaseConfig(BaseSettings):
    # Database type selector
    DB_TYPE: Literal["postgresql", "mysql", "oceanbase"] = Field(
        description="Database type to use. OceanBase is MySQL-compatible.",
        default="postgresql",
    )

    # PostgreSQL configuration
    POSTGRES_HOST: str = Field(
        description="PostgreSQL hostname or IP address.",
        default="localhost",
    )

    POSTGRES_PORT: PositiveInt = Field(
        description="PostgreSQL port number.",
        default=5432,
    )

    POSTGRES_USER: str = Field(
        description="PostgreSQL username.",
        default="postgres",
    )

    POSTGRES_PASSWORD: str = Field(
        description="PostgreSQL password.",
        default="difyai123456",
    )

    POSTGRES_DATABASE: str = Field(
        description="PostgreSQL database name.",
        default="dify",
    )

    # MySQL configuration
    MYSQL_HOST: str = Field(
        description="MySQL hostname or IP address.",
        default="localhost",
    )

    MYSQL_PORT: PositiveInt = Field(
        description="MySQL port number.",
        default=3306,
    )

    MYSQL_USER: str = Field(
        description="MySQL username.",
        default="root",
    )

    MYSQL_PASSWORD: str = Field(
        description="MySQL password.",
        default="difyai123456",
    )

    MYSQL_DATABASE: str = Field(
        description="MySQL database name.",
        default="dify",
    )

    # OceanBase configuration(MySQL-compatible)
    OCEANBASE_HOST: str = Field(
        description="OceanBase hostname or IP address.",
        default="localhost",
    )

    OCEANBASE_PORT: PositiveInt = Field(
        description="OceanBase port number.",
        default=2881,
    )

    OCEANBASE_USER: str = Field(
        description="OceanBase username.",
        default="root@test",
    )

    OCEANBASE_PASSWORD: str = Field(
        description="OceanBase password.",
        default="difyai123456",
    )

    OCEANBASE_DATABASE: str = Field(
        description="OceanBase database name.",
        default="test",
    )

    # Dynamic properties based on DB_TYPE
    @computed_field  # type: ignore[prop-decorator]
    @property
    def DB_HOST(self) -> str:
        if self.DB_TYPE == "postgresql":
            return self.POSTGRES_HOST
        elif self.DB_TYPE == "mysql":
            return self.MYSQL_HOST
        elif self.DB_TYPE == "oceanbase":
            return self.OCEANBASE_HOST
        else:
            raise ValueError(f"Unsupported DB_TYPE: {self.DB_TYPE}")

    @computed_field  # type: ignore[prop-decorator]
    @property
    def DB_PORT(self) -> int:
        if self.DB_TYPE == "postgresql":
            return self.POSTGRES_PORT
        elif self.DB_TYPE == "mysql":
            return self.MYSQL_PORT
        elif self.DB_TYPE == "oceanbase":
            return self.OCEANBASE_PORT
        else:
            raise ValueError(f"Unsupported DB_TYPE: {self.DB_TYPE}")

    @computed_field  # type: ignore[prop-decorator]
    @property
    def DB_USERNAME(self) -> str:
        if self.DB_TYPE == "postgresql":
            return self.POSTGRES_USER
        elif self.DB_TYPE == "mysql":
            return self.MYSQL_USER
        elif self.DB_TYPE == "oceanbase":
            return self.OCEANBASE_USER
        else:
            raise ValueError(f"Unsupported DB_TYPE: {self.DB_TYPE}")

    @computed_field  # type: ignore[prop-decorator]
    @property
    def DB_PASSWORD(self) -> str:
        if self.DB_TYPE == "postgresql":
            return self.POSTGRES_PASSWORD
        elif self.DB_TYPE == "mysql":
            return self.MYSQL_PASSWORD
        elif self.DB_TYPE == "oceanbase":
            return self.OCEANBASE_PASSWORD
        else:
            raise ValueError(f"Unsupported DB_TYPE: {self.DB_TYPE}")

    @computed_field  # type: ignore[prop-decorator]
    @property
    def DB_DATABASE(self) -> str:
        if self.DB_TYPE == "postgresql":
            return self.POSTGRES_DATABASE
        elif self.DB_TYPE == "mysql":
            return self.MYSQL_DATABASE
        elif self.DB_TYPE == "oceanbase":
            return self.OCEANBASE_DATABASE
        else:
            raise ValueError(f"Unsupported DB_TYPE: {self.DB_TYPE}")

    DB_CHARSET: str = Field(
        description="Character set for database connection.",
        default="",
    )

    DB_EXTRAS: str = Field(
        description="Additional database connection parameters. Example: 'keepalives_idle=60&keepalives=1'",
        default="",
    )

    @computed_field  # type: ignore[prop-decorator]
    @property
    def SQLALCHEMY_DATABASE_URI_SCHEME(self) -> str:
        return "postgresql" if self.DB_TYPE == "postgresql" else "mysql+pymysql"

    @computed_field  # type: ignore[prop-decorator]
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

    SQLALCHEMY_POOL_USE_LIFO: bool = Field(
        description="If True, SQLAlchemy will use last-in-first-out way to retrieve connections from pool.",
        default=False,
    )

    SQLALCHEMY_POOL_PRE_PING: bool = Field(
        description="If True, enables connection pool pre-ping feature to check connections.",
        default=False,
    )

    SQLALCHEMY_ECHO: bool | str = Field(
        description="If True, SQLAlchemy will log all SQL statements.",
        default=False,
    )

    SQLALCHEMY_POOL_TIMEOUT: NonNegativeInt = Field(
        description="Number of seconds to wait for a connection from the pool before raising a timeout error.",
        default=30,
    )

    RETRIEVAL_SERVICE_EXECUTORS: NonNegativeInt = Field(
        description="Number of processes for the retrieval service, default to CPU cores.",
        default=os.cpu_count() or 1,
    )

    @computed_field  # type: ignore[prop-decorator]
    @property
    def SQLALCHEMY_ENGINE_OPTIONS(self) -> dict[str, Any]:
        # Parse DB_EXTRAS for 'options'
        db_extras_dict = dict(parse_qsl(self.DB_EXTRAS))
        options = db_extras_dict.get("options", "")
        connect_args = {}
        # Use the dynamic SQLALCHEMY_DATABASE_URI_SCHEME property
        if self.SQLALCHEMY_DATABASE_URI_SCHEME.startswith("postgresql"):
            timezone_opt = "-c timezone=UTC"
            if options:
                merged_options = f"{options} {timezone_opt}"
            else:
                merged_options = timezone_opt
            connect_args = {"options": merged_options}

        return {
            "pool_size": self.SQLALCHEMY_POOL_SIZE,
            "max_overflow": self.SQLALCHEMY_MAX_OVERFLOW,
            "pool_recycle": self.SQLALCHEMY_POOL_RECYCLE,
            "pool_pre_ping": self.SQLALCHEMY_POOL_PRE_PING,
            "connect_args": connect_args,
            "pool_use_lifo": self.SQLALCHEMY_POOL_USE_LIFO,
            "pool_reset_on_return": None,
            "pool_timeout": self.SQLALCHEMY_POOL_TIMEOUT,
        }


class CeleryConfig(DatabaseConfig):
    CELERY_BACKEND: str = Field(
        description="Backend for Celery task results. Options: 'database', 'redis', 'rabbitmq'.",
        default="redis",
    )

    CELERY_BROKER_URL: str | None = Field(
        description="URL of the message broker for Celery tasks.",
        default=None,
    )

    CELERY_USE_SENTINEL: bool | None = Field(
        description="Whether to use Redis Sentinel for high availability.",
        default=False,
    )

    CELERY_SENTINEL_MASTER_NAME: str | None = Field(
        description="Name of the Redis Sentinel master.",
        default=None,
    )

    CELERY_SENTINEL_PASSWORD: str | None = Field(
        description="Password of the Redis Sentinel master.",
        default=None,
    )
    CELERY_SENTINEL_SOCKET_TIMEOUT: PositiveFloat | None = Field(
        description="Timeout for Redis Sentinel socket operations in seconds.",
        default=0.1,
    )

    @computed_field
    def CELERY_RESULT_BACKEND(self) -> str | None:
        if self.CELERY_BACKEND in ("database", "rabbitmq"):
            return f"db+{self.SQLALCHEMY_DATABASE_URI}"
        elif self.CELERY_BACKEND == "redis":
            return self.CELERY_BROKER_URL
        else:
            return None

    @property
    def BROKER_USE_SSL(self) -> bool:
        return self.CELERY_BROKER_URL.startswith("rediss://") if self.CELERY_BROKER_URL else False


class InternalTestConfig(BaseSettings):
    """
    Configuration settings for Internal Test
    """

    AWS_SECRET_ACCESS_KEY: str | None = Field(
        description="Internal test AWS secret access key",
        default=None,
    )

    AWS_ACCESS_KEY_ID: str | None = Field(
        description="Internal test AWS access key ID",
        default=None,
    )


class DatasetQueueMonitorConfig(BaseSettings):
    """
    Configuration settings for Dataset Queue Monitor
    """

    QUEUE_MONITOR_THRESHOLD: NonNegativeInt | None = Field(
        description="Threshold for dataset queue monitor",
        default=200,
    )
    QUEUE_MONITOR_ALERT_EMAILS: str | None = Field(
        description="Emails for dataset queue monitor alert, separated by commas",
        default=None,
    )
    QUEUE_MONITOR_INTERVAL: NonNegativeFloat | None = Field(
        description="Interval for dataset queue monitor in minutes",
        default=30,
    )


class MiddlewareConfig(
    # place the configs in alphabet order
    CeleryConfig,  # Note: CeleryConfig already inherits from DatabaseConfig
    KeywordStoreConfig,
    RedisConfig,
    # configs of storage and storage providers
    StorageConfig,
    AliyunOSSStorageConfig,
    AzureBlobStorageConfig,
    BaiduOBSStorageConfig,
    ClickZettaVolumeStorageConfig,
    GoogleCloudStorageConfig,
    HuaweiCloudOBSStorageConfig,
    OCIStorageConfig,
    OpenDALStorageConfig,
    S3StorageConfig,
    SupabaseStorageConfig,
    TencentCloudCOSStorageConfig,
    VolcengineTOSStorageConfig,
    # configs of vdb and vdb providers
    VectorStoreConfig,
    AnalyticdbConfig,
    ChromaConfig,
    ClickzettaConfig,
    HuaweiCloudConfig,
    MilvusConfig,
    AlibabaCloudMySQLConfig,
    MyScaleConfig,
    OpenSearchConfig,
    OracleConfig,
    PGVectorConfig,
    VastbaseVectorConfig,
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
    LindormConfig,
    OceanBaseVectorConfig,
    BaiduVectorDBConfig,
    OpenGaussConfig,
    TableStoreConfig,
    DatasetQueueMonitorConfig,
    MatrixoneConfig,
):
    pass
