from types import SimpleNamespace

import pytest

from controllers.common import agent_app_parameters
from controllers.common.agent_app_parameters import get_published_agent_app_feature_dict_and_user_input_form
from core.app.app_config.common.parameters_mapping import get_parameters_from_feature_dict
from core.app.apps.agent_app.errors import AgentAppGeneratorError, AgentAppNotPublishedError


def test_published_agent_app_parameters_use_soul_file_upload(monkeypatch):
    app_model_config = SimpleNamespace(
        to_dict=lambda: {
            "opening_statement": "Hi from legacy presentation config",
            "file_upload": {
                "enabled": False,
                "image": {"enabled": False},
            },
        }
    )
    app_model = SimpleNamespace(
        tenant_id="tenant-1",
        bound_agent_id="agent-1",
        app_model_config=app_model_config,
    )
    agent = SimpleNamespace(
        id="agent-1",
        active_config_snapshot_id="snapshot-1",
        active_config_is_published=True,
    )
    snapshot = SimpleNamespace(
        config_snapshot_dict={
            "app_features": {
                "file_upload": {
                    "enabled": True,
                    "allowed_file_extensions": ["PNG"],
                    "allowed_file_types": ["image"],
                    "allowed_file_upload_methods": ["local_file"],
                    "image": {"enabled": True},
                    "number_limits": 2,
                }
            },
            "app_variables": [{"name": "topic", "type": "string", "required": True}],
        }
    )
    query_results = iter([agent, snapshot])
    monkeypatch.setattr(agent_app_parameters.db.session, "scalar", lambda _: next(query_results))

    features_dict, user_input_form = get_published_agent_app_feature_dict_and_user_input_form(app_model)
    parameters = get_parameters_from_feature_dict(features_dict=features_dict, user_input_form=user_input_form)

    assert parameters["opening_statement"] == "Hi from legacy presentation config"
    assert parameters["file_upload"] == {
        "enabled": True,
        "allowed_file_extensions": ["PNG"],
        "allowed_file_types": ["image"],
        "allowed_file_upload_methods": ["local_file"],
        "image": {"enabled": True},
        "number_limits": 2,
    }
    assert parameters["user_input_form"] == [{"text-input": {"label": "topic", "variable": "topic", "required": True}}]


def test_published_agent_app_parameters_requires_bound_agent():
    app_model = SimpleNamespace(
        tenant_id="tenant-1",
        bound_agent_id=None,
        app_model_config=None,
    )

    with pytest.raises(AgentAppGeneratorError, match="no bound Agent"):
        get_published_agent_app_feature_dict_and_user_input_form(app_model)


def test_published_agent_app_parameters_requires_existing_active_agent(monkeypatch):
    app_model = SimpleNamespace(
        tenant_id="tenant-1",
        bound_agent_id="agent-1",
        app_model_config=None,
    )
    monkeypatch.setattr(agent_app_parameters.db.session, "scalar", lambda _: None)

    with pytest.raises(AgentAppGeneratorError, match="no bound Agent"):
        get_published_agent_app_feature_dict_and_user_input_form(app_model)


@pytest.mark.parametrize(
    ("active_config_snapshot_id", "active_config_is_published"),
    [
        (None, True),
        ("snapshot-1", False),
    ],
)
def test_published_agent_app_parameters_requires_published_agent(
    monkeypatch, active_config_snapshot_id, active_config_is_published
):
    app_model = SimpleNamespace(
        tenant_id="tenant-1",
        bound_agent_id="agent-1",
        app_model_config=None,
    )
    agent = SimpleNamespace(
        id="agent-1",
        active_config_snapshot_id=active_config_snapshot_id,
        active_config_is_published=active_config_is_published,
    )
    monkeypatch.setattr(agent_app_parameters.db.session, "scalar", lambda _: agent)

    with pytest.raises(AgentAppNotPublishedError, match="not been published"):
        get_published_agent_app_feature_dict_and_user_input_form(app_model)


def test_published_agent_app_parameters_requires_published_snapshot(monkeypatch):
    app_model = SimpleNamespace(
        tenant_id="tenant-1",
        bound_agent_id="agent-1",
        app_model_config=None,
    )
    agent = SimpleNamespace(
        id="agent-1",
        active_config_snapshot_id="snapshot-1",
        active_config_is_published=True,
    )
    query_results = iter([agent, None])
    monkeypatch.setattr(agent_app_parameters.db.session, "scalar", lambda _: next(query_results))

    with pytest.raises(AgentAppGeneratorError, match="published version not found"):
        get_published_agent_app_feature_dict_and_user_input_form(app_model)


def test_published_agent_app_parameters_allows_missing_legacy_app_model_config(monkeypatch):
    app_model = SimpleNamespace(
        tenant_id="tenant-1",
        bound_agent_id="agent-1",
        app_model_config=None,
    )
    agent = SimpleNamespace(
        id="agent-1",
        active_config_snapshot_id="snapshot-1",
        active_config_is_published=True,
    )
    snapshot = SimpleNamespace(config_snapshot_dict={})
    query_results = iter([agent, snapshot])
    monkeypatch.setattr(agent_app_parameters.db.session, "scalar", lambda _: next(query_results))

    features_dict, user_input_form = get_published_agent_app_feature_dict_and_user_input_form(app_model)

    assert features_dict["file_upload"] == {
        "allowed_file_extensions": ["JPG", "JPEG", "PNG", "GIF", "WEBP", "SVG"],
        "allowed_file_types": ["document", "image", "audio", "video"],
        "allowed_file_upload_methods": ["local_file", "remote_url"],
        "enabled": True,
        "image": {"enabled": True},
        "number_limits": 3,
    }
    assert user_input_form == []
