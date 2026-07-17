from pydantic import Field, NonNegativeFloat, NonNegativeInt, PositiveFloat
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

    AGENT_BACKEND_STREAM_READ_TIMEOUT_SECONDS: PositiveFloat = Field(
        description="Read timeout for one Agent backend SSE connection.",
        default=30,
    )

    AGENT_BACKEND_STREAM_MAX_RECONNECTS: NonNegativeInt = Field(
        description="Maximum Agent backend SSE reconnects before failing the run.",
        default=3,
    )

    AGENT_BACKEND_RUN_TIMEOUT_SECONDS: PositiveFloat = Field(
        description="Total deadline for one Agent backend run event stream.",
        default=1200,
    )

    AGENT_SHELL_ENABLED: bool = Field(
        description=(
            "Inject the dify.shell layer (sandboxed bash workspace) into Agent runs. "
            "Requires the agent backend to be wired with a shellctl entrypoint before "
            "shell-using Agent runs are executed."
        ),
        default=True,
    )

    AGENT_APP_TEXT_DELTA_DEBOUNCE_SECONDS: NonNegativeFloat = Field(
        description=(
            "Buffer Agent App assistant text deltas for up to this many seconds before "
            "publishing SSE chunks. Set to 0 to publish each delta immediately."
        ),
        default=0.5,
    )
