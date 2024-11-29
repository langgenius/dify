import os

from pydantic import Field
from pydantic_settings import BaseSettings


class ApolloConfig(BaseSettings):
    """
    Packaging build information
    """

    APOLLO_APP_ID: str = Field(
        description="apollo app_id",
        default=os.environ.get("APOLLO_APP_ID", ""),
    )

    APOLLO_CLUSTER: str = Field(
        description="apollo cluster",
        default=os.environ.get("APOLLO_CLUSTER", ""),
    )

    APOLLO_CONFIG_URL: str = Field(
        description="apollo config url",
        default=os.environ.get("APOLLO_CONFIG_URL", ""),
    )

    APOLLO_NAMESPACE: str = Field(
        description="apollo namespace",
        default=os.environ.get("APOLLO_NAMESPACE", ""),
    )
