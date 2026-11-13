"""Client-safe JSON configuration for the prompt module."""

from pydantic import BaseModel, ConfigDict, Field


class Config(BaseModel):
    prefix: list[str] | str = Field(default_factory=list)
    user: list[str] | str = Field(default_factory=list)
    suffix: list[str] | str = Field(default_factory=list)
    model_config = ConfigDict(extra="forbid")
