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

    AGENT_SHELL_ENABLED: bool = Field(
        description=(
            "Inject the dify.shell layer (sandboxed bash workspace) into Agent runs. "
            "Requires the agent backend to be wired with a shellctl entrypoint; keep it "
            "off until shellctl is deployed, otherwise every agent run that includes the "
            "shell layer will fail."
        ),
        default=False,
    )
