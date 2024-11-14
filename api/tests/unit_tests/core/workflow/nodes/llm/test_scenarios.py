from pydantic import BaseModel, Field

from core.file import File
from core.model_runtime.entities.message_entities import PromptMessage
from core.model_runtime.entities.model_entities import ModelFeature
from core.workflow.nodes.llm.entities import LLMNodeChatModelMessage


class LLMNodeTestScenario(BaseModel):
    """Test scenario for LLM node testing."""

    description: str = Field(..., description="Description of the test scenario")
    user_query: str = Field(..., description="User query input")
    user_files: list[File] = Field(default_factory=list, description="List of user files")
    vision_enabled: bool = Field(default=False, description="Whether vision is enabled")
    vision_detail: str | None = Field(None, description="Vision detail level if vision is enabled")
    features: list[ModelFeature] = Field(default_factory=list, description="List of model features")
    window_size: int = Field(..., description="Window size for memory")
    prompt_template: list[LLMNodeChatModelMessage] = Field(..., description="Template for prompt messages")
    expected_messages: list[PromptMessage] = Field(..., description="Expected messages after processing")
