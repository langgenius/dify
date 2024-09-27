from typing import Optional

from pydantic import Field, NonNegativeFloat
from pydantic_settings import BaseSettings


class SentryConfig(BaseSettings):
    """
    Configuration settings for Sentry error tracking and performance monitoring
    """

    SENTRY_DSN: Optional[str] = Field(
        description="Sentry Data Source Name (DSN)."
        " This is the unique identifier of your Sentry project, used to send events to the correct project.",
        default=None,
    )

    SENTRY_TRACES_SAMPLE_RATE: NonNegativeFloat = Field(
        description="Sample rate for Sentry performance monitoring traces."
        " Value between 0.0 and 1.0, where 1.0 means 100% of traces are sent to Sentry.",
        default=1.0,
    )

    SENTRY_PROFILES_SAMPLE_RATE: NonNegativeFloat = Field(
        description="Sample rate for Sentry profiling."
        " Value between 0.0 and 1.0, where 1.0 means 100% of profiles are sent to Sentry.",
        default=1.0,
    )
