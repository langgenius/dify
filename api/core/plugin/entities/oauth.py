from collections.abc import Sequence

from pydantic import BaseModel, Field

from core.entities.provider_entities import ProviderConfig


class OAuthSchema(BaseModel):
    """
    OAuth schema
    """

    client_schema: Sequence[ProviderConfig] = Field(
        default_factory=list,
        description="client schema like client_id, client_secret, etc.",
    )

    credentials_schema: Sequence[ProviderConfig] = Field(
        default_factory=list,
        description="credentials schema like access_token, refresh_token, etc.",
    )
