import os

import dotenv

DEFAULTS = {
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
        self.APPLICATION_NAME = "langgenius/dify"

        # cors settings
        self.CONSOLE_CORS_ALLOW_ORIGINS = get_cors_allow_origins(
            'CONSOLE_CORS_ALLOW_ORIGINS', get_env('CONSOLE_WEB_URL'))
        self.WEB_API_CORS_ALLOW_ORIGINS = get_cors_allow_origins(
            'WEB_API_CORS_ALLOW_ORIGINS', '*')
<<<<<<< HEAD

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

        # Feishu wiki setting
        self.FEISHU_APP_ID = get_env('FEISHU_APP_ID')
        self.FEISHU_APP_SECRET = get_env('FEISHU_APP_SECRET')

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
=======
>>>>>>> upstream/main
