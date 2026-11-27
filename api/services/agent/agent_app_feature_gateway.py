"""Adapter to the shared app feature configuration validators."""

from __future__ import annotations

from typing import Any

from core.app.app_config.common.sensitive_word_avoidance.manager import SensitiveWordAvoidanceConfigManager
from core.app.app_config.features.opening_statement.manager import OpeningStatementConfigManager
from core.app.app_config.features.retrieval_resource.manager import RetrievalResourceConfigManager
from core.app.app_config.features.speech_to_text.manager import SpeechToTextConfigManager
from core.app.app_config.features.suggested_questions_after_answer.manager import (
    SuggestedQuestionsAfterAnswerConfigManager,
)
from core.app.app_config.features.text_to_speech.manager import TextToSpeechConfigManager


class AgentAppFeatureValidator:
    """Normalize presentation features with the existing config managers."""

    # The only keys this surface accepts. Anything else (model, pre_prompt,
    # agent_mode, tools, datasets, user_input_form, ...) is dropped so a caller
    # cannot smuggle Soul-owned configuration in through the feature endpoint.
    ALLOWED_KEYS = (
        "opening_statement",
        "suggested_questions",
        "suggested_questions_after_answer",
        "speech_to_text",
        "text_to_speech",
        "retriever_resource",
        "sensitive_word_avoidance",
    )

    @classmethod
    def validate_features(cls, tenant_id: str, config: dict[str, Any]) -> dict[str, Any]:
        """Validate and normalize the feature subset, filling defaults."""
        working = {key: config[key] for key in cls.ALLOWED_KEYS if key in config}

        related_keys: list[str] = []
        for validate in (
            OpeningStatementConfigManager.validate_and_set_defaults,
            SuggestedQuestionsAfterAnswerConfigManager.validate_and_set_defaults,
            SpeechToTextConfigManager.validate_and_set_defaults,
            TextToSpeechConfigManager.validate_and_set_defaults,
            RetrievalResourceConfigManager.validate_and_set_defaults,
        ):
            working, keys = validate(working)
            related_keys.extend(keys)

        # Moderation needs the tenant to validate its provider configuration.
        working, keys = SensitiveWordAvoidanceConfigManager.validate_and_set_defaults(tenant_id, working)
        related_keys.extend(keys)

        filtered = {key: working.get(key) for key in set(related_keys)}
        return filtered
