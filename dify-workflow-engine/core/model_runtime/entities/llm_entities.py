from pydantic import BaseModel

class LLMResult(BaseModel):
    pass

class LLMUsage(BaseModel):
    @classmethod
    def empty_usage(cls):
        return cls()

class LLMUsageMetadata(BaseModel):
    pass
