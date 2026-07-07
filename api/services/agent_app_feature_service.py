"""Validate and persist the app-level presentation features of an Agent App.

An Agent App keeps its model / prompt / tools in the bound Agent Soul; only the
PRD "Misc Legacy" presentation features — conversation opener, follow-up
suggestions, citations, content moderation and speech — live on
``app_model_config``. This service validates that feature subset and writes a
new ``app_model_config`` version, mirroring the legacy model-config save flow
but deliberately never touching model, prompt, tools, datasets or agent_mode
(those are owned by the Soul and must not be settable through this endpoint).
"""

from __future__ import annotations

from typing import Any, cast

from sqlalchemy.orm import scoped_session

from core.app.app_config.common.sensitive_word_avoidance.manager import SensitiveWordAvoidanceConfigManager
from core.app.app_config.features.opening_statement.manager import OpeningStatementConfigManager
from core.app.app_config.features.retrieval_resource.manager import RetrievalResourceConfigManager
from core.app.app_config.features.speech_to_text.manager import SpeechToTextConfigManager
from core.app.app_config.features.suggested_questions_after_answer.manager import (
    SuggestedQuestionsAfterAnswerConfigManager,
)
from core.app.app_config.features.text_to_speech.manager import TextToSpeechConfigManager
from libs.datetime_utils import naive_utc_now
from models.account import Account
from models.model import App, AppModelConfig, AppModelConfigDict


class AgentAppFeatureConfigService:
    """Service for the Agent App presentation-feature config surface."""

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
    def validate_features(cls, tenant_id: str, config: dict[str, Any]) -> AppModelConfigDict:
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
        return cast(AppModelConfigDict, filtered)

    @classmethod
    def update_features(
        cls,
        *,
        app_model: App,
        account: Account,
        config: dict[str, Any],
        session: scoped_session,
    ) -> AppModelConfig:
        """Persist the presentation features as a new app_model_config version.

        Returns the new ``AppModelConfig`` row (now referenced by the app); the
        row carries only feature flags, with model / prompt / agent_mode left
        ``NULL`` so the Agent Soul remains the single source of truth for those.
        """
        validated = cls.validate_features(app_model.tenant_id, config)

        new_config = AppModelConfig(
            app_id=app_model.id,
            created_by=account.id,
            updated_by=account.id,
        ).from_model_config_dict(validated)

        session.add(new_config)
        session.flush()

        app_model.app_model_config_id = new_config.id
        app_model.updated_by = account.id
        app_model.updated_at = naive_utc_now()
        session.commit()

        return new_config


__all__ = ["AgentAppFeatureConfigService"]
