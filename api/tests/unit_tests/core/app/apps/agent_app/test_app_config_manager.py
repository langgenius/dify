"""Unit tests for AgentAppConfigManager._synthesize_config_dict — the Soul →
app_model_config-shaped dict bridge that lets an Agent App ride the chat pipeline."""

from __future__ import annotations

from types import SimpleNamespace

from core.app.apps.agent_app.app_config_manager import AgentAppConfigManager
from models.agent_config_entities import AgentSoulConfig


def _soul() -> AgentSoulConfig:
    return AgentSoulConfig.model_validate(
        {
            "model": {
                "plugin_id": "langgenius/openai",
                "model_provider": "langgenius/openai/openai",
                "model": "gpt-4o-mini",
                "model_settings": {"temperature": 0.2},
            },
            "prompt": {"system_prompt": "You are Iris."},
        }
    )


def test_model_and_prompt_come_from_soul():
    d = AgentAppConfigManager._synthesize_config_dict(_soul(), None)
    assert d["model"] == {
        "provider": "langgenius/openai/openai",
        "name": "gpt-4o-mini",
        "mode": "chat",
        "completion_params": {"temperature": 0.2},
    }
    assert d["pre_prompt"] == "You are Iris."
    assert d["user_input_form"] == []


def test_feature_flags_come_from_app_model_config_when_present():
    # Q3: opener/follow-up/etc. live on app_model_config; model/prompt stay from Soul.
    fake_amc = SimpleNamespace(
        to_dict=lambda: {
            "opening_statement": "Hi, I'm Iris.",
            "suggested_questions_after_answer": {"enabled": True},
            "model": {"provider": "should-be-overridden", "name": "old"},
            "pre_prompt": "old prompt",
        }
    )
    d = AgentAppConfigManager._synthesize_config_dict(_soul(), fake_amc)  # type: ignore[arg-type]
    # feature flags preserved
    assert d["opening_statement"] == "Hi, I'm Iris."
    assert d["suggested_questions_after_answer"] == {"enabled": True}
    # model + prompt overridden by Soul (single source of truth)
    assert d["model"]["name"] == "gpt-4o-mini"
    assert d["pre_prompt"] == "You are Iris."


def test_missing_soul_model_leaves_no_model_key():
    d = AgentAppConfigManager._synthesize_config_dict(AgentSoulConfig(), None)
    assert "model" not in d
    assert d["pre_prompt"] == ""
