"""Unit tests for AgentAppFeatureConfigService.validate_features.

The validator is the security boundary of the Agent App feature endpoint: it
must (a) drop any Soul-owned keys a caller tries to smuggle in and (b) fill
sane disabled/empty defaults for the presentation features the PRD requires.
"""

import pytest

from services.agent_app_feature_service import AgentAppFeatureConfigService

TENANT_ID = "11111111-1111-1111-1111-111111111111"


class TestValidateFeatures:
    def test_empty_config_fills_disabled_defaults(self):
        result = AgentAppFeatureConfigService.validate_features(TENANT_ID, {})

        assert result["opening_statement"] == ""
        assert result["suggested_questions"] == []
        assert result["suggested_questions_after_answer"] == {"enabled": False}
        assert result["retriever_resource"] == {"enabled": False}
        assert result["speech_to_text"] == {"enabled": False}
        assert result["text_to_speech"]["enabled"] is False

    def test_opener_and_follow_up_round_trip(self):
        result = AgentAppFeatureConfigService.validate_features(
            TENANT_ID,
            {
                "opening_statement": "Hi, I'm Iris.",
                "suggested_questions": ["What can you do?"],
                "suggested_questions_after_answer": {"enabled": True},
                "retriever_resource": {"enabled": True},
            },
        )

        assert result["opening_statement"] == "Hi, I'm Iris."
        assert result["suggested_questions"] == ["What can you do?"]
        assert result["suggested_questions_after_answer"]["enabled"] is True
        assert result["retriever_resource"]["enabled"] is True

    def test_soul_owned_keys_are_dropped(self):
        # model / pre_prompt / agent_mode / tools / user_input_form belong to the
        # Agent Soul and must never be settable through the feature endpoint.
        result = AgentAppFeatureConfigService.validate_features(
            TENANT_ID,
            {
                "opening_statement": "hello",
                "model": {"provider": "x", "name": "y"},
                "pre_prompt": "system override",
                "agent_mode": {"enabled": True, "strategy": "react"},
                "tools": [{"a": 1}],
                "user_input_form": [{"text-input": {}}],
            },
        )

        for forbidden in ("model", "pre_prompt", "agent_mode", "tools", "user_input_form"):
            assert forbidden not in result

    def test_invalid_opening_statement_type_raises(self):
        with pytest.raises(ValueError, match="opening_statement must be of string type"):
            AgentAppFeatureConfigService.validate_features(TENANT_ID, {"opening_statement": 123})

    def test_invalid_suggested_questions_type_raises(self):
        with pytest.raises(ValueError, match="suggested_questions must be of list type"):
            AgentAppFeatureConfigService.validate_features(TENANT_ID, {"suggested_questions": "nope"})
