from typing import Optional

from pydantic import BaseModel, Field, PositiveInt


class MyScaleConfig(BaseModel):
    """
    MyScale configs
    """

    MYSCALE_HOST: Optional[str] = Field(
        description='MyScale host',
        default=None,
    )

    MYSCALE_PORT: Optional[PositiveInt] = Field(
        description='MyScale port',
        default=8123,
    )

    MYSCALE_USER: Optional[str] = Field(
        description='MyScale user',
        default=None,
    )

    MYSCALE_PASSWORD: Optional[str] = Field(
        description='MyScale password',
        default=None,
    )

    MYSCALE_DATABASE: Optional[str] = Field(
        description='MyScale database name',
        default=None,
    )

    MYSCALE_FTS_PARAMS: Optional[str] = Field(
        description='MyScale fts index parameters',
        default=None,
    )
