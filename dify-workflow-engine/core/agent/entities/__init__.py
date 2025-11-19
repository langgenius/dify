from pydantic import BaseModel

class AgentEntity(BaseModel):
    pass

class AgentNodeData(BaseModel):
    agent_strategy_name: str

class AgentToolEntity(BaseModel):
    pass
