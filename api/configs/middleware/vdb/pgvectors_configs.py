from typing import Optional

from pydantic import BaseModel, Field, PositiveInt


class PGVectoRSConfigs(BaseModel):
    """
    PGVectoRS configs
    """

    PGVECTO_RS_HOST: Optional[str] = Field(
        description='PGVectoRS host',
        default=None,
    )

    PGVECTO_RS_PORT: Optional[PositiveInt] = Field(
        description='PGVectoRS port',
        default=None,
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
