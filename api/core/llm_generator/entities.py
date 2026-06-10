"""Shared payload models for LLM generator helpers and controllers."""

from pydantic import BaseModel, Field

from core.app.app_config.entities import ModelConfig


class RuleGeneratePayload(BaseModel):
    instruction: str = Field(..., description="Rule generation instruction")
    model_config_data: ModelConfig = Field(..., alias="model_config", description="Model configuration")
    no_variable: bool = Field(default=False, description="Whether to exclude variables")


class RuleCodeGeneratePayload(RuleGeneratePayload):
    code_language: str = Field(default="javascript", description="Programming language for code generation")


class RuleStructuredOutputPayload(BaseModel):
    instruction: str = Field(..., description="Structured output generation instruction")
    model_config_data: ModelConfig = Field(..., alias="model_config", description="Model configuration")
