# -*- coding:utf-8 -*-
import os
from datetime import timedelta

import dotenv

from extensions.ext_database import db
from extensions.ext_redis import redis_client

dotenv.load_dotenv()

DEFAULTS = {
    'DB_USERNAME': 'postgres',
    'DB_PASSWORD': '',
    'DB_HOST': 'localhost',
    'DB_PORT': '5432',
    'DB_DATABASE': 'dify',
    'REDIS_HOST': 'localhost',
    'REDIS_PORT': '6379',
    'REDIS_DB': '0',
    'REDIS_USE_SSL': 'False',
    'OAUTH_REDIRECT_PATH': '/console/api/oauth/authorize',
    'OAUTH_REDIRECT_INDEX_PATH': '/',
    'CONSOLE_WEB_URL': 'https://cloud.dify.ai',
    'CONSOLE_API_URL': 'https://cloud.dify.ai',
    'SERVICE_API_URL': 'https://api.dify.ai',
    'APP_WEB_URL': 'https://udify.app',
    'APP_API_URL': 'https://udify.app',
    'STORAGE_TYPE': 'local',
    'STORAGE_LOCAL_PATH': 'storage',
    'CHECK_UPDATE_URL': 'https://updates.dify.ai',
    'DEPLOY_ENV': 'PRODUCTION',
    'SQLALCHEMY_POOL_SIZE': 30,
    'SQLALCHEMY_POOL_RECYCLE': 3600,
    'SQLALCHEMY_ECHO': 'False',
    'SENTRY_TRACES_SAMPLE_RATE': 1.0,
    'SENTRY_PROFILES_SAMPLE_RATE': 1.0,
    'WEAVIATE_GRPC_ENABLED': 'True',
    'WEAVIATE_BATCH_SIZE': 100,
    'CELERY_BACKEND': 'database',
    'LOG_LEVEL': 'INFO',
    'HOSTED_OPENAI_QUOTA_LIMIT': 200,
    'HOSTED_OPENAI_ENABLED': 'False',
    'HOSTED_OPENAI_PAID_ENABLED': 'False',
    'HOSTED_OPENAI_PAID_INCREASE_QUOTA': 1,
    'HOSTED_AZURE_OPENAI_ENABLED': 'False',
    'HOSTED_AZURE_OPENAI_QUOTA_LIMIT': 200,
    'HOSTED_ANTHROPIC_QUOTA_LIMIT': 600000,
    'HOSTED_ANTHROPIC_ENABLED': 'False',
    'HOSTED_ANTHROPIC_PAID_ENABLED': 'False',
    'HOSTED_ANTHROPIC_PAID_INCREASE_QUOTA': 1000000,
    'HOSTED_ANTHROPIC_PAID_MIN_QUANTITY': 20,
    'HOSTED_ANTHROPIC_PAID_MAX_QUANTITY': 100,
    'HOSTED_MODERATION_ENABLED': 'False',
    'HOSTED_MODERATION_PROVIDERS': '',
    'TENANT_DOCUMENT_COUNT': 100,
    'CLEAN_DAY_SETTING': 30,
    'UPLOAD_FILE_SIZE_LIMIT': 15,
    'UPLOAD_FILE_BATCH_LIMIT': 5,
}


def get_env(key):
    return os.environ.get(key, DEFAULTS.get(key))


def get_bool_env(key):
    return get_env(key).lower() == 'true'


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
        # app settings
        self.CONSOLE_API_URL = get_env('CONSOLE_URL') if get_env('CONSOLE_URL') else get_env('CONSOLE_API_URL')
        self.CONSOLE_WEB_URL = get_env('CONSOLE_URL') if get_env('CONSOLE_URL') else get_env('CONSOLE_WEB_URL')
        self.SERVICE_API_URL = get_env('API_URL') if get_env('API_URL') else get_env('SERVICE_API_URL')
        self.APP_WEB_URL = get_env('APP_URL') if get_env('APP_URL') else get_env('APP_WEB_URL')
        self.APP_API_URL = get_env('APP_URL') if get_env('APP_URL') else get_env('APP_API_URL')
        self.CONSOLE_URL = get_env('CONSOLE_URL')
        self.API_URL = get_env('API_URL')
        self.APP_URL = get_env('APP_URL')
        self.CURRENT_VERSION = "0.3.26"
        self.COMMIT_SHA = get_env('COMMIT_SHA')
        self.EDITION = "SELF_HOSTED"
        self.DEPLOY_ENV = get_env('DEPLOY_ENV')
        self.TESTING = False
        self.LOG_LEVEL = get_env('LOG_LEVEL')

        # Your App secret key will be used for securely signing the session cookie
        # Make sure you are changing this key for your deployment with a strong key.
        # You can generate a strong key using `openssl rand -base64 42`.
        # Alternatively you can set it with `SECRET_KEY` environment variable.
        self.SECRET_KEY = get_env('SECRET_KEY')

        # redis settings
        self.REDIS_HOST = get_env('REDIS_HOST')
        self.REDIS_PORT = get_env('REDIS_PORT')
        self.REDIS_USERNAME = get_env('REDIS_USERNAME')
        self.REDIS_PASSWORD = get_env('REDIS_PASSWORD')
        self.REDIS_DB = get_env('REDIS_DB')
        self.REDIS_USE_SSL = get_bool_env('REDIS_USE_SSL')

        # storage settings
        self.STORAGE_TYPE = get_env('STORAGE_TYPE')
        self.STORAGE_LOCAL_PATH = get_env('STORAGE_LOCAL_PATH')
        self.S3_ENDPOINT = get_env('S3_ENDPOINT')
        self.S3_BUCKET_NAME = get_env('S3_BUCKET_NAME')
        self.S3_ACCESS_KEY = get_env('S3_ACCESS_KEY')
        self.S3_SECRET_KEY = get_env('S3_SECRET_KEY')
        self.S3_REGION = get_env('S3_REGION')

        # vector store settings, only support weaviate, qdrant
        self.VECTOR_STORE = get_env('VECTOR_STORE')

        # weaviate settings
        self.WEAVIATE_ENDPOINT = get_env('WEAVIATE_ENDPOINT')
        self.WEAVIATE_API_KEY = get_env('WEAVIATE_API_KEY')
        self.WEAVIATE_GRPC_ENABLED = get_bool_env('WEAVIATE_GRPC_ENABLED')
        self.WEAVIATE_BATCH_SIZE = int(get_env('WEAVIATE_BATCH_SIZE'))

        # qdrant settings
        self.QDRANT_URL = get_env('QDRANT_URL')
        self.QDRANT_API_KEY = get_env('QDRANT_API_KEY')

        # milvus setting
        self.MILVUS_HOST = get_env('MILVUS_HOST')
        self.MILVUS_PORT = get_env('MILVUS_PORT')
        self.MILVUS_USER = get_env('MILVUS_USER')
        self.MILVUS_PASSWORD = get_env('MILVUS_PASSWORD')
        self.MILVUS_SECURE = get_env('MILVUS_SECURE')


        # cors settings
        self.CONSOLE_CORS_ALLOW_ORIGINS = get_cors_allow_origins(
            'CONSOLE_CORS_ALLOW_ORIGINS', self.CONSOLE_WEB_URL)
        self.WEB_API_CORS_ALLOW_ORIGINS = get_cors_allow_origins(
            'WEB_API_CORS_ALLOW_ORIGINS', '*')

        # mail settings
        self.MAIL_TYPE = get_env('MAIL_TYPE')
        self.MAIL_DEFAULT_SEND_FROM = get_env('MAIL_DEFAULT_SEND_FROM')
        self.RESEND_API_KEY = get_env('RESEND_API_KEY')

        # sentry settings
        self.SENTRY_DSN = get_env('SENTRY_DSN')
        self.SENTRY_TRACES_SAMPLE_RATE = float(get_env('SENTRY_TRACES_SAMPLE_RATE'))
        self.SENTRY_PROFILES_SAMPLE_RATE = float(get_env('SENTRY_PROFILES_SAMPLE_RATE'))

        # check update url
        self.CHECK_UPDATE_URL = get_env('CHECK_UPDATE_URL')

        # database settings
        db_credentials = {
            key: get_env(key) for key in
            ['DB_USERNAME', 'DB_PASSWORD', 'DB_HOST', 'DB_PORT', 'DB_DATABASE']
        }

        self.SQLALCHEMY_DATABASE_URI = f"postgresql://{db_credentials['DB_USERNAME']}:{db_credentials['DB_PASSWORD']}@{db_credentials['DB_HOST']}:{db_credentials['DB_PORT']}/{db_credentials['DB_DATABASE']}"
        self.SQLALCHEMY_ENGINE_OPTIONS = {
            'pool_size': int(get_env('SQLALCHEMY_POOL_SIZE')),
            'pool_recycle': int(get_env('SQLALCHEMY_POOL_RECYCLE'))
        }

        self.SQLALCHEMY_ECHO = get_bool_env('SQLALCHEMY_ECHO')

        # celery settings
        self.CELERY_BROKER_URL = get_env('CELERY_BROKER_URL')
        self.CELERY_BACKEND = get_env('CELERY_BACKEND')
        self.CELERY_RESULT_BACKEND = 'db+{}'.format(self.SQLALCHEMY_DATABASE_URI) \
            if self.CELERY_BACKEND == 'database' else self.CELERY_BROKER_URL
        self.BROKER_USE_SSL = self.CELERY_BROKER_URL.startswith('rediss://')

        # hosted provider credentials
        self.HOSTED_OPENAI_ENABLED = get_bool_env('HOSTED_OPENAI_ENABLED')
        self.HOSTED_OPENAI_API_KEY = get_env('HOSTED_OPENAI_API_KEY')
        self.HOSTED_OPENAI_API_BASE = get_env('HOSTED_OPENAI_API_BASE')
        self.HOSTED_OPENAI_API_ORGANIZATION = get_env('HOSTED_OPENAI_API_ORGANIZATION')
        self.HOSTED_OPENAI_QUOTA_LIMIT = int(get_env('HOSTED_OPENAI_QUOTA_LIMIT'))
        self.HOSTED_OPENAI_PAID_ENABLED = get_bool_env('HOSTED_OPENAI_PAID_ENABLED')
        self.HOSTED_OPENAI_PAID_STRIPE_PRICE_ID = get_env('HOSTED_OPENAI_PAID_STRIPE_PRICE_ID')
        self.HOSTED_OPENAI_PAID_INCREASE_QUOTA = int(get_env('HOSTED_OPENAI_PAID_INCREASE_QUOTA'))

        self.HOSTED_AZURE_OPENAI_ENABLED = get_bool_env('HOSTED_AZURE_OPENAI_ENABLED')
        self.HOSTED_AZURE_OPENAI_API_KEY = get_env('HOSTED_AZURE_OPENAI_API_KEY')
        self.HOSTED_AZURE_OPENAI_API_BASE = get_env('HOSTED_AZURE_OPENAI_API_BASE')
        self.HOSTED_AZURE_OPENAI_QUOTA_LIMIT = int(get_env('HOSTED_AZURE_OPENAI_QUOTA_LIMIT'))

        self.HOSTED_ANTHROPIC_ENABLED = get_bool_env('HOSTED_ANTHROPIC_ENABLED')
        self.HOSTED_ANTHROPIC_API_BASE = get_env('HOSTED_ANTHROPIC_API_BASE')
        self.HOSTED_ANTHROPIC_API_KEY = get_env('HOSTED_ANTHROPIC_API_KEY')
        self.HOSTED_ANTHROPIC_QUOTA_LIMIT = int(get_env('HOSTED_ANTHROPIC_QUOTA_LIMIT'))
        self.HOSTED_ANTHROPIC_PAID_ENABLED = get_bool_env('HOSTED_ANTHROPIC_PAID_ENABLED')
        self.HOSTED_ANTHROPIC_PAID_STRIPE_PRICE_ID = get_env('HOSTED_ANTHROPIC_PAID_STRIPE_PRICE_ID')
        self.HOSTED_ANTHROPIC_PAID_INCREASE_QUOTA = int(get_env('HOSTED_ANTHROPIC_PAID_INCREASE_QUOTA'))
        self.HOSTED_ANTHROPIC_PAID_MIN_QUANTITY = int(get_env('HOSTED_ANTHROPIC_PAID_MIN_QUANTITY'))
        self.HOSTED_ANTHROPIC_PAID_MAX_QUANTITY = int(get_env('HOSTED_ANTHROPIC_PAID_MAX_QUANTITY'))

        self.HOSTED_MODERATION_ENABLED = get_bool_env('HOSTED_MODERATION_ENABLED')
        self.HOSTED_MODERATION_PROVIDERS = get_env('HOSTED_MODERATION_PROVIDERS')

        self.STRIPE_API_KEY = get_env('STRIPE_API_KEY')
        self.STRIPE_WEBHOOK_SECRET = get_env('STRIPE_WEBHOOK_SECRET')

        # notion import setting
        self.NOTION_CLIENT_ID = get_env('NOTION_CLIENT_ID')
        self.NOTION_CLIENT_SECRET = get_env('NOTION_CLIENT_SECRET')
        self.NOTION_INTEGRATION_TYPE = get_env('NOTION_INTEGRATION_TYPE')
        self.NOTION_INTERNAL_SECRET = get_env('NOTION_INTERNAL_SECRET')
        self.NOTION_INTEGRATION_TOKEN = get_env('NOTION_INTEGRATION_TOKEN')

        self.TENANT_DOCUMENT_COUNT = get_env('TENANT_DOCUMENT_COUNT')
        self.CLEAN_DAY_SETTING = get_env('CLEAN_DAY_SETTING')

        # uploading settings
        self.UPLOAD_FILE_SIZE_LIMIT = int(get_env('UPLOAD_FILE_SIZE_LIMIT'))
        self.UPLOAD_FILE_BATCH_LIMIT = int(get_env('UPLOAD_FILE_BATCH_LIMIT'))


class CloudEditionConfig(Config):

    def __init__(self):
        super().__init__()

        self.EDITION = "CLOUD"

        self.GITHUB_CLIENT_ID = get_env('GITHUB_CLIENT_ID')
        self.GITHUB_CLIENT_SECRET = get_env('GITHUB_CLIENT_SECRET')
        self.GOOGLE_CLIENT_ID = get_env('GOOGLE_CLIENT_ID')
        self.GOOGLE_CLIENT_SECRET = get_env('GOOGLE_CLIENT_SECRET')
        self.OAUTH_REDIRECT_PATH = get_env('OAUTH_REDIRECT_PATH')


class TestConfig(Config):

    def __init__(self):
        super().__init__()

        self.EDITION = "SELF_HOSTED"
        self.TESTING = True

        db_credentials = {
            key: get_env(key) for key in ['DB_USERNAME', 'DB_PASSWORD', 'DB_HOST', 'DB_PORT']
        }

        # use a different database for testing: dify_test
        self.SQLALCHEMY_DATABASE_URI = f"postgresql://{db_credentials['DB_USERNAME']}:{db_credentials['DB_PASSWORD']}@{db_credentials['DB_HOST']}:{db_credentials['DB_PORT']}/dify_test"
