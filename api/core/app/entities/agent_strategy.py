from pydantic import BaseModel, ConfigDict


class AgentStrategyInfo(BaseModel):
    name: str
    icon: str | None = None

    model_config = ConfigDict(extra="forbid")
