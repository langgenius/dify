from typing import Optional

from pydantic import Field

from configs.middleware.configuration.apollo import ApolloConfig


class ConfigurationCenterConfig(ApolloConfig):
    # configuration type
    CONFIGURATION_TYPE: Optional[str] = Field(description="configuration type", default=None)
