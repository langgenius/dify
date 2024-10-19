from typing import Annotated, Optional

from pydantic import AliasChoices, Field, HttpUrl, NegativeInt, NonNegativeInt, PositiveInt, computed_field
from pydantic_settings import BaseSettings

from configs.feature.hosted_service import HostedServiceConfig


class SecurityConfig(BaseSettings):
    """
    Security-related configurations for the application
    """

    SECRET_KEY: Optional[str] = Field(
        description="Secret key for secure session cookie signing."
        "Make sure you are changing this key for your deployment with a strong key."
        "Generate a strong key using `openssl rand -base64 42` or set via the `SECRET_KEY` environment variable.",
        default=None,
    )

    RESET_PASSWORD_TOKEN_EXPIRY_HOURS: PositiveInt = Field(
        description="Duration in hours for which a password reset token remains valid",
        default=24,
    )


class AppExecutionConfig(BaseSettings):
    """
    Configuration parameters for application execution
    """

    APP_MAX_EXECUTION_TIME: PositiveInt = Field(
        description="Maximum allowed execution time for the application in seconds",
        default=1200,
    )
    APP_MAX_ACTIVE_REQUESTS: NonNegativeInt = Field(
        description="Maximum number of concurrent active requests per app (0 for unlimited)",
        default=0,
    )


class CodeExecutionSandboxConfig(BaseSettings):
    """
    Configuration for the code execution sandbox environment
    """

    CODE_EXECUTION_ENDPOINT: HttpUrl = Field(
        description="URL endpoint for the code execution service",
        default="http://sandbox:8194",
    )

    CODE_EXECUTION_API_KEY: str = Field(
        description="API key for accessing the code execution service",
        default="dify-sandbox",
    )

    CODE_EXECUTION_CONNECT_TIMEOUT: Optional[float] = Field(
        description="Connection timeout in seconds for code execution requests",
        default=10.0,
    )

    CODE_EXECUTION_READ_TIMEOUT: Optional[float] = Field(
        description="Read timeout in seconds for code execution requests",
        default=60.0,
    )

    CODE_EXECUTION_WRITE_TIMEOUT: Optional[float] = Field(
        description="Write timeout in seconds for code execution request",
        default=10.0,
    )

    CODE_MAX_NUMBER: PositiveInt = Field(
        description="Maximum allowed numeric value in code execution",
        default=9223372036854775807,
    )

    CODE_MIN_NUMBER: NegativeInt = Field(
        description="Minimum allowed numeric value in code execution",
        default=-9223372036854775807,
    )

    CODE_MAX_DEPTH: PositiveInt = Field(
        description="Maximum allowed depth for nested structures in code execution",
        default=5,
    )

    CODE_MAX_PRECISION: PositiveInt = Field(
        description="mMaximum number of decimal places for floating-point numbers in code execution",
        default=20,
    )

    CODE_MAX_STRING_LENGTH: PositiveInt = Field(
        description="Maximum allowed length for strings in code execution",
        default=80000,
    )

    CODE_MAX_STRING_ARRAY_LENGTH: PositiveInt = Field(
        description="Maximum allowed length for string arrays in code execution",
        default=30,
    )

    CODE_MAX_OBJECT_ARRAY_LENGTH: PositiveInt = Field(
        description="Maximum allowed length for object arrays in code execution",
        default=30,
    )

    CODE_MAX_NUMBER_ARRAY_LENGTH: PositiveInt = Field(
        description="Maximum allowed length for numeric arrays in code execution",
        default=1000,
    )


class EndpointConfig(BaseSettings):
    """
    Configuration for various application endpoints and URLs
    """

    CONSOLE_API_URL: str = Field(
        description="Base URL for the console API,"
        "used for login authentication callback or notion integration callbacks",
        default="",
    )

    CONSOLE_WEB_URL: str = Field(
        description="Base URL for the console web interface," "used for frontend references and CORS configuration",
        default="",
    )

    SERVICE_API_URL: str = Field(
        description="Base URL for the service API, displayed to users for API access",
        default="",
    )

    APP_WEB_URL: str = Field(
        description="Base URL for the web application, used for frontend references",
        default="",
    )


class FileAccessConfig(BaseSettings):
    """
    Configuration for file access and handling
    """

    FILES_URL: str = Field(
        description="Base URL for file preview or download,"
        " used for frontend display and multi-model inputs"
        "Url is signed and has expiration time.",
        validation_alias=AliasChoices("FILES_URL", "CONSOLE_API_URL"),
        alias_priority=1,
        default="",
    )

    FILES_ACCESS_TIMEOUT: int = Field(
        description="Expiration time in seconds for file access URLs",
        default=300,
    )


class FileUploadConfig(BaseSettings):
    """
    Configuration for file upload limitations
    """

    UPLOAD_FILE_SIZE_LIMIT: NonNegativeInt = Field(
        description="Maximum allowed file size for uploads in megabytes",
        default=15,
    )

    UPLOAD_FILE_BATCH_LIMIT: NonNegativeInt = Field(
        description="Maximum number of files allowed in a single upload batch",
        default=5,
    )

    UPLOAD_IMAGE_FILE_SIZE_LIMIT: NonNegativeInt = Field(
        description="Maximum allowed image file size for uploads in megabytes",
        default=10,
    )

    BATCH_UPLOAD_LIMIT: NonNegativeInt = Field(
        description="Maximum number of files allowed in a batch upload operation",
        default=20,
    )


class HttpConfig(BaseSettings):
    """
    HTTP-related configurations for the application
    """

    API_COMPRESSION_ENABLED: bool = Field(
        description="Enable or disable gzip compression for HTTP responses",
        default=False,
    )

    inner_CONSOLE_CORS_ALLOW_ORIGINS: str = Field(
        description="Comma-separated list of allowed origins for CORS in the console",
        validation_alias=AliasChoices("CONSOLE_CORS_ALLOW_ORIGINS", "CONSOLE_WEB_URL"),
        default="",
    )

    @computed_field
    @property
    def CONSOLE_CORS_ALLOW_ORIGINS(self) -> list[str]:
        return self.inner_CONSOLE_CORS_ALLOW_ORIGINS.split(",")

    inner_WEB_API_CORS_ALLOW_ORIGINS: str = Field(
        description="",
        validation_alias=AliasChoices("WEB_API_CORS_ALLOW_ORIGINS"),
        default="*",
    )

    @computed_field
    @property
    def WEB_API_CORS_ALLOW_ORIGINS(self) -> list[str]:
        return self.inner_WEB_API_CORS_ALLOW_ORIGINS.split(",")

    HTTP_REQUEST_MAX_CONNECT_TIMEOUT: Annotated[
        PositiveInt, Field(ge=10, description="Maximum connection timeout in seconds for HTTP requests")
    ] = 10

    HTTP_REQUEST_MAX_READ_TIMEOUT: Annotated[
        PositiveInt, Field(ge=60, description="Maximum read timeout in seconds for HTTP requests")
    ] = 60

    HTTP_REQUEST_MAX_WRITE_TIMEOUT: Annotated[
        PositiveInt, Field(ge=10, description="Maximum write timeout in seconds for HTTP requests")
    ] = 20

    HTTP_REQUEST_NODE_MAX_BINARY_SIZE: PositiveInt = Field(
        description="Maximum allowed size in bytes for binary data in HTTP requests",
        default=10 * 1024 * 1024,
    )

    HTTP_REQUEST_NODE_MAX_TEXT_SIZE: PositiveInt = Field(
        description="Maximum allowed size in bytes for text data in HTTP requests",
        default=1 * 1024 * 1024,
    )

    SSRF_PROXY_HTTP_URL: Optional[str] = Field(
        description="Proxy URL for HTTP requests to prevent Server-Side Request Forgery (SSRF)",
        default=None,
    )

    SSRF_PROXY_HTTPS_URL: Optional[str] = Field(
        description="Proxy URL for HTTPS requests to prevent Server-Side Request Forgery (SSRF)",
        default=None,
    )

    RESPECT_XFORWARD_HEADERS_ENABLED: bool = Field(
        description="Enable or disable the X-Forwarded-For Proxy Fix middleware from Werkzeug"
        " to respect X-* headers to redirect clients",
        default=False,
    )


class InnerAPIConfig(BaseSettings):
    """
    Configuration for internal API functionality
    """

    INNER_API: bool = Field(
        description="Enable or disable the internal API",
        default=False,
    )

    INNER_API_KEY: Optional[str] = Field(
        description="API key for accessing the internal API",
        default=None,
    )


class LoggingConfig(BaseSettings):
    """
    Configuration for application logging
    """

    LOG_LEVEL: str = Field(
        description="Logging level, default to INFO. Set to ERROR for production environments.",
        default="INFO",
    )

    LOG_FILE: Optional[str] = Field(
        description="File path for log output.",
        default=None,
    )

    LOG_FORMAT: str = Field(
        description="Format string for log messages",
        default="%(asctime)s.%(msecs)03d %(levelname)s [%(threadName)s] [%(filename)s:%(lineno)d] - %(message)s",
    )

    LOG_DATEFORMAT: Optional[str] = Field(
        description="Date format string for log timestamps",
        default=None,
    )

    LOG_TZ: Optional[str] = Field(
        description="Timezone for log timestamps (e.g., 'America/New_York')",
        default=None,
    )


class ModelLoadBalanceConfig(BaseSettings):
    """
    Configuration for model load balancing
    """

    MODEL_LB_ENABLED: bool = Field(
        description="Enable or disable load balancing for models",
        default=False,
    )


class BillingConfig(BaseSettings):
    """
    Configuration for platform billing features
    """

    BILLING_ENABLED: bool = Field(
        description="Enable or disable billing functionality",
        default=False,
    )


class UpdateConfig(BaseSettings):
    """
    Configuration for application update checks
    """

    CHECK_UPDATE_URL: str = Field(
        description="URL to check for application updates",
        default="https://updates.dify.ai",
    )


class WorkflowConfig(BaseSettings):
    """
    Configuration for workflow execution
    """

    WORKFLOW_MAX_EXECUTION_STEPS: PositiveInt = Field(
        description="Maximum number of steps allowed in a single workflow execution",
        default=500,
    )

    WORKFLOW_MAX_EXECUTION_TIME: PositiveInt = Field(
        description="Maximum execution time in seconds for a single workflow",
        default=1200,
    )

    WORKFLOW_CALL_MAX_DEPTH: PositiveInt = Field(
        description="Maximum allowed depth for nested workflow calls",
        default=5,
    )

    MAX_VARIABLE_SIZE: PositiveInt = Field(
        description="Maximum size in bytes for a single variable in workflows. Default to 5KB.",
        default=5 * 1024,
    )


class AuthConfig(BaseSettings):
    """
    Configuration for authentication and OAuth
    """

    OAUTH_REDIRECT_PATH: str = Field(
        description="Redirect path for OAuth authentication callbacks",
        default="/console/api/oauth/authorize",
    )

    GITHUB_CLIENT_ID: Optional[str] = Field(
        description="GitHub OAuth client ID",
        default=None,
    )

    GITHUB_CLIENT_SECRET: Optional[str] = Field(
        description="GitHub OAuth client secret",
        default=None,
    )

    GOOGLE_CLIENT_ID: Optional[str] = Field(
        description="Google OAuth client ID",
        default=None,
    )

    GOOGLE_CLIENT_SECRET: Optional[str] = Field(
        description="Google OAuth client secret",
        default=None,
    )

    ACCESS_TOKEN_EXPIRE_MINUTES: PositiveInt = Field(
        description="Expiration time for access tokens in minutes",
        default=60,
    )


class ModerationConfig(BaseSettings):
    """
    Configuration for content moderation
    """

    MODERATION_BUFFER_SIZE: PositiveInt = Field(
        description="Size of the buffer for content moderation processing",
        default=300,
    )


class ToolConfig(BaseSettings):
    """
    Configuration for tool management
    """

    TOOL_ICON_CACHE_MAX_AGE: PositiveInt = Field(
        description="Maximum age in seconds for caching tool icons",
        default=3600,
    )


class MailConfig(BaseSettings):
    """
    Configuration for email services
    """

    MAIL_TYPE: Optional[str] = Field(
        description="Email service provider type ('smtp' or 'resend'), default to None.",
        default=None,
    )

    MAIL_DEFAULT_SEND_FROM: Optional[str] = Field(
        description="Default email address to use as the sender",
        default=None,
    )

    RESEND_API_KEY: Optional[str] = Field(
        description="API key for Resend email service",
        default=None,
    )

    RESEND_API_URL: Optional[str] = Field(
        description="API URL for Resend email service",
        default=None,
    )

    SMTP_SERVER: Optional[str] = Field(
        description="SMTP server hostname",
        default=None,
    )

    SMTP_PORT: Optional[int] = Field(
        description="SMTP server port number",
        default=465,
    )

    SMTP_USERNAME: Optional[str] = Field(
        description="Username for SMTP authentication",
        default=None,
    )

    SMTP_PASSWORD: Optional[str] = Field(
        description="Password for SMTP authentication",
        default=None,
    )

    SMTP_USE_TLS: bool = Field(
        description="Enable TLS encryption for SMTP connections",
        default=False,
    )

    SMTP_OPPORTUNISTIC_TLS: bool = Field(
        description="Enable opportunistic TLS for SMTP connections",
        default=False,
    )


class RagEtlConfig(BaseSettings):
    """
    Configuration for RAG ETL processes
    """

    ETL_TYPE: str = Field(
        description="RAG ETL type ('dify' or 'Unstructured'), default to 'dify'",
        default="dify",
    )

    KEYWORD_DATA_SOURCE_TYPE: str = Field(
        description="Data source type for keyword extraction"
        " ('database' or other supported types), default to 'database'",
        default="database",
    )

    UNSTRUCTURED_API_URL: Optional[str] = Field(
        description="API URL for Unstructured.io service",
        default=None,
    )

    UNSTRUCTURED_API_KEY: Optional[str] = Field(
        description="API key for Unstructured.io service",
        default=None,
    )


class DataSetConfig(BaseSettings):
    """
    Configuration for dataset management
    """

    PLAN_SANDBOX_CLEAN_DAY_SETTING: PositiveInt = Field(
        description="Interval in days for dataset cleanup operations - plan: sandbox",
        default=30,
    )

    PLAN_PRO_CLEAN_DAY_SETTING: PositiveInt = Field(
        description="Interval in days for dataset cleanup operations - plan: pro and team",
        default=7,
    )

    DATASET_OPERATOR_ENABLED: bool = Field(
        description="Enable or disable dataset operator functionality",
        default=False,
    )


class WorkspaceConfig(BaseSettings):
    """
    Configuration for workspace management
    """

    INVITE_EXPIRY_HOURS: PositiveInt = Field(
        description="Expiration time in hours for workspace invitation links",
        default=72,
    )


class IndexingConfig(BaseSettings):
    """
    Configuration for indexing operations
    """

    INDEXING_MAX_SEGMENTATION_TOKENS_LENGTH: PositiveInt = Field(
        description="Maximum token length for text segmentation during indexing",
        default=1000,
    )


class ImageFormatConfig(BaseSettings):
    MULTIMODAL_SEND_IMAGE_FORMAT: str = Field(
        description="Format for sending images in multimodal contexts ('base64' or 'url'), default is base64",
        default="base64",
    )


class CeleryBeatConfig(BaseSettings):
    CELERY_BEAT_SCHEDULER_TIME: int = Field(
        description="Interval in days for Celery Beat scheduler execution, default to 1 day",
        default=1,
    )


class PositionConfig(BaseSettings):
    POSITION_PROVIDER_PINS: str = Field(
        description="Comma-separated list of pinned model providers",
        default="",
    )

    POSITION_PROVIDER_INCLUDES: str = Field(
        description="Comma-separated list of included model providers",
        default="",
    )

    POSITION_PROVIDER_EXCLUDES: str = Field(
        description="Comma-separated list of excluded model providers",
        default="",
    )

    POSITION_TOOL_PINS: str = Field(
        description="Comma-separated list of pinned tools",
        default="",
    )

    POSITION_TOOL_INCLUDES: str = Field(
        description="Comma-separated list of included tools",
        default="",
    )

    POSITION_TOOL_EXCLUDES: str = Field(
        description="Comma-separated list of excluded tools",
        default="",
    )

    @computed_field
    def POSITION_PROVIDER_PINS_LIST(self) -> list[str]:
        return [item.strip() for item in self.POSITION_PROVIDER_PINS.split(",") if item.strip() != ""]

    @computed_field
    def POSITION_PROVIDER_INCLUDES_SET(self) -> set[str]:
        return {item.strip() for item in self.POSITION_PROVIDER_INCLUDES.split(",") if item.strip() != ""}

    @computed_field
    def POSITION_PROVIDER_EXCLUDES_SET(self) -> set[str]:
        return {item.strip() for item in self.POSITION_PROVIDER_EXCLUDES.split(",") if item.strip() != ""}

    @computed_field
    def POSITION_TOOL_PINS_LIST(self) -> list[str]:
        return [item.strip() for item in self.POSITION_TOOL_PINS.split(",") if item.strip() != ""]

    @computed_field
    def POSITION_TOOL_INCLUDES_SET(self) -> set[str]:
        return {item.strip() for item in self.POSITION_TOOL_INCLUDES.split(",") if item.strip() != ""}

    @computed_field
    def POSITION_TOOL_EXCLUDES_SET(self) -> set[str]:
        return {item.strip() for item in self.POSITION_TOOL_EXCLUDES.split(",") if item.strip() != ""}


class FeatureConfig(
    # place the configs in alphabet order
    AppExecutionConfig,
    AuthConfig,  # Changed from OAuthConfig to AuthConfig
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
    PositionConfig,
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
