from pydantic_settings import BaseSettings, SettingsConfigDict

from configs.deploy import DeploymentConfigs
from configs.enterprise import EnterpriseFeatureConfigs
from configs.extra import ExtraServiceConfigs
from configs.feature import FeatureConfigs
from configs.middleware import MiddlewareConfigs
from configs.packaging import PackagingInfo


class DifyConfigs(
    # based on pydantic-settings
    BaseSettings,

    # Packaging info
    PackagingInfo,

    # Deployment configs
    DeploymentConfigs,

    # Feature configs
    FeatureConfigs,

    # Middleware configs
    MiddlewareConfigs,

    # Extra service configs
    ExtraServiceConfigs,

    # Enterprise feature configs
    # **Before using, please contact business@dify.ai by email to inquire about licensing matters.**
    EnterpriseFeatureConfigs,
):

    model_config = SettingsConfigDict(
        # read from dotenv format config file
        env_file='.env',
        env_file_encoding='utf-8',

        # ignore extra attributes
        extra='ignore',
    )
