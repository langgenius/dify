from typing import Any

from pydantic import BaseModel, ConfigDict


class AppModelSelectionPayload(BaseModel):
    model_config = ConfigDict(extra="allow")

    provider: str
    name: str
    completion_params: dict[str, Any]
    mode: str | None = None


class AppModelConfigPayload(BaseModel):
    """Transport shape; app-mode validators own defaults and feature-specific rules."""

    model_config = ConfigDict(extra="allow")

    model: AppModelSelectionPayload
    prompt_type: str | None = None
    pre_prompt: str | None = None
    chat_prompt_config: dict[str, Any] | None = None
    completion_prompt_config: dict[str, Any] | None = None
    user_input_form: list[dict[str, Any]] | None = None
    dataset_query_variable: str | None = None
    dataset_configs: dict[str, Any] | None = None
    agent_mode: dict[str, Any] | None = None
    external_data_tools: list[dict[str, Any]] | None = None
    file_upload: dict[str, Any] | None = None
    opening_statement: str | None = None
    suggested_questions: list[str] | None = None
    suggested_questions_after_answer: dict[str, Any] | None = None
    more_like_this: dict[str, Any] | None = None
    speech_to_text: dict[str, Any] | None = None
    text_to_speech: dict[str, Any] | None = None
    retriever_resource: dict[str, Any] | None = None
    sensitive_word_avoidance: dict[str, Any] | None = None
