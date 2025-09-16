from pydantic import Field
from pydantic_settings import BaseSettings


class SupabaseStorageConfig(BaseSettings):
    """
    Configuration settings for Supabase Object Storage Service
    """

    SUPABASE_BUCKET_NAME: str | None = Field(
        description="Name of the Supabase bucket to store and retrieve objects (e.g., 'dify-bucket')",
        default=None,
    )

    SUPABASE_API_KEY: str | None = Field(
        description="API KEY for authenticating with Supabase",
        default=None,
    )

    SUPABASE_URL: str | None = Field(
        description="URL of the Supabase",
        default=None,
    )
