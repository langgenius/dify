from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings


class ApolloConfig(BaseSettings):
    """
    Packaging build information
    """

    APOLLO_APP_ID: Optional[str] = Field(
        description="apollo app_id",
        default=None,
    )

    APOLLO_CLUSTER: Optional[str] = Field(
        description="apollo cluster",
        default=None,
    )

    APOLLO_CONFIG_URL: Optional[str] = Field(
        description="apollo config url",
        default=None,
    )

    APOLLO_NAMESPACE: Optional[str] = Field(
        description="apollo namespace",
        default=None,
    )
