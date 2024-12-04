import os

from pydantic import Field

from configs.middleware.configuration.apollo import ApolloConfig


class ConfigurationCenterConfig(ApolloConfig):
    # configuration type
    CONFIGURATION_TYPE: str = Field(description="configuration type", default=os.environ.get("CONFIGURATION_TYPE", ""))
