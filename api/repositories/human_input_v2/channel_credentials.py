"""Opaque credential values shared by Channel repositories and persistence models."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ChannelEncryptedCredentials(BaseModel):
    """Versioned opaque credential envelope shared by Email and IM Channels."""

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True, validate_default=True)

    version: Literal[1] = Field(default=1, description="Credential envelope format version.")
    ciphertext: str = Field(
        min_length=1,
        repr=False,
        description="Encrypted complete credential payload.",
    )
