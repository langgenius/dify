from pydantic import Field
from pydantic_settings import BaseSettings


class ApolloConfig(BaseSettings):
    """
    Packaging build information
    """

    APOLLO_APP_ID: str = Field(
        description="apollo app_id",
        default=None,
    )

    APOLLO_CLUSTER: str = Field(
        description="apollo cluster",
        default=None,
    )

    APOLLO_CONFIG_URL: str = Field(
        description="apollo config url",
        default=None,
    )

    APOLLO_NAMESPACE: str = Field(
        description="apollo namespace",
        default=None,
    )
