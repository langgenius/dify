import os

from pydantic import Field

from extensions.configuration.apollo.apollo_env import ApolloEnvConfig


class ConfigurationEnv(ApolloEnvConfig):
    # configuration type
    CONFIGURATION_TYPE: str = Field(
        description="configuration type",
        default=os.environ.get("CONFIGURATION_TYPE", "")
    )
