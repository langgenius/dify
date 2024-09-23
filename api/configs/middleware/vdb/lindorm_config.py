from typing import Optional

from pydantic import Field, PositiveInt
from pydantic_settings import BaseSettings

class LindormConfig(BaseSettings):
    """
    Lindorm configs
    """
    LINDORM_HOST: Optional[str] = Field(
        description="Lindorm host",
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