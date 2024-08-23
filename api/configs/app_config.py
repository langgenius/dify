from pydantic import Field, computed_field
from pydantic_settings import SettingsConfigDict

from configs.deploy import DeploymentConfig
from configs.enterprise import EnterpriseFeatureConfig
from configs.extra import ExtraServiceConfig
from configs.feature import FeatureConfig
from configs.middleware import MiddlewareConfig
from configs.packaging import PackagingInfo


class DifyConfig(
    # Packaging info
    PackagingInfo,
    # Deployment configs
    DeploymentConfig,
    # Feature configs
    FeatureConfig,
    # Middleware configs
    MiddlewareConfig,
    # Extra service configs
    ExtraServiceConfig,
    # Enterprise feature configs
    # **Before using, please contact business@dify.ai by email to inquire about licensing matters.**
    EnterpriseFeatureConfig,
):
    DEBUG: bool = Field(default=False, description='whether to enable debug mode.')

    model_config = SettingsConfigDict(
        # read from dotenv format config file
        env_file='.env',
        env_file_encoding='utf-8',
        frozen=True,
        # ignore extra attributes
        extra='ignore',
    )

    HTTP_REQUEST_MAX_CONNECT_TIMEOUT: int = 300
    HTTP_REQUEST_MAX_READ_TIMEOUT: int = 600
    HTTP_REQUEST_MAX_WRITE_TIMEOUT: int = 600
    HTTP_REQUEST_NODE_MAX_BINARY_SIZE: int = 1024 * 1024 * 10

    @computed_field
    def HTTP_REQUEST_NODE_READABLE_MAX_BINARY_SIZE(self) -> str:
        return f'{self.HTTP_REQUEST_NODE_MAX_BINARY_SIZE / 1024 / 1024:.2f}MB'

    HTTP_REQUEST_NODE_MAX_TEXT_SIZE: int = 1024 * 1024

    @computed_field
    def HTTP_REQUEST_NODE_READABLE_MAX_TEXT_SIZE(self) -> str:
        return f'{self.HTTP_REQUEST_NODE_MAX_TEXT_SIZE / 1024 / 1024:.2f}MB'

    SSRF_PROXY_HTTP_URL: str | None = None
    SSRF_PROXY_HTTPS_URL: str | None = None

    MAX_VARIABLE_SIZE: int = Field(default=5 * 1024, description='The maximum size of a variable. default is 5KB.')
