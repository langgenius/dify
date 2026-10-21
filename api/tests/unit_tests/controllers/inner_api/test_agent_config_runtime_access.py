"""Actual registered config routes preserve strict versus legacy admission."""

from unittest.mock import patch

import pytest
from flask import Flask

from controllers.inner_api import bp
from tests.unit_tests.config_override import config_overrides_context
from tests.unit_tests.controllers.inner_api.test_agent_runtime_lineage import encoded
from tests.unit_tests.services.dify_builder.test_agent_endpoint_lineage import owner
from tests.unit_tests.services.dify_builder.test_agent_operation_owner import envelope


@pytest.fixture
def app():
    application = Flask(__name__)
    application.config["TESTING"] = True
    application.register_blueprint(bp)
    return application


def test_legacy_config_route_refuses_native_header_before_read(app):
    with (
        config_overrides_context(PLUGIN_DAEMON_KEY="daemon", INNER_API_KEY_FOR_PLUGIN="plugin"),
        patch("controllers.console.wraps._is_setup_completed", return_value=True),
        patch("controllers.inner_api.plugin.agent_config.AgentConfigService") as service,
    ):
        response = app.test_client().get(
            "/inner/api/agent-config/a/manifest?tenant_id=t&user_id=u&config_version_id=s&config_version_kind=snapshot",
            headers={"X-Inner-Api-Key": "plugin", "X-Dify-Agent-Dispatch": encoded(envelope())},
        )
    assert response.status_code == 409
    service.assert_not_called()


def test_confirmed_config_route_validates_read_before_existing_service(app):
    lineage, _, transport, _ = owner()
    original = lineage.backend.read_run_identity_sync
    lineage.backend.read_run_identity_sync = lambda *args: original(*args).model_copy(
        update={"native_test_profile": "confirmed"}
    )
    app.extensions["native_agent_endpoint_lineage"] = lineage
    wire = envelope().model_copy(update={"ref": transport.parent_node.ref})
    headers = {
        "Authorization": "Bearer agent",
        "X-Dify-Agent-Run": encoded(transport),
        "X-Dify-Agent-Dispatch": encoded(wire),
    }
    with (
        config_overrides_context(
            AGENT_BACKEND_API_TOKEN="agent", PLUGIN_DAEMON_KEY="daemon", INNER_API_KEY_FOR_PLUGIN="plugin"
        ),
        patch("controllers.console.wraps._is_setup_completed", return_value=True),
        patch("controllers.inner_api.plugin.agent_config._authorize_runtime_config_read") as authorize,
        patch("controllers.inner_api.plugin.agent_config.AgentConfigService") as service,
    ):
        service.return_value.manifest.return_value = {"ok": True}
        response = app.test_client().get(
            "/inner/api/agent/runtime/config/a/manifest?tenant_id=tenant&user_id=actor&config_version_id=s&config_version_kind=snapshot",
            headers=headers,
        )
    assert response.status_code == 200
    authorize.assert_called_once()
    service.return_value.manifest.assert_called_once()


def test_config_mutation_stays_closed_for_confirmed_runtime(app):
    lineage, _, transport, _ = owner()
    original = lineage.backend.read_run_identity_sync
    lineage.backend.read_run_identity_sync = lambda *args: original(*args).model_copy(
        update={"native_test_profile": "confirmed"}
    )
    app.extensions["native_agent_endpoint_lineage"] = lineage
    headers = {
        "Authorization": "Bearer agent",
        "X-Dify-Agent-Run": encoded(transport),
        "X-Dify-Agent-Dispatch": encoded(envelope()),
    }
    with (
        config_overrides_context(
            AGENT_BACKEND_API_TOKEN="agent", PLUGIN_DAEMON_KEY="daemon", INNER_API_KEY_FOR_PLUGIN="plugin"
        ),
        patch(
            "controllers.inner_api.plugin.agent_config.AgentConfigService",
            side_effect=AssertionError("write must not start"),
        ),
    ):
        response = app.test_client().post("/inner/api/agent/runtime/config/a/push", headers=headers, json={})
    assert response.status_code == 409
