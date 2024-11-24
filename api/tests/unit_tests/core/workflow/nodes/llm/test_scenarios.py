from collections.abc import Mapping, Sequence

from pydantic import BaseModel, Field

from core.file import File
from core.model_runtime.entities.message_entities import PromptMessage
from core.model_runtime.entities.model_entities import ModelFeature
from core.workflow.nodes.llm.entities import LLMNodeChatModelMessage


class LLMNodeTestScenario(BaseModel):
    """Test scenario for LLM node testing."""

    description: str = Field(..., description="Description of the test scenario")
    user_query: str = Field(..., description="User query input")
    user_files: Sequence[File] = Field(default_factory=list, description="List of user files")
    vision_enabled: bool = Field(default=False, description="Whether vision is enabled")
    vision_detail: str | None = Field(None, description="Vision detail level if vision is enabled")
    features: Sequence[ModelFeature] = Field(default_factory=list, description="List of model features")
    window_size: int = Field(..., description="Window size for memory")
    prompt_template: Sequence[LLMNodeChatModelMessage] = Field(..., description="Template for prompt messages")
    file_variables: Mapping[str, File | Sequence[File]] = Field(
        default_factory=dict, description="List of file variables"
    )
    expected_messages: Sequence[PromptMessage] = Field(..., description="Expected messages after processing")
