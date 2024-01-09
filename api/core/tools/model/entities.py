from pydantic import BaseModel

class ToolModelConfig(BaseModel):
    provider: str
    model: str
    model_parameters: dict