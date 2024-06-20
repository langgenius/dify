from typing import Optional

from pydantic import BaseModel, Field, PositiveInt


class RelytConfigs(BaseModel):
    """
    Relyt configs
    """

    RELYT_HOST: Optional[str] = Field(
        description='Relyt host',
        default=None,
    )

    RELYT_PORT: PositiveInt = Field(
        description='Relyt port',
        default=9200,
    )

    RELYT_USER: Optional[str] = Field(
        description='Relyt user',
        default=None,
    )

    RELYT_PASSWORD: Optional[str] = Field(
        description='Relyt password',
        default=None,
    )

    RELYT_DATABASE: Optional[str] = Field(
        description='Relyt database',
        default='default',
    )
