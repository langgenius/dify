from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from controllers.common.agent_app_parameters import get_published_agent_app_feature_dict_and_user_input_form
from core.app.app_config.common.parameters_mapping import get_parameters_from_feature_dict
from core.app.apps.agent_app.errors import AgentAppGeneratorError, AgentAppNotPublishedError


def _app_model(*, bound_agent_id: str | None, app_model_config=None):
    return SimpleNamespace(
        id="app-1",
        tenant_id="tenant-1",
        bound_agent_id=bound_agent_id,
        app_model_config_with_session=lambda *, session: app_model_config,
    )


def test_published_agent_app_parameters_use_soul_file_upload():
    app_model_config = SimpleNamespace(
        to_dict=lambda **_kwargs: {
            "opening_statement": "Hi from legacy presentation config",
            "file_upload": {
                "enabled": False,
                "image": {"enabled": False},
            },
        }
    )
    app_model = _app_model(bound_agent_id="agent-1", app_model_config=app_model_config)
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
    session = MagicMock()
    session.scalar.side_effect = [agent, snapshot, None]

    features_dict, user_input_form = get_published_agent_app_feature_dict_and_user_input_form(
        app_model,
        session=session,
    )
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
    app_model = _app_model(bound_agent_id=None)

    with pytest.raises(AgentAppGeneratorError, match="no bound Agent"):
        get_published_agent_app_feature_dict_and_user_input_form(app_model, session=MagicMock())


def test_published_agent_app_parameters_requires_existing_active_agent():
    app_model = _app_model(bound_agent_id="agent-1")
    session = MagicMock()
    session.scalar.return_value = None

    with pytest.raises(AgentAppGeneratorError, match="no bound Agent"):
        get_published_agent_app_feature_dict_and_user_input_form(app_model, session=session)


@pytest.mark.parametrize(
    "active_config_is_published",
    [
        True,
        False,
    ],
)
def test_published_agent_app_parameters_requires_published_agent(active_config_is_published):
    app_model = _app_model(bound_agent_id="agent-1")
    agent = SimpleNamespace(
        id="agent-1",
        active_config_snapshot_id=None,
        active_config_is_published=active_config_is_published,
    )
    session = MagicMock()
    session.scalar.return_value = agent

    with pytest.raises(AgentAppNotPublishedError, match="not been published"):
        get_published_agent_app_feature_dict_and_user_input_form(app_model, session=session)


def test_published_agent_app_parameters_allows_unpublished_draft_with_active_snapshot():
    app_model = _app_model(bound_agent_id="agent-1")
    agent = SimpleNamespace(
        id="agent-1",
        active_config_snapshot_id="snapshot-1",
        active_config_is_published=False,
    )
    snapshot = SimpleNamespace(config_snapshot_dict={})
    session = MagicMock()
    session.scalar.side_effect = [agent, snapshot]

    features_dict, user_input_form = get_published_agent_app_feature_dict_and_user_input_form(
        app_model,
        session=session,
    )

    assert features_dict["file_upload"]["enabled"] is True
    assert user_input_form == []


def test_published_agent_app_parameters_requires_published_snapshot():
    app_model = _app_model(bound_agent_id="agent-1")
    agent = SimpleNamespace(
        id="agent-1",
        active_config_snapshot_id="snapshot-1",
        active_config_is_published=True,
    )
    session = MagicMock()
    session.scalar.side_effect = [agent, None]

    with pytest.raises(AgentAppGeneratorError, match="published version not found"):
        get_published_agent_app_feature_dict_and_user_input_form(app_model, session=session)


def test_published_agent_app_parameters_allows_missing_legacy_app_model_config():
    app_model = _app_model(bound_agent_id="agent-1")
    agent = SimpleNamespace(
        id="agent-1",
        active_config_snapshot_id="snapshot-1",
        active_config_is_published=True,
    )
    snapshot = SimpleNamespace(config_snapshot_dict={})
    session = MagicMock()
    session.scalar.side_effect = [agent, snapshot]

    features_dict, user_input_form = get_published_agent_app_feature_dict_and_user_input_form(
        app_model,
        session=session,
    )

    assert features_dict["file_upload"] == {
        "allowed_file_extensions": ["JPG", "JPEG", "PNG", "GIF", "WEBP", "SVG"],
        "allowed_file_types": ["document", "image", "audio", "video"],
        "allowed_file_upload_methods": ["local_file", "remote_url"],
        "enabled": True,
        "image": {"enabled": True},
        "number_limits": 3,
    }
    assert user_input_form == []
