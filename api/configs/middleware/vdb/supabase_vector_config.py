from typing import Optional

from pydantic import BaseModel, Field


class SupabaseVectorConfig(BaseModel):
    """
    Configuration settings for Supabase Vector Service
    """

    SUPABASE_VECTOR_API_KEY: Optional[str] = Field(
        description="API KEY for authenticating with Supabase Vector Database",
        default=None,
    )

    SUPABASE_VECTOR_URL: Optional[str] = Field(
        description="URL of the Supabase Vector Database",
        default=None,
    )
