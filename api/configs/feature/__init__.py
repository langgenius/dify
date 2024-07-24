from typing import Optional

from pydantic import AliasChoices, Field, NonNegativeInt, PositiveInt, computed_field
from pydantic_settings import BaseSettings

from configs.feature.hosted_service import HostedServiceConfig


class SecurityConfig(BaseSettings):
    """
    Secret Key configs
    """
    SECRET_KEY: Optional[str] = Field(
        description='Your App secret key will be used for securely signing the session cookie'
                    'Make sure you are changing this key for your deployment with a strong key.'
                    'You can generate a strong key using `openssl rand -base64 42`.'
                    'Alternatively you can set it with `SECRET_KEY` environment variable.',
        default=None,
    )

    RESET_PASSWORD_TOKEN_EXPIRY_HOURS: PositiveInt = Field(
        description='Expiry time in hours for reset token',
        default=24,
    )


class AppExecutionConfig(BaseSettings):
    """
    App Execution configs
    """
    APP_MAX_EXECUTION_TIME: PositiveInt = Field(
        description='execution timeout in seconds for app execution',
        default=1200,
    )
    APP_MAX_ACTIVE_REQUESTS: NonNegativeInt = Field(
        description='max active request per app, 0 means unlimited',
        default=0,
    )


class CodeExecutionSandboxConfig(BaseSettings):
    """
    Code Execution Sandbox configs
    """
    CODE_EXECUTION_ENDPOINT: str = Field(
        description='endpoint URL of code execution servcie',
        default='http://sandbox:8194',
    )

    CODE_EXECUTION_API_KEY: str = Field(
        description='API key for code execution service',
        default='dify-sandbox',
    )


class EndpointConfig(BaseSettings):
    """
    Module URL configs
    """
    CONSOLE_API_URL: str = Field(
        description='The backend URL prefix of the console API.'
                    'used to concatenate the login authorization callback or notion integration callback.',
        default='',
    )

    CONSOLE_WEB_URL: str = Field(
        description='The front-end URL prefix of the console web.'
                    'used to concatenate some front-end addresses and for CORS configuration use.',
        default='',
    )

    SERVICE_API_URL: str = Field(
        description='Service API Url prefix.'
                    'used to display Service API Base Url to the front-end.',
        default='',
    )

    APP_WEB_URL: str = Field(
        description='WebApp Url prefix.'
                    'used to display WebAPP API Base Url to the front-end.',
        default='',
    )


class FileAccessConfig(BaseSettings):
    """
    File Access configs
    """
    FILES_URL: str = Field(
        description='File preview or download Url prefix.'
                    ' used to display File preview or download Url to the front-end or as Multi-model inputs;'
                    'Url is signed and has expiration time.',
        validation_alias=AliasChoices('FILES_URL', 'CONSOLE_API_URL'),
        alias_priority=1,
        default='',
    )

    FILES_ACCESS_TIMEOUT: int = Field(
        description='timeout in seconds for file accessing',
        default=300,
    )


class FileUploadConfig(BaseSettings):
    """
    File Uploading configs
    """
    UPLOAD_FILE_SIZE_LIMIT: NonNegativeInt = Field(
        description='size limit in Megabytes for uploading files',
        default=15,
    )

    UPLOAD_FILE_BATCH_LIMIT: NonNegativeInt = Field(
        description='batch size limit for uploading files',
        default=5,
    )

    UPLOAD_IMAGE_FILE_SIZE_LIMIT: NonNegativeInt = Field(
        description='image file size limit in Megabytes for uploading files',
        default=10,
    )

    BATCH_UPLOAD_LIMIT: NonNegativeInt = Field(
        description='',  # todo: to be clarified
        default=20,
    )


class HttpConfig(BaseSettings):
    """
    HTTP configs
    """
    API_COMPRESSION_ENABLED: bool = Field(
        description='whether to enable HTTP response compression of gzip',
        default=False,
    )

    inner_CONSOLE_CORS_ALLOW_ORIGINS: str = Field(
        description='',
        validation_alias=AliasChoices('CONSOLE_CORS_ALLOW_ORIGINS', 'CONSOLE_WEB_URL'),
        default='',
    )

    @computed_field
    @property
    def CONSOLE_CORS_ALLOW_ORIGINS(self) -> list[str]:
        return self.inner_CONSOLE_CORS_ALLOW_ORIGINS.split(',')

    inner_WEB_API_CORS_ALLOW_ORIGINS: str = Field(
        description='',
        validation_alias=AliasChoices('WEB_API_CORS_ALLOW_ORIGINS'),
        default='*',
    )

    @computed_field
    @property
    def WEB_API_CORS_ALLOW_ORIGINS(self) -> list[str]:
        return self.inner_WEB_API_CORS_ALLOW_ORIGINS.split(',')


class InnerAPIConfig(BaseSettings):
    """
    Inner API configs
    """
    INNER_API: bool = Field(
        description='whether to enable the inner API',
        default=False,
    )

    INNER_API_KEY: Optional[str] = Field(
        description='The inner API key is used to authenticate the inner API',
        default=None,
    )


class LoggingConfig(BaseSettings):
    """
    Logging configs
    """

    LOG_LEVEL: str = Field(
        description='Log output level, default to INFO.'
                    'It is recommended to set it to ERROR for production.',
        default='INFO',
    )

    LOG_FILE: Optional[str] = Field(
        description='logging output file path',
        default=None,
    )

    LOG_FORMAT: str = Field(
        description='log format',
        default='%(asctime)s.%(msecs)03d %(levelname)s [%(threadName)s] [%(filename)s:%(lineno)d] - %(message)s',
    )

    LOG_DATEFORMAT: Optional[str] = Field(
        description='log date format',
        default=None,
    )

    LOG_TZ: Optional[str] = Field(
        description='specify log timezone, eg: America/New_York',
        default=None,
    )


class ModelLoadBalanceConfig(BaseSettings):
    """
    Model load balance configs
    """
    MODEL_LB_ENABLED: bool = Field(
        description='whether to enable model load balancing',
        default=False,
    )


class BillingConfig(BaseSettings):
    """
    Platform Billing Configurations
    """
    BILLING_ENABLED: bool = Field(
        description='whether to enable billing',
        default=False,
    )


class UpdateConfig(BaseSettings):
    """
    Update configs
    """
    CHECK_UPDATE_URL: str = Field(
        description='url for checking updates',
        default='https://updates.dify.ai',
    )


class WorkflowConfig(BaseSettings):
    """
    Workflow feature configs
    """

    WORKFLOW_MAX_EXECUTION_STEPS: PositiveInt = Field(
        description='max execution steps in single workflow execution',
        default=500,
    )

    WORKFLOW_MAX_EXECUTION_TIME: PositiveInt = Field(
        description='max execution time in seconds in single workflow execution',
        default=1200,
    )

    WORKFLOW_CALL_MAX_DEPTH: PositiveInt = Field(
        description='max depth of calling in single workflow execution',
        default=5,
    )


class OAuthConfig(BaseSettings):
    """
    oauth configs
    """
    OAUTH_REDIRECT_PATH: str = Field(
        description='redirect path for OAuth',
        default='/console/api/oauth/authorize',
    )

    GITHUB_CLIENT_ID: Optional[str] = Field(
        description='GitHub client id for OAuth',
        default=None,
    )

    GITHUB_CLIENT_SECRET: Optional[str] = Field(
        description='GitHub client secret key for OAuth',
        default=None,
    )

    GOOGLE_CLIENT_ID: Optional[str] = Field(
        description='Google client id for OAuth',
        default=None,
    )

    GOOGLE_CLIENT_SECRET: Optional[str] = Field(
        description='Google client secret key for OAuth',
        default=None,
    )


class ModerationConfig(BaseSettings):
    """
    Moderation in app configs.
    """

    # todo: to be clarified in usage and unit
    OUTPUT_MODERATION_BUFFER_SIZE: PositiveInt = Field(
        description='buffer size for moderation',
        default=300,
    )


class ToolConfig(BaseSettings):
    """
    Tool configs
    """

    TOOL_ICON_CACHE_MAX_AGE: PositiveInt = Field(
        description='max age in seconds for tool icon caching',
        default=3600,
    )


class MailConfig(BaseSettings):
    """
    Mail Configurations
    """

    MAIL_TYPE: Optional[str] = Field(
        description='Mail provider type name, default to None, availabile values are `smtp` and `resend`.',
        default=None,
    )

    MAIL_DEFAULT_SEND_FROM: Optional[str] = Field(
        description='default email address for sending from ',
        default=None,
    )

    RESEND_API_KEY: Optional[str] = Field(
        description='API key for Resend',
        default=None,
    )

    RESEND_API_URL: Optional[str] = Field(
        description='API URL for Resend',
        default=None,
    )

    SMTP_SERVER: Optional[str] = Field(
        description='smtp server host',
        default=None,
    )

    SMTP_PORT: Optional[int] = Field(
        description='smtp server port',
        default=465,
    )

    SMTP_USERNAME: Optional[str] = Field(
        description='smtp server username',
        default=None,
    )

    SMTP_PASSWORD: Optional[str] = Field(
        description='smtp server password',
        default=None,
    )

    SMTP_USE_TLS: bool = Field(
        description='whether to use TLS connection to smtp server',
        default=False,
    )

    SMTP_OPPORTUNISTIC_TLS: bool = Field(
        description='whether to use opportunistic TLS connection to smtp server',
        default=False,
    )


class RagEtlConfig(BaseSettings):
    """
    RAG ETL Configurations.
    """

    ETL_TYPE: str = Field(
        description='RAG ETL type name, default to `dify`, available values are `dify` and `Unstructured`. ',
        default='dify',
    )

    KEYWORD_DATA_SOURCE_TYPE: str = Field(
        description='source type for keyword data, default to `database`, available values are `database` .',
        default='database',
    )

    UNSTRUCTURED_API_URL: Optional[str] = Field(
        description='API URL for Unstructured',
        default=None,
    )

    UNSTRUCTURED_API_KEY: Optional[str] = Field(
        description='API key for Unstructured',
        default=None,
    )


class DataSetConfig(BaseSettings):
    """
    Dataset configs
    """

    CLEAN_DAY_SETTING: PositiveInt = Field(
        description='interval in days for cleaning up dataset',
        default=30,
    )

    DATASET_OPERATOR_ENABLED: bool = Field(
        description='whether to enable dataset operator',
        default=False,
    )

class WorkspaceConfig(BaseSettings):
    """
    Workspace configs
    """

    INVITE_EXPIRY_HOURS: PositiveInt = Field(
        description='workspaces invitation expiration in hours',
        default=72,
    )


class IndexingConfig(BaseSettings):
    """
    Indexing configs.
    """

    INDEXING_MAX_SEGMENTATION_TOKENS_LENGTH: PositiveInt = Field(
        description='max segmentation token length for indexing',
        default=1000,
    )


class ImageFormatConfig(BaseSettings):
    MULTIMODAL_SEND_IMAGE_FORMAT: str = Field(
        description='multi model send image format, support base64, url, default is base64',
        default='base64',
    )


class CeleryBeatConfig(BaseSettings):
    CELERY_BEAT_SCHEDULER_TIME: int = Field(
        description='the time of the celery scheduler, default to 1 day',
        default=1,
    )


class FeatureConfig(
    # place the configs in alphabet order
    AppExecutionConfig,
    BillingConfig,
    CodeExecutionSandboxConfig,
    DataSetConfig,
    EndpointConfig,
    FileAccessConfig,
    FileUploadConfig,
    HttpConfig,
    ImageFormatConfig,
    InnerAPIConfig,
    IndexingConfig,
    LoggingConfig,
    MailConfig,
    ModelLoadBalanceConfig,
    ModerationConfig,
    OAuthConfig,
    RagEtlConfig,
    SecurityConfig,
    ToolConfig,
    UpdateConfig,
    WorkflowConfig,
    WorkspaceConfig,

    # hosted services config
    HostedServiceConfig,
    CeleryBeatConfig,
):
    pass
