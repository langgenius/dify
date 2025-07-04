from typing import Optional, Any
from pydantic import BaseModel, Field, model_validator
from core.prompt.entities.role_prefix import RolePrefix
from core.prompt.entities.window import Window
class MemoryConfig(BaseModel):
    role_prefix: RolePrefix = Field(default_factory=RolePrefix)
    window: Window = Field(default_factory=Window)
    memory_key: Optional[str] = Field(None)
    # The `model_validate` method is used to create a `MemoryConfig` object from a dictionary.
    @model_validator(mode="before")
    @classmethod
    def pre_validate(cls, values: Any) -> Any:
        if "role_prefix" not in values:
            values["role_prefix"] = {}
        if "window" not in values:
            values["window"] = {}
        return values
