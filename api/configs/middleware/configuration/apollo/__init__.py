from pydantic import Field
from pydantic_settings import BaseSettings


class ApolloConfig(BaseSettings):
    """
    Packaging build information
    """

    APOLLO_APP_ID: str = Field(
        description="apollo app_id",
        default="",
    )

    APOLLO_CLUSTER: str = Field(
        description="apollo cluster",
        default="",
    )

    APOLLO_CONFIG_URL: str = Field(
        description="apollo config url",
        default="",
    )

    APOLLO_NAMESPACE: str = Field(
        description="apollo namespace",
        default="",
    )
