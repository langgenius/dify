from pydantic import BaseModel


class AgentLoop(BaseModel):
    position: int = 1

    thought: str = None
    tool_name: str = None
    tool_input: str = None
    tool_output: str = None

    prompt: str = None
    prompt_tokens: int = None
    completion: str = None
    completion_tokens: int = None

    latency: float = None

    status: str = 'llm_started'
    completed: bool = False

    started_at: float = None
    completed_at: float = None