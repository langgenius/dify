from pydantic import BaseModel


class LLMMessage(BaseModel):
    prompt: str = ''
    prompt_tokens: int = 0
    completion: str = ''
    completion_tokens: int = 0
