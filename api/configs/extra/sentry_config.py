from typing import Optional

from pydantic import Field, NonNegativeFloat
from pydantic_settings import BaseSettings


class SentryConfig(BaseSettings):
    """
    Sentry configs
    """
    SENTRY_DSN: Optional[str] = Field(
        description='Sentry DSN',
        default=None,
    )

    SENTRY_TRACES_SAMPLE_RATE: NonNegativeFloat = Field(
        description='Sentry trace sample rate',
        default=1.0,
    )

    SENTRY_PROFILES_SAMPLE_RATE: NonNegativeFloat = Field(
        description='Sentry profiles sample rate',
        default=1.0,
    )
