from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings


class SchoolConfig(BaseSettings):
    """
    Configuration for school-level features.
    """

    DEFAULT_APP_ID: str = Field(
        description="Default app id for school-level features.",
        default="",
    )

    NEED_USER_PROFILE_GENERATION_APP_IDS: str = Field(
        description="Development app ids for school-level features.",
        default="",
    )

    DEFAULT_TENANT_ID: str = Field(
        description="Default tenant id for school-level features.",
        default="",
    )

    USER_MEMORY_GENERATION_APP_ID: str = Field(
        description="App id for memory generation.",
        default="",
    )

    USER_HEALTH_SUMMARY_GENERATION_APP_ID: str = Field(
        description="App id for health summary generation.",
        default="",
    )

    IMAGE_GENERATION_DAILY_LIMIT: int = Field(
        description="Daily limit for image generation.",
        default=5,
    )

    IMAGE_GENERATION_MIN_CONVERSATION_ROUNDS: int = Field(
        description="Minimum conversation rounds for image generation.",
        default=10,
    )

    IMAGE_GENERATION_APP_ID: Optional[str] = Field(
        description="App id for image generation.",
        default=None,
    )
