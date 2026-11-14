import inspect
from types import SimpleNamespace
from unittest.mock import Mock, patch

from flask import Flask

from controllers.inner_api.app.triggers import InvokeDeployedTrigger
from core.plugin.entities.request import TriggerInvokeEventResponse


def test_invoke_uses_subscription_identity_and_deployed_parameters():
    node = {
        "type": "trigger-plugin",
        "title": "hook",
        "plugin_id": "plugin",
        "provider_id": "provider",
        "event_name": "push",
        "subscription_id": "subscription",
        "plugin_unique_identifier": "plugin@1",
        "event_parameters": {"filter": {"type": "constant", "value": "deployed"}},
    }
    subscription = SimpleNamespace(provider_id="provider", user_id="owner")
    events = Mock()
    events.prepare.return_value = SimpleNamespace(definition=SimpleNamespace(plugin_unique_identifier="plugin@1"))
    events.invoke.return_value = TriggerInvokeEventResponse(variables={"count": 17})
    services = SimpleNamespace(triggers=SimpleNamespace(subscriptions=Mock(), events=events))
    services.triggers.subscriptions.get_for_execution.return_value = subscription
    app = Flask(__name__)
    with app.test_request_context(
        json={"tenant_id": "tenant", "request_id": "trigger_request_123_abcdef012345", "node": node}
    ):
        with patch("controllers.inner_api.app.triggers.application_services", return_value=services):
            result = inspect.unwrap(InvokeDeployedTrigger.post)(InvokeDeployedTrigger())
    assert result == {"variables": {"count": 17}, "cancelled": False}
    assert events.invoke.call_args.kwargs["user_id"] == "owner"
    assert events.invoke.call_args.kwargs["node_data"].event_parameters["filter"].value == "deployed"

    subscription.provider_id = "other"
    with app.test_request_context(
        json={"tenant_id": "tenant", "request_id": "trigger_request_123_abcdef012345", "node": node}
    ):
        with patch("controllers.inner_api.app.triggers.application_services", return_value=services):
            assert inspect.unwrap(InvokeDeployedTrigger.post)(InvokeDeployedTrigger())[1] == 404
