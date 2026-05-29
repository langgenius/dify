"""Unit tests for get_app_parameters — the per-app-type webapp parameters resolver.

Covers the four branches: workflow-backed apps, easy-UI apps with an
app_model_config, Agent Apps (no config, defaults), and the unavailable case.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from core.app.app_config.common.parameters_mapping import (
    AppParametersUnavailableError,
    get_app_parameters,
)
from models.model import AppMode


def test_agent_app_defaults_to_disabled_features():
    # An Agent App has no workflow and no app_model_config; every toggle defaults
    # to disabled and the input form is empty (free-form chat box).
    app_model = SimpleNamespace(mode=AppMode.AGENT, workflow=None, app_model_config=None)
    params = get_app_parameters(app_model)  # type: ignore[arg-type]

    assert params["opening_statement"] is None
    assert params["user_input_form"] == []
    assert params["suggested_questions_after_answer"] == {"enabled": False}
    assert params["file_upload"]["image"]["enabled"] is False


def test_easy_ui_app_reads_from_app_model_config():
    amc = SimpleNamespace(
        to_dict=lambda: {
            "opening_statement": "Hi there!",
            "user_input_form": [{"text-input": {"variable": "name"}}],
            "suggested_questions_after_answer": {"enabled": True},
        }
    )
    app_model = SimpleNamespace(mode=AppMode.CHAT, workflow=None, app_model_config=amc)
    params = get_app_parameters(app_model)  # type: ignore[arg-type]

    assert params["opening_statement"] == "Hi there!"
    assert params["user_input_form"] == [{"text-input": {"variable": "name"}}]
    assert params["suggested_questions_after_answer"] == {"enabled": True}


def test_workflow_app_reads_from_workflow():
    workflow = SimpleNamespace(
        features_dict={"opening_statement": "From workflow"},
        user_input_form=lambda to_old_structure: [{"paragraph": {"variable": "q"}}],
    )
    app_model = SimpleNamespace(mode=AppMode.ADVANCED_CHAT, workflow=workflow, app_model_config=None)
    params = get_app_parameters(app_model)  # type: ignore[arg-type]

    assert params["opening_statement"] == "From workflow"
    assert params["user_input_form"] == [{"paragraph": {"variable": "q"}}]


def test_workflow_app_without_workflow_is_unavailable():
    app_model = SimpleNamespace(mode=AppMode.WORKFLOW, workflow=None, app_model_config=None)
    with pytest.raises(AppParametersUnavailableError):
        get_app_parameters(app_model)  # type: ignore[arg-type]


def test_easy_ui_app_without_config_is_unavailable():
    # A chat app with no published config is genuinely unavailable (unlike Agent).
    app_model = SimpleNamespace(mode=AppMode.CHAT, workflow=None, app_model_config=None)
    with pytest.raises(AppParametersUnavailableError):
        get_app_parameters(app_model)  # type: ignore[arg-type]
