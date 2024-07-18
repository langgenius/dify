from typing import Optional

from pydantic import BaseModel, Field, PositiveInt


class MyScaleConfig(BaseModel):
    """
    MyScale configs
    """

    MYSCALE_HOST: Optional[str] = Field(
        description='MyScale host',
        default='localhost',
    )

    MYSCALE_PORT: Optional[PositiveInt] = Field(
        description='MyScale port',
        default=8123,
    )

    MYSCALE_USER: Optional[str] = Field(
        description='MyScale user',
        default='default',
    )

    MYSCALE_PASSWORD: Optional[str] = Field(
        description='MyScale password',
        default='',
    )

    MYSCALE_DATABASE: Optional[str] = Field(
        description='MyScale database name',
        default='default',
    )

    MYSCALE_FTS_PARAMS: Optional[str] = Field(
        description='MyScale fts index parameters',
        default='',
    )
