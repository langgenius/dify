from pydantic_settings import BaseSettings, SettingsConfigDict

from configs.deploy import DeploymentConfig
from configs.enterprise import EnterpriseFeatureConfig
from configs.extra import ExtraServiceConfig
from configs.feature import FeatureConfig
from configs.middleware import MiddlewareConfig
from configs.packaging import PackagingInfo


class DifyConfig(
    # based on pydantic-settings
    BaseSettings,

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

    model_config = SettingsConfigDict(
        # read from dotenv format config file
        env_file='.env',
        env_file_encoding='utf-8',
        env_ignore_empty=True,

        # ignore extra attributes
        extra='ignore',
    )
