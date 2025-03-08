from pydantic import Field
from pydantic_settings import BaseSettings


class SchoolConfig(BaseSettings):
    """
    Configuration for school-level features.
    """

    DEFAULT_APP_ID: str = Field(
        description="Default app id for school-level features.",
        default="b278ba96-fa8e-48a8-b3e9-debe34468be0",
    )

    DEFAULT_TENANT_ID: str = Field(
        description="Default tenant id for school-level features.",
        default="5cd3029e-7f92-428a-a5c8-14a790c70233",
    )

    MEMORY_GENERATION_APP_ID: str = Field(
        description="App id for memory generation.",
        default="b278ba96-fa8e-48a8-b3e9-debe34468be0",
    )
