from pydantic import BaseModel


class AgentNodeStrategyInit(BaseModel):
    name: str
    icon: str | None = None
