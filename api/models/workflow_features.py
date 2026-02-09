from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Any


class WorkflowFeatures(StrEnum):
    SANDBOX = "sandbox"
    SPEECH_TO_TEXT = "speech_to_text"
    TEXT_TO_SPEECH = "text_to_speech"
    RETRIEVER_RESOURCE = "retriever_resource"
    SENSITIVE_WORD_AVOIDANCE = "sensitive_word_avoidance"
    FILE_UPLOAD = "file_upload"
    SUGGESTED_QUESTIONS_AFTER_ANSWER = "suggested_questions_after_answer"


@dataclass(frozen=True)
class WorkflowFeature:
    enabled: bool
    config: Mapping[str, Any]

    @classmethod
    def from_dict(cls, data: Mapping[str, Any] | None) -> "WorkflowFeature":
        if data is None or not isinstance(data, dict):
            return cls(enabled=False, config={})
        return cls(enabled=bool(data.get("enabled", False)), config=data)
