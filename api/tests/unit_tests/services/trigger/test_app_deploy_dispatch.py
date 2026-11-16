"""Enterprise admission preserves dispatch identity and isolates target/results."""

from types import SimpleNamespace
from unittest.mock import Mock

import httpx
import pytest
from celery import Celery
from celery.exceptions import Retry
from kombu.exceptions import OperationalError

from core.plugin.entities.request import TriggerInvokeEventResponse
from services.errors.enterprise import EnterpriseAPIError, EnterpriseAPINotFoundError
from services.trigger import app_deploy_dispatch as service
from services.workflow.entities import PluginTriggerDispatchData
from tasks import app_deploy_trigger_tasks as tasks


@pytest.fixture
def payload():
    return {
        "user_id": "untrusted-user",
        "tenant_id": "tenant",
        "endpoint_id": "endpoint",
        "provider_id": "provider",
        "subscription_id": "subscription",
        "timestamp": 123,
        "events": ["push", "push"],
        "request_id": "trigger_request_123_abcdef012345",
    }


@pytest.fixture
def target():
    return {
        "trigger_id": "trigger",
        "revision_id": "revision",
        "event_key": "event-key",
        "node": {
            "type": "trigger-plugin",
            "title": "hook",
            "plugin_id": "plugin",
            "provider_id": "provider",
            "event_name": "push",
            "subscription_id": "subscription",
            "plugin_unique_identifier": "plugin@old",
            "event_parameters": {"filter": {"type": "constant", "value": "deployed"}},
            "future_dsl_field": {"preserved": True},
        },
    }


def test_dispatch_fans_out_independent_targets(monkeypatch, payload, target):
    request = Mock(return_value={"data": [target, target | {"trigger_id": "second"}]})
    enqueue = Mock()
    monkeypatch.setattr(tasks, "enterprise_request", request)
    monkeypatch.setattr(tasks.invoke_deployed_trigger, "delay", enqueue)
    tasks.dispatch_deployed_triggers.run(payload)
    request.assert_called_once_with("/app-deploy/triggers/plugin/targets", payload)
    assert [call.args[1]["trigger_id"] for call in enqueue.call_args_list] == ["trigger", "second"]
    assert enqueue.call_args_list[0].args[1]["node"] == target["node"]


@pytest.mark.parametrize("failure", [False, True])
def test_target_submits_variables_or_error_independently(monkeypatch, payload, target, failure):
    invoke = Mock(return_value={"variables": {"count": 17}, "cancelled": False})
    if failure:
        invoke.side_effect = ValueError("plugin failed")
    enqueue = Mock()
    monkeypatch.setattr(tasks, "invoke_target", invoke)
    monkeypatch.setattr(tasks.submit_deployed_trigger_result, "delay", enqueue)
    tasks.invoke_deployed_trigger.run(payload, target)
    result = enqueue.call_args.args[0]
    assert result["trigger_id"] == "trigger"
    assert result["event_key"] == "event-key"
    assert "node" not in result
    if failure:
        assert result["error"] == "plugin failed"
        assert "variables" not in result
    else:
        assert result["variables"] == {"count": 17}
        assert "error" not in result


def test_current_plugin_version_and_subscription_owner_are_used(monkeypatch, payload, target):
    subscription = SimpleNamespace(provider_id="provider", user_id="owner")
    triggers = SimpleNamespace(subscriptions=Mock(), events=Mock())
    triggers.subscriptions.get_for_execution.return_value = subscription
    triggers.events.prepare.return_value = SimpleNamespace(
        definition=SimpleNamespace(plugin_unique_identifier="plugin@current")
    )
    triggers.events.invoke.return_value = TriggerInvokeEventResponse(variables={"ok": True})
    monkeypatch.setattr(service, "application_services", lambda: SimpleNamespace(triggers=triggers))
    result = service.invoke_target(PluginTriggerDispatchData.model_validate(payload), service.PluginTarget(**target))
    assert result["variables"] == {"ok": True}
    triggers.subscriptions.get_for_execution.assert_called_once_with(tenant_id="tenant", subscription_id="subscription")
    assert triggers.events.invoke.call_args.kwargs["user_id"] == "owner"
    assert triggers.events.invoke.call_args.kwargs["node_data"].event_parameters["filter"].value == "deployed"


def test_mismatched_identity_never_loads_credentials(monkeypatch, payload, target):
    load = Mock()
    monkeypatch.setattr(service, "application_services", load)
    target["node"]["subscription_id"] = "other"
    with pytest.raises(ValueError, match="does not match"):
        service.invoke_target(PluginTriggerDispatchData.model_validate(payload), service.PluginTarget(**target))
    load.assert_not_called()


@pytest.mark.parametrize("task", [tasks.dispatch_deployed_triggers, tasks.submit_deployed_trigger_result])
def test_missing_completes(monkeypatch, payload, task):
    monkeypatch.setattr(service.EnterpriseRequest, "send_request", Mock(side_effect=EnterpriseAPINotFoundError()))
    task.run(payload)


def test_result_conflict_requeries_original_dispatch(monkeypatch, payload):
    monkeypatch.setattr(tasks, "enterprise_request", Mock(side_effect=EnterpriseAPIError(status_code=409)))
    enqueue = Mock()
    monkeypatch.setattr(tasks.dispatch_deployed_triggers, "delay", enqueue)
    tasks.submit_deployed_trigger_result.run(payload | {"trigger_id": "trigger", "variables": {}})
    enqueue.assert_called_once_with(payload)


def test_admission_conflict_retries(monkeypatch, payload):
    monkeypatch.setattr(tasks, "enterprise_request", Mock(side_effect=EnterpriseAPIError(status_code=409)))
    with pytest.raises(service.RetryableDispatchError):
        tasks.dispatch_deployed_triggers.run(payload)


@pytest.mark.parametrize("status", [400, 401, 403, 500, 502, 503])
def test_server_errors_retry_and_client_errors_stop(monkeypatch, payload, status):
    monkeypatch.setattr(
        service.EnterpriseRequest, "send_request", Mock(side_effect=EnterpriseAPIError(status_code=status))
    )
    expected = service.RetryableDispatchError if status >= 500 else EnterpriseAPIError
    with pytest.raises(expected):
        tasks.submit_deployed_trigger_result.run(payload)


@pytest.mark.parametrize("base", ["http://enterprise", "http://enterprise/inner/api"])
@pytest.mark.parametrize("endpoint", ["targets", "results"])
def test_relative_path_preserves_helm_base_and_explicit_timeout(monkeypatch, payload, base, endpoint):
    requests = []

    def handle(request):
        requests.append(request)
        return httpx.Response(200, json={"data": []} if endpoint == "targets" else {})

    transport = httpx.MockTransport(handle)
    monkeypatch.setattr(service.EnterpriseRequest, "base_url", base)
    monkeypatch.setattr(service.EnterpriseRequest, "_build_mounts", lambda: {"http://": transport})
    if endpoint == "results":
        assert tasks.submit_deployed_trigger_result.run(payload) is None
    else:
        assert service.enterprise_request(f"/app-deploy/triggers/plugin/{endpoint}", payload) == {"data": []}
    assert str(requests[0].url) == f"{base}/app-deploy/triggers/plugin/{endpoint}"
    assert requests[0].extensions["timeout"] == {"connect": 30.0, "read": 30.0, "write": 30.0, "pool": 30.0}


def test_tasks_registered_with_late_ack_and_transport_retry():
    app = Celery("enterprise-plugin-registration", broker="memory://", set_as_current=False)
    try:
        app.loader.import_task_module("tasks.app_deploy_trigger_tasks")
        for name in ("dispatch_deployed_triggers", "invoke_deployed_trigger", "submit_deployed_trigger_result"):
            task = app.tasks[f"tasks.app_deploy_trigger_tasks.{name}"]
            assert task.acks_late is True
            assert task.reject_on_worker_lost is True
            assert task.queue == "triggered_workflow_dispatcher"
            assert task.autoretry_for == (service.RetryableDispatchError, httpx.TransportError, OperationalError)
            assert task.max_retries == 8
    finally:
        app.close()


def test_result_delivery_retries_same_result_without_reinvoking_plugin(monkeypatch, payload):
    result = payload | {"trigger_id": "trigger", "revision_id": "revision", "event_key": "event", "variables": {}}
    send = Mock(side_effect=[service.RetryableDispatchError("unavailable"), {"success": True}])
    invoke = Mock()
    monkeypatch.setattr(tasks, "enterprise_request", send)
    monkeypatch.setattr(tasks, "invoke_target", invoke)
    previous = tasks.submit_deployed_trigger_result.app
    app = Celery("result-retry", broker="memory://", set_as_current=False)
    app.set_current()
    try:
        signature = tasks.submit_deployed_trigger_result.signature(args=(result,))
        with pytest.raises(Retry) as raised:
            signature.apply(throw=True)
        assert raised.value.when == 30
        assert raised.value.sig.args == (result,)
        assert raised.value.sig.apply(throw=True).successful()
        assert send.call_count == 2
        invoke.assert_not_called()
    finally:
        previous.set_current()
        app.close()
