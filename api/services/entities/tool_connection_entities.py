"""Framework-neutral values for published tool connection requirements."""

from pydantic import BaseModel, ConfigDict, Field

from constants.end_user_connections import ConnectionCredentialType


class ToolConnectionRequirement(BaseModel):
    """Published authorization requirements, independent of personal connection readiness."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    node_id: str = Field(description="Independent authorization node ID to use as the selection key.")
    node_ids: tuple[str, ...] = Field(description="The authorization node and all nodes explicitly reusing it.")
    title: str
    purpose: str
    provider: str
    allowed_credential_types: tuple[ConnectionCredentialType, ...]
