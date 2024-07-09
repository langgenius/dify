from typing import Optional

from pydantic import Field, PositiveInt
from pydantic_settings import BaseSettings


class PGVectoRSConfig(BaseSettings):
    """
    PGVectoRS configs
    """

    PGVECTO_RS_HOST: Optional[str] = Field(
        description='PGVectoRS host',
        default=None,
    )

    PGVECTO_RS_PORT: Optional[PositiveInt] = Field(
        description='PGVectoRS port',
        default=5431,
    )

    PGVECTO_RS_USER: Optional[str] = Field(
        description='PGVectoRS user',
        default=None,
    )

    PGVECTO_RS_PASSWORD: Optional[str] = Field(
        description='PGVectoRS password',
        default=None,
    )

    PGVECTO_RS_DATABASE: Optional[str] = Field(
        description='PGVectoRS database',
        default=None,
    )
