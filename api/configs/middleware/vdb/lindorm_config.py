from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings


class LindormConfig(BaseSettings):
    """
    Lindorm configs
    """

    LINDORM_URL: Optional[str] = Field(
        description="Lindorm url",
        default=None,
    )
    LINDORM_USERNAME: Optional[str] = Field(
        description="Lindorm user",
        default=None,
    )
    LINDORM_PASSWORD: Optional[str] = Field(
        description="Lindorm password",
        default=None,
    )
