"""Unit tests for app payload-rendering helpers — independent of
HTTP plumbing or DB. Pin the response shapes that are CLI contracts.
"""

from __future__ import annotations

from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from controllers.openapi._models import AppDiscoveryQuery
from controllers.openapi.apps import (  # pyright: ignore[reportPrivateUsage]
    _EMPTY_PARAMETERS,
    AppDiscoveryApi,
    _is_listable,
    build_app_discovery_item,
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


def test_discovery_projects_legacy_agent_without_credentials_or_parameters():
    app = _fake_app(
        mode=AppMode.AGENT_CHAT,
        icon="🤖",
        icon_background="#fff",
        app_model_config_id="legacy-config",
    )
    legacy_config = SimpleNamespace(
        model_dict={"provider": "openai", "name": "gpt-4.1", "completion_params": {"temperature": 0.2}},
        agent_mode_dict={
            "strategy": "function_call",
            "tools": [
                {
                    "provider_id": "weather",
                    "provider_type": "api",
                    "plugin_unique_identifier": "acme/weather:1.0.0",
                    "tool_name": "forecast",
                    "credential_id": "credential-must-not-leak",
                    "tool_parameters": {"token": "must-not-leak"},
                }
            ],
        },
    )

    item = build_app_discovery_item(app, legacy_config=legacy_config, agent_snapshot=None)

    assert item.model is not None
    assert item.model.provider == "openai"
    assert item.model.name == "gpt-4.1"
    assert item.agent_strategy == "function_call"
    assert item.tools[0].provider_id == "weather"
    assert item.tools[0].tool_name == "forecast"
    assert "credential-must-not-leak" not in str(item.model_dump())
    assert "must-not-leak" not in str(item.model_dump())


def test_discovery_projects_agent_soul_without_credential_refs_or_runtime_parameters():
    app = _fake_app(mode=AppMode.AGENT, icon="🧭", icon_background="#000")
    snapshot = SimpleNamespace(
        config_snapshot_dict={
            "model": {
                "plugin_id": "langgenius/openai",
                "model_provider": "openai",
                "model": "gpt-4.1",
                "credential_ref": {"id": "model-credential-must-not-leak"},
            },
            "tools": {
                "dify_tools": [
                    {
                        "provider_id": "github",
                        "provider_type": "plugin",
                        "plugin_id": "langgenius/github",
                        "provider": "github",
                        "tool_name": "create_issue",
                        "enabled": True,
                        "credential_ref": {"id": "tool-credential-must-not-leak"},
                        "runtime_parameters": {"api_key": "must-not-leak"},
                    }
                ]
            },
        }
    )

    item = build_app_discovery_item(app, legacy_config=None, agent_snapshot=snapshot)

    assert item.model is not None
    assert item.model.plugin_id == "langgenius/openai"
    assert item.tools[0].plugin_id == "langgenius/github"
    assert item.tools[0].provider == "github"
    serialized = str(item.model_dump())
    assert "credential-must-not-leak" not in serialized
    assert "must-not-leak" not in serialized


def test_discovery_includes_api_disabled_apps_for_authenticated_workspace_management():
    """Discovery is intentionally broader than the Service API app list.

    A disabled Service API prevents app invocation but must not break trace to
    app correlation for an OAuth-authenticated workspace integration.
    """
    app = _fake_app(
        mode=AppMode.CHAT,
        enable_api=False,
        icon="🤖",
        icon_background="#fff",
        app_model_config_id=None,
    )
    pagination = SimpleNamespace(items=[app], total=1)
    auth_data = SimpleNamespace(account_id="account-1", caller_kind="account")

    with (
        patch("controllers.openapi.apps.dify_config.RBAC_ENABLED", False),
        patch("controllers.openapi.apps.AppService") as app_service,
        patch("controllers.openapi.apps._load_discovery_configuration", return_value=({}, {})),
    ):
        app_service.return_value.get_paginate_apps.return_value = pagination
        result = unwrap(AppDiscoveryApi.get)(
            AppDiscoveryApi(),
            auth_data=auth_data,
            query=AppDiscoveryQuery(workspace_id="00000000-0000-0000-0000-000000000001"),
        )

    assert result.total == 1
    assert result.data[0].id == "app1"
    call_params = app_service.return_value.get_paginate_apps.call_args.args[2]
    assert call_params.mode == "discovery"
    assert call_params.openapi_visible is False
