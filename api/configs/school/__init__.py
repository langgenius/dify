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

    NEED_MEMORY_GENERATION_APP_IDS: str = Field(
        description="Development app ids for school-level features.",
        default="",
    )

    DEFAULT_TENANT_ID: str = Field(
        description="Default tenant id for school-level features.",
        default="",
    )

    MEMORY_GENERATION_APP_ID: str = Field(
        description="App id for memory generation.",
        default="",
    )
