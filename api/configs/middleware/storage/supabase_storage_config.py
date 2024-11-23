from typing import Optional

from pydantic import BaseModel, Field


class SupabaseStorageConfig(BaseModel):
    """
    Configuration settings for Supabase Object Storage Service
    """

    SUPABASE_BUCKET_NAME: Optional[str] = Field(
        description="Name of the Supabase bucket to store and retrieve objects (e.g., 'dify-bucket')",
        default=None,
    )

    SUPABASE_API_KEY: Optional[str] = Field(
        description="API KEY for authenticating with Supabase",
        default=None,
    )

    SUPABASE_URL: Optional[str] = Field(
        description="URL of the Supabase",
        default=None,
    )
