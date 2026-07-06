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
            "app_variables": [
                {"name": "topic", "type": "string", "required": True},
                {"name": "count", "type": "number", "default": 3},
            ],
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
    assert d["user_input_form"] == [
        {"text-input": {"label": "topic", "variable": "topic", "required": True}},
        {"number": {"label": "count", "variable": "count", "required": False, "default": 3}},
    ]


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
    assert d["file_upload"] == {
        "allowed_file_extensions": ["JPG", "JPEG", "PNG", "GIF", "WEBP", "SVG"],
        "allowed_file_types": ["document", "image", "audio", "video"],
        "allowed_file_upload_methods": ["local_file", "remote_url"],
        "enabled": True,
        "image": {"enabled": True},
        "number_limits": 3,
    }


def test_legacy_app_model_config_file_upload_takes_precedence():
    fake_amc = SimpleNamespace(
        to_dict=lambda: {
            "file_upload": {
                "enabled": False,
                "image": {"enabled": False},
            },
        }
    )

    d = AgentAppConfigManager._synthesize_config_dict(AgentSoulConfig(), fake_amc)  # type: ignore[arg-type]

    assert d["file_upload"] == {
        "enabled": False,
        "image": {"enabled": False},
    }


def test_prompt_type_defaults_to_simple():
    # PromptTemplateConfigManager.convert requires prompt_type; an Agent App with
    # no legacy app_model_config must still get the "simple" slot synthesized.
    d = AgentAppConfigManager._synthesize_config_dict(_soul(), None)
    assert d["prompt_type"] == "simple"


def test_get_app_config_has_null_model_config_id_without_legacy_row():
    # An Agent App has no app_model_config row; the conversation's
    # app_model_config_id (a UUID column) must be NULL, not "".
    app_model = SimpleNamespace(
        tenant_id="11111111-1111-1111-1111-111111111111",
        id="22222222-2222-2222-2222-222222222222",
        mode="agent",
    )
    app_config = AgentAppConfigManager.get_app_config(
        app_model=app_model,  # type: ignore[arg-type]
        agent_soul=_soul(),
        app_model_config=None,
        conversation=None,
    )
    assert app_config.app_model_config_id is None
