"""References for read_media; media limits remain runtime-owned policy."""

from pydantic import BaseModel, ConfigDict


class DifyReadMediaLayerConfig(BaseModel):
    execution_context: str = "execution_context"
    llm: str = "llm"
    shell: str | None = None

    model_config = ConfigDict(extra="forbid")
