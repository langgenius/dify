"""Unit tests for app payload-rendering helpers — independent of
HTTP plumbing or DB. Pin the response shapes that are CLI contracts.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from controllers.openapi.apps import (  # pyright: ignore[reportPrivateUsage]
    _EMPTY_PARAMETERS,
    _is_listable,
    parameters_payload,
)
from controllers.service_api.app.error import AppUnavailableError
from models.model import AppMode


def _fake_app(**overrides):
    base = {
        "id": "app1",
        "name": "X",
        "description": "d",
        "mode": "chat",
        "author_name": "alice",
        "tags": [SimpleNamespace(name="prod")],
        "updated_at": None,
        "enable_api": True,
        "workflow": None,
        "app_model_config": None,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def test_parameters_payload_raises_app_unavailable_when_no_config():
    with pytest.raises(AppUnavailableError):
        parameters_payload(_fake_app(mode="chat", app_model_config=None))


def test_empty_parameters_constant_matches_describe_fallback_shape():
    """The fallback dict served by /describe when an app has no config
    must match the spec's stated keys (opening_statement, suggested_questions,
    user_input_form, file_upload, system_parameters)."""
    assert set(_EMPTY_PARAMETERS.keys()) == {
        "opening_statement",
        "suggested_questions",
        "user_input_form",
        "file_upload",
        "system_parameters",
    }
    assert _EMPTY_PARAMETERS["suggested_questions"] == []
    assert _EMPTY_PARAMETERS["user_input_form"] == []
    assert _EMPTY_PARAMETERS["opening_statement"] is None
    assert _EMPTY_PARAMETERS["file_upload"] is None
    assert _EMPTY_PARAMETERS["system_parameters"] == {}


@pytest.mark.parametrize(
    "mode",
    [AppMode.COMPLETION, AppMode.CHAT, AppMode.ADVANCED_CHAT, AppMode.WORKFLOW, AppMode.AGENT_CHAT],
)
def test_is_listable_accepts_supported_app_types(mode):
    assert _is_listable(_fake_app(mode=mode)) is True


@pytest.mark.parametrize("mode", [AppMode.AGENT, AppMode.CHANNEL, AppMode.RAG_PIPELINE])
def test_is_listable_hides_non_app_modes(mode):
    assert _is_listable(_fake_app(mode=mode)) is False
