from typing import Optional

from pydantic import Field, PositiveInt
from pydantic_settings import BaseSettings


class OracleConfig(BaseSettings):
    """
    ORACLE configs
    """

    ORACLE_HOST: Optional[str] = Field(
        description='ORACLE host',
        default=None,
    )

    ORACLE_PORT: Optional[PositiveInt] = Field(
        description='ORACLE port',
        default=1521,
    )

    ORACLE_USER: Optional[str] = Field(
        description='ORACLE user',
        default=None,
    )

    ORACLE_PASSWORD: Optional[str] = Field(
        description='ORACLE password',
        default=None,
    )

    ORACLE_DATABASE: Optional[str] = Field(
        description='ORACLE database',
        default=None,
    )
