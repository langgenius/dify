from pydantic import BaseModel


class ChainResult(BaseModel):
    type: str = None
    prompt: dict = None
    completion: dict = None

    status: str = 'chain_started'
    completed: bool = False

    started_at: float = None
    completed_at: float = None

    agent_result: dict = None
    """only when type is 'AgentExecutor'"""
