from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings


class BedrockConfig(BaseSettings):
    """
    bedrock configs
    """

    AWS_SECRET_ACCESS_KEY: Optional[str] = Field(
        description="AWS secret access key",
        default=None,
    )

    AWS_ACCESS_KEY_ID: Optional[str] = Field(
        description="AWS secret access id",
        default=None,
    )
