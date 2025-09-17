from pydantic import BaseModel


class AgentNodeStrategyInit(BaseModel):
    """Agent node strategy initialization data."""

    name: str
    icon: str | None = None
