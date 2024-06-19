import os

import dotenv

DEFAULTS = {
    'DB_USERNAME': 'postgres',
    'DB_PASSWORD': '',
    'DB_HOST': 'localhost',
    'DB_PORT': '5432',
    'DB_DATABASE': 'dify',
    'DB_CHARSET': '',
    'S3_USE_AWS_MANAGED_IAM': 'False',
    'S3_ADDRESS_STYLE': 'auto',
    'SQLALCHEMY_DATABASE_URI_SCHEME': 'postgresql',
    'SQLALCHEMY_POOL_SIZE': 30,
    'SQLALCHEMY_MAX_OVERFLOW': 10,
    'SQLALCHEMY_POOL_RECYCLE': 3600,
    'SQLALCHEMY_POOL_PRE_PING': 'False',
    'SQLALCHEMY_ECHO': 'False',
    'WEAVIATE_GRPC_ENABLED': 'True',
    'WEAVIATE_BATCH_SIZE': 100,
    'QDRANT_CLIENT_TIMEOUT': 20,
    'QDRANT_GRPC_ENABLED': 'False',
    'QDRANT_GRPC_PORT': '6334',
    'CELERY_BACKEND': 'database',
    'HOSTED_OPENAI_QUOTA_LIMIT': 200,
    'HOSTED_OPENAI_TRIAL_ENABLED': 'False',
    'HOSTED_OPENAI_TRIAL_MODELS': 'gpt-3.5-turbo,gpt-3.5-turbo-1106,gpt-3.5-turbo-instruct,gpt-3.5-turbo-16k,gpt-3.5-turbo-16k-0613,gpt-3.5-turbo-0613,gpt-3.5-turbo-0125,text-davinci-003',
    'HOSTED_OPENAI_PAID_ENABLED': 'False',
    'HOSTED_OPENAI_PAID_MODELS': 'gpt-4,gpt-4-turbo-preview,gpt-4-turbo-2024-04-09,gpt-4-1106-preview,gpt-4-0125-preview,gpt-3.5-turbo,gpt-3.5-turbo-16k,gpt-3.5-turbo-16k-0613,gpt-3.5-turbo-1106,gpt-3.5-turbo-0613,gpt-3.5-turbo-0125,gpt-3.5-turbo-instruct,text-davinci-003',
    'HOSTED_AZURE_OPENAI_ENABLED': 'False',
    'HOSTED_AZURE_OPENAI_QUOTA_LIMIT': 200,
    'HOSTED_ANTHROPIC_QUOTA_LIMIT': 600000,
    'HOSTED_ANTHROPIC_TRIAL_ENABLED': 'False',
    'HOSTED_ANTHROPIC_PAID_ENABLED': 'False',
    'HOSTED_MODERATION_ENABLED': 'False',
    'HOSTED_MODERATION_PROVIDERS': '',
    'HOSTED_FETCH_APP_TEMPLATES_MODE': 'remote',
    'HOSTED_FETCH_APP_TEMPLATES_REMOTE_DOMAIN': 'https://tmpl.dify.ai',
    'MILVUS_DATABASE': 'default',
}


def get_env(key):
    return os.environ.get(key, DEFAULTS.get(key))


def get_bool_env(key):
    value = get_env(key)
    return value.lower() == 'true' if value is not None else False


def get_cors_allow_origins(env, default):
    cors_allow_origins = []
    if get_env(env):
        for origin in get_env(env).split(','):
            cors_allow_origins.append(origin)
    else:
        cors_allow_origins = [default]

    return cors_allow_origins


class Config:
    """Application configuration class."""

    def __init__(self):
        dotenv.load_dotenv()

        self.TESTING = False

        # cors settings
        self.CONSOLE_CORS_ALLOW_ORIGINS = get_cors_allow_origins(
            'CONSOLE_CORS_ALLOW_ORIGINS', get_env('CONSOLE_WEB_URL'))
        self.WEB_API_CORS_ALLOW_ORIGINS = get_cors_allow_origins(
            'WEB_API_CORS_ALLOW_ORIGINS', '*')

        # ------------------------
        # Database Configurations.
        # ------------------------
        db_credentials = {
            key: get_env(key) for key in
            ['DB_USERNAME', 'DB_PASSWORD', 'DB_HOST', 'DB_PORT', 'DB_DATABASE', 'DB_CHARSET']
        }
        self.SQLALCHEMY_DATABASE_URI_SCHEME = get_env('SQLALCHEMY_DATABASE_URI_SCHEME')

        db_extras = f"?client_encoding={db_credentials['DB_CHARSET']}" if db_credentials['DB_CHARSET'] else ""

        self.SQLALCHEMY_DATABASE_URI = f"{self.SQLALCHEMY_DATABASE_URI_SCHEME}://{db_credentials['DB_USERNAME']}:{db_credentials['DB_PASSWORD']}@{db_credentials['DB_HOST']}:{db_credentials['DB_PORT']}/{db_credentials['DB_DATABASE']}{db_extras}"
        self.SQLALCHEMY_ENGINE_OPTIONS = {
            'pool_size': int(get_env('SQLALCHEMY_POOL_SIZE')),
            'max_overflow': int(get_env('SQLALCHEMY_MAX_OVERFLOW')),
            'pool_recycle': int(get_env('SQLALCHEMY_POOL_RECYCLE')),
            'pool_pre_ping': get_bool_env('SQLALCHEMY_POOL_PRE_PING'),
            'connect_args': {'options': '-c timezone=UTC'},
        }

        self.SQLALCHEMY_ECHO = get_bool_env('SQLALCHEMY_ECHO')

        # ------------------------
        # Celery worker Configurations.
        # ------------------------
        self.CELERY_BROKER_URL = get_env('CELERY_BROKER_URL')
        self.CELERY_BACKEND = get_env('CELERY_BACKEND')
        self.CELERY_RESULT_BACKEND = 'db+{}'.format(self.SQLALCHEMY_DATABASE_URI) \
            if self.CELERY_BACKEND == 'database' else self.CELERY_BROKER_URL
        self.BROKER_USE_SSL = self.CELERY_BROKER_URL.startswith('rediss://') if self.CELERY_BROKER_URL else False


        # S3 Storage settings
        self.S3_USE_AWS_MANAGED_IAM = get_bool_env('S3_USE_AWS_MANAGED_IAM')
        self.S3_ENDPOINT = get_env('S3_ENDPOINT')
        self.S3_BUCKET_NAME = get_env('S3_BUCKET_NAME')
        self.S3_ACCESS_KEY = get_env('S3_ACCESS_KEY')
        self.S3_SECRET_KEY = get_env('S3_SECRET_KEY')
        self.S3_REGION = get_env('S3_REGION')
        self.S3_ADDRESS_STYLE = get_env('S3_ADDRESS_STYLE')

        # Azure Blob Storage settings
        self.AZURE_BLOB_ACCOUNT_NAME = get_env('AZURE_BLOB_ACCOUNT_NAME')
        self.AZURE_BLOB_ACCOUNT_KEY = get_env('AZURE_BLOB_ACCOUNT_KEY')
        self.AZURE_BLOB_CONTAINER_NAME = get_env('AZURE_BLOB_CONTAINER_NAME')
        self.AZURE_BLOB_ACCOUNT_URL = get_env('AZURE_BLOB_ACCOUNT_URL')

        # Aliyun Storage settings
        self.ALIYUN_OSS_BUCKET_NAME = get_env('ALIYUN_OSS_BUCKET_NAME')
        self.ALIYUN_OSS_ACCESS_KEY = get_env('ALIYUN_OSS_ACCESS_KEY')
        self.ALIYUN_OSS_SECRET_KEY = get_env('ALIYUN_OSS_SECRET_KEY')
        self.ALIYUN_OSS_ENDPOINT = get_env('ALIYUN_OSS_ENDPOINT')
        self.ALIYUN_OSS_REGION = get_env('ALIYUN_OSS_REGION')
        self.ALIYUN_OSS_AUTH_VERSION = get_env('ALIYUN_OSS_AUTH_VERSION')

        # Google Cloud Storage settings
        self.GOOGLE_STORAGE_BUCKET_NAME = get_env('GOOGLE_STORAGE_BUCKET_NAME')
        self.GOOGLE_STORAGE_SERVICE_ACCOUNT_JSON_BASE64 = get_env('GOOGLE_STORAGE_SERVICE_ACCOUNT_JSON_BASE64')

        # Tencent Cos Storage settings
        self.TENCENT_COS_BUCKET_NAME = get_env('TENCENT_COS_BUCKET_NAME')
        self.TENCENT_COS_REGION = get_env('TENCENT_COS_REGION')
        self.TENCENT_COS_SECRET_ID = get_env('TENCENT_COS_SECRET_ID')
        self.TENCENT_COS_SECRET_KEY = get_env('TENCENT_COS_SECRET_KEY')
        self.TENCENT_COS_SCHEME = get_env('TENCENT_COS_SCHEME')

        # ------------------------
        # Vector Store Configurations.
        # Currently, only support: qdrant, milvus, zilliz, weaviate, relyt, pgvector
        # ------------------------

        # qdrant settings
        self.QDRANT_URL = get_env('QDRANT_URL')
        self.QDRANT_API_KEY = get_env('QDRANT_API_KEY')
        self.QDRANT_CLIENT_TIMEOUT = get_env('QDRANT_CLIENT_TIMEOUT')
        self.QDRANT_GRPC_ENABLED = get_env('QDRANT_GRPC_ENABLED')
        self.QDRANT_GRPC_PORT = get_env('QDRANT_GRPC_PORT')

        # milvus / zilliz setting
        self.MILVUS_HOST = get_env('MILVUS_HOST')
        self.MILVUS_PORT = get_env('MILVUS_PORT')
        self.MILVUS_USER = get_env('MILVUS_USER')
        self.MILVUS_PASSWORD = get_env('MILVUS_PASSWORD')
        self.MILVUS_SECURE = get_env('MILVUS_SECURE')
        self.MILVUS_DATABASE = get_env('MILVUS_DATABASE')

        # OpenSearch settings
        self.OPENSEARCH_HOST = get_env('OPENSEARCH_HOST')
        self.OPENSEARCH_PORT = get_env('OPENSEARCH_PORT')
        self.OPENSEARCH_USER = get_env('OPENSEARCH_USER')
        self.OPENSEARCH_PASSWORD = get_env('OPENSEARCH_PASSWORD')
        self.OPENSEARCH_SECURE = get_bool_env('OPENSEARCH_SECURE')

        # weaviate settings
        self.WEAVIATE_ENDPOINT = get_env('WEAVIATE_ENDPOINT')
        self.WEAVIATE_API_KEY = get_env('WEAVIATE_API_KEY')
        self.WEAVIATE_GRPC_ENABLED = get_bool_env('WEAVIATE_GRPC_ENABLED')
        self.WEAVIATE_BATCH_SIZE = int(get_env('WEAVIATE_BATCH_SIZE'))

        # relyt settings
        self.RELYT_HOST = get_env('RELYT_HOST')
        self.RELYT_PORT = get_env('RELYT_PORT')
        self.RELYT_USER = get_env('RELYT_USER')
        self.RELYT_PASSWORD = get_env('RELYT_PASSWORD')
        self.RELYT_DATABASE = get_env('RELYT_DATABASE')

        # tencent settings
        self.TENCENT_VECTOR_DB_URL = get_env('TENCENT_VECTOR_DB_URL')
        self.TENCENT_VECTOR_DB_API_KEY = get_env('TENCENT_VECTOR_DB_API_KEY')
        self.TENCENT_VECTOR_DB_TIMEOUT = get_env('TENCENT_VECTOR_DB_TIMEOUT')
        self.TENCENT_VECTOR_DB_USERNAME = get_env('TENCENT_VECTOR_DB_USERNAME')
        self.TENCENT_VECTOR_DB_DATABASE = get_env('TENCENT_VECTOR_DB_DATABASE')
        self.TENCENT_VECTOR_DB_SHARD = get_env('TENCENT_VECTOR_DB_SHARD')
        self.TENCENT_VECTOR_DB_REPLICAS = get_env('TENCENT_VECTOR_DB_REPLICAS')

        # pgvecto rs settings
        self.PGVECTO_RS_HOST = get_env('PGVECTO_RS_HOST')
        self.PGVECTO_RS_PORT = get_env('PGVECTO_RS_PORT')
        self.PGVECTO_RS_USER = get_env('PGVECTO_RS_USER')
        self.PGVECTO_RS_PASSWORD = get_env('PGVECTO_RS_PASSWORD')
        self.PGVECTO_RS_DATABASE = get_env('PGVECTO_RS_DATABASE')

        # pgvector settings
        self.PGVECTOR_HOST = get_env('PGVECTOR_HOST')
        self.PGVECTOR_PORT = get_env('PGVECTOR_PORT')
        self.PGVECTOR_USER = get_env('PGVECTOR_USER')
        self.PGVECTOR_PASSWORD = get_env('PGVECTOR_PASSWORD')
        self.PGVECTOR_DATABASE = get_env('PGVECTOR_DATABASE')

        # tidb-vector settings
        self.TIDB_VECTOR_HOST = get_env('TIDB_VECTOR_HOST')
        self.TIDB_VECTOR_PORT = get_env('TIDB_VECTOR_PORT')
        self.TIDB_VECTOR_USER = get_env('TIDB_VECTOR_USER')
        self.TIDB_VECTOR_PASSWORD = get_env('TIDB_VECTOR_PASSWORD')
        self.TIDB_VECTOR_DATABASE = get_env('TIDB_VECTOR_DATABASE')

        # chroma settings
        self.CHROMA_HOST = get_env('CHROMA_HOST')
        self.CHROMA_PORT = get_env('CHROMA_PORT')
        self.CHROMA_TENANT = get_env('CHROMA_TENANT')
        self.CHROMA_DATABASE = get_env('CHROMA_DATABASE')
        self.CHROMA_AUTH_PROVIDER = get_env('CHROMA_AUTH_PROVIDER')
        self.CHROMA_AUTH_CREDENTIALS = get_env('CHROMA_AUTH_CREDENTIALS')

        # ------------------------
        # Platform Configurations.
        # ------------------------
        self.HOSTED_OPENAI_API_KEY = get_env('HOSTED_OPENAI_API_KEY')
        self.HOSTED_OPENAI_API_BASE = get_env('HOSTED_OPENAI_API_BASE')
        self.HOSTED_OPENAI_API_ORGANIZATION = get_env('HOSTED_OPENAI_API_ORGANIZATION')
        self.HOSTED_OPENAI_TRIAL_ENABLED = get_bool_env('HOSTED_OPENAI_TRIAL_ENABLED')
        self.HOSTED_OPENAI_TRIAL_MODELS = get_env('HOSTED_OPENAI_TRIAL_MODELS')
        self.HOSTED_OPENAI_QUOTA_LIMIT = int(get_env('HOSTED_OPENAI_QUOTA_LIMIT'))
        self.HOSTED_OPENAI_PAID_ENABLED = get_bool_env('HOSTED_OPENAI_PAID_ENABLED')
        self.HOSTED_OPENAI_PAID_MODELS = get_env('HOSTED_OPENAI_PAID_MODELS')

        self.HOSTED_AZURE_OPENAI_ENABLED = get_bool_env('HOSTED_AZURE_OPENAI_ENABLED')
        self.HOSTED_AZURE_OPENAI_API_KEY = get_env('HOSTED_AZURE_OPENAI_API_KEY')
        self.HOSTED_AZURE_OPENAI_API_BASE = get_env('HOSTED_AZURE_OPENAI_API_BASE')
        self.HOSTED_AZURE_OPENAI_QUOTA_LIMIT = int(get_env('HOSTED_AZURE_OPENAI_QUOTA_LIMIT'))

        self.HOSTED_ANTHROPIC_API_BASE = get_env('HOSTED_ANTHROPIC_API_BASE')
        self.HOSTED_ANTHROPIC_API_KEY = get_env('HOSTED_ANTHROPIC_API_KEY')
        self.HOSTED_ANTHROPIC_TRIAL_ENABLED = get_bool_env('HOSTED_ANTHROPIC_TRIAL_ENABLED')
        self.HOSTED_ANTHROPIC_QUOTA_LIMIT = int(get_env('HOSTED_ANTHROPIC_QUOTA_LIMIT'))
        self.HOSTED_ANTHROPIC_PAID_ENABLED = get_bool_env('HOSTED_ANTHROPIC_PAID_ENABLED')

        self.HOSTED_MINIMAX_ENABLED = get_bool_env('HOSTED_MINIMAX_ENABLED')
        self.HOSTED_SPARK_ENABLED = get_bool_env('HOSTED_SPARK_ENABLED')
        self.HOSTED_ZHIPUAI_ENABLED = get_bool_env('HOSTED_ZHIPUAI_ENABLED')

        self.HOSTED_MODERATION_ENABLED = get_bool_env('HOSTED_MODERATION_ENABLED')
        self.HOSTED_MODERATION_PROVIDERS = get_env('HOSTED_MODERATION_PROVIDERS')

        # fetch app templates mode, remote, builtin, db(only for dify SaaS), default: remote
        self.HOSTED_FETCH_APP_TEMPLATES_MODE = get_env('HOSTED_FETCH_APP_TEMPLATES_MODE')
        self.HOSTED_FETCH_APP_TEMPLATES_REMOTE_DOMAIN = get_env('HOSTED_FETCH_APP_TEMPLATES_REMOTE_DOMAIN')
