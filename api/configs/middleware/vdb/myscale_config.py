
from pydantic import BaseModel, Field, PositiveInt


class MyScaleConfig(BaseModel):
    """
    MyScale configs
    """

    MYSCALE_HOST: str = Field(
        description='MyScale host',
        default='localhost',
    )

    MYSCALE_PORT: PositiveInt = Field(
        description='MyScale port',
        default=8123,
    )

    MYSCALE_USER: str = Field(
        description='MyScale user',
        default='default',
    )

    MYSCALE_PASSWORD: str = Field(
        description='MyScale password',
        default='',
    )

    MYSCALE_DATABASE: str = Field(
        description='MyScale database name',
        default='default',
    )

    MYSCALE_FTS_PARAMS: str = Field(
        description='MyScale fts index parameters',
        default='',
    )
