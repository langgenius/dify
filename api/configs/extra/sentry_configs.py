from typing import Optional

from pydantic import BaseModel, Field, PositiveFloat


class SentryConfigs(BaseModel):
    """
    Sentry configs
    """
    SENTRY_DSN: Optional[str] = Field(
        description='Sentry DSN',
        default=None,
    )

    SENTRY_TRACES_SAMPLE_RATE: PositiveFloat = Field(
        description='Sentry trace sample rate',
        default=1.0,
    )

    SENTRY_PROFILES_SAMPLE_RATE: PositiveFloat = Field(
        description='Sentry profiles sample rate',
        default=1.0,
    )
