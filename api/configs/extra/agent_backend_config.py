from pydantic import Field
from pydantic_settings import BaseSettings


class AgentBackendConfig(BaseSettings):
    """
    Configuration settings for the Agent backend runtime integration.
    """

    AGENT_BACKEND_BASE_URL: str | None = Field(
        description="Base URL for the Dify Agent backend service.",
        default=None,
    )

    AGENT_BACKEND_USE_FAKE: bool = Field(
        description="Use the deterministic in-process fake Agent backend client.",
        default=False,
    )

    AGENT_BACKEND_FAKE_SCENARIO: str = Field(
        description="Scenario used by the fake Agent backend client.",
        default="success",
    )
