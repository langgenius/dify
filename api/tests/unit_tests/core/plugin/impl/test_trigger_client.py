from io import BytesIO
from types import SimpleNamespace

import pytest
from pytest_mock import MockerFixture
from werkzeug import Request

from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.impl.trigger import PluginTriggerClient
from core.trigger.entities.entities import Subscription
from models.provider_ids import TriggerProviderID


def _request() -> Request:
    environ = {
        "REQUEST_METHOD": "POST",
        "PATH_INFO": "/events",
        "QUERY_STRING": "",
        "SERVER_NAME": "localhost",
        "SERVER_PORT": "80",
        "wsgi.input": BytesIO(b"payload"),
        "wsgi.url_scheme": "http",
        "CONTENT_LENGTH": "7",
        "HTTP_HOST": "localhost",
    }
    return Request(environ)


def _subscription() -> Subscription:
    return Subscription(expires_at=123, endpoint="https://example.com/hook", parameters={"a": 1}, properties={"p": 1})


def _trigger_provider(name: str = "provider") -> SimpleNamespace:
    return SimpleNamespace(
        plugin_id="org/plugin",
        declaration=SimpleNamespace(
            identity=SimpleNamespace(name=name),
            events=[SimpleNamespace(identity=SimpleNamespace(provider=""))],
        ),
    )


def _subscription_call_kwargs(method_name: str) -> dict:
    if method_name == "subscribe":
        return {
            "tenant_id": "tenant-1",
            "user_id": "user-1",
            "provider": "org/plugin/provider",
            "credentials": {"token": "x"},
            "credential_type": CredentialType.API_KEY,
            "endpoint": "https://example.com/hook",
            "parameters": {"k": "v"},
        }

    return {
        "tenant_id": "tenant-1",
        "user_id": "user-1",
        "provider": "org/plugin/provider",
        "subscription": _subscription(),
        "credentials": {"token": "x"},
        "credential_type": CredentialType.API_KEY,
    }


class TestPluginTriggerClient:
    def test_fetch_trigger_providers(self, mocker: MockerFixture):
        client = PluginTriggerClient()
        provider = _trigger_provider("remote")

        def fake_request(*args, **kwargs):
            transformer = kwargs["transformer"]
            payload = {
                "data": [
                    {
                        "plugin_id": "org/plugin",
                        "provider": "remote",
                        "declaration": {"events": [{"identity": {"provider": "old"}}]},
                    }
                ]
            }
            transformed = transformer(payload)
            assert transformed["data"][0]["declaration"]["events"][0]["identity"]["provider"] == "org/plugin/remote"
            return [provider]

        request_mock = mocker.patch.object(client, "_request_with_plugin_daemon_response", side_effect=fake_request)

        result = client.fetch_trigger_providers("tenant-1")

        assert request_mock.call_count == 1
        assert result[0].declaration.identity.name == "org/plugin/remote"
        assert result[0].declaration.events[0].identity.provider == "org/plugin/remote"

    def test_fetch_trigger_provider(self, mocker: MockerFixture):
        client = PluginTriggerClient()
        provider = _trigger_provider("provider")

        def fake_request(*args, **kwargs):
            transformer = kwargs["transformer"]
            payload = {"data": {"declaration": {"events": [{"identity": {"provider": "old"}}]}}}
            transformed = transformer(payload)
            assert transformed["data"]["declaration"]["events"][0]["identity"]["provider"] == "org/plugin/provider"
            return provider

        request_mock = mocker.patch.object(client, "_request_with_plugin_daemon_response", side_effect=fake_request)

        result = client.fetch_trigger_provider("tenant-1", TriggerProviderID("org/plugin/provider"))

        assert request_mock.call_count == 1
        assert result.declaration.identity.name == "org/plugin/provider"
        assert result.declaration.events[0].identity.provider == "org/plugin/provider"

    def test_invoke_trigger_event(self, mocker: MockerFixture):
        client = PluginTriggerClient()
        stream_mock = mocker.patch.object(
            client,
            "_request_with_plugin_daemon_response_stream",
            return_value=iter([SimpleNamespace(variables={"ok": True}, cancelled=False)]),
        )

        result = client.invoke_trigger_event(
            tenant_id="tenant-1",
            user_id="user-1",
            provider="org/plugin/provider",
            event_name="created",
            credentials={"token": "x"},
            credential_type=CredentialType.API_KEY,
            request=_request(),
            parameters={"k": "v"},
            subscription=_subscription(),
            payload={"payload": 1},
        )

        assert result.variables == {"ok": True}
        assert stream_mock.call_count == 1

    def test_invoke_trigger_event_no_response_raises(self, mocker: MockerFixture):
        client = PluginTriggerClient()
        mocker.patch.object(client, "_request_with_plugin_daemon_response_stream", return_value=iter([]))

        with pytest.raises(ValueError, match="No response received from plugin daemon for invoke trigger"):
            client.invoke_trigger_event(
                tenant_id="tenant-1",
                user_id="user-1",
                provider="org/plugin/provider",
                event_name="created",
                credentials={"token": "x"},
                credential_type=CredentialType.API_KEY,
                request=_request(),
                parameters={"k": "v"},
                subscription=_subscription(),
                payload={"payload": 1},
            )

    def test_validate_provider_credentials(self, mocker: MockerFixture):
        client = PluginTriggerClient()
        stream_mock = mocker.patch.object(client, "_request_with_plugin_daemon_response_stream")

        stream_mock.return_value = iter([SimpleNamespace(result=True)])
        assert client.validate_provider_credentials("tenant-1", "user-1", "org/plugin/provider", {"k": "v"}) is True

        stream_mock.return_value = iter([])
        with pytest.raises(
            ValueError, match="No response received from plugin daemon for validate provider credentials"
        ):
            client.validate_provider_credentials("tenant-1", "user-1", "org/plugin/provider", {"k": "v"})

    def test_dispatch_event(self, mocker: MockerFixture):
        client = PluginTriggerClient()
        stream_mock = mocker.patch.object(
            client,
            "_request_with_plugin_daemon_response_stream",
            return_value=iter([SimpleNamespace(user_id="u", events=["e"])]),
        )

        result = client.dispatch_event(
            tenant_id="tenant-1",
            provider="org/plugin/provider",
            subscription={"id": "sub"},
            request=_request(),
            credentials={"token": "x"},
            credential_type=CredentialType.API_KEY,
        )

        assert result.user_id == "u"
        assert stream_mock.call_count == 1

        stream_mock.return_value = iter([])
        with pytest.raises(ValueError, match="No response received from plugin daemon for dispatch event"):
            client.dispatch_event(
                tenant_id="tenant-1",
                provider="org/plugin/provider",
                subscription={"id": "sub"},
                request=_request(),
                credentials={"token": "x"},
                credential_type=CredentialType.API_KEY,
            )

    @pytest.mark.parametrize("method_name", ["subscribe", "unsubscribe", "refresh"])
    def test_subscription_operations_success(self, mocker: MockerFixture, method_name):
        client = PluginTriggerClient()
        stream_mock = mocker.patch.object(
            client,
            "_request_with_plugin_daemon_response_stream",
            return_value=iter([SimpleNamespace(subscription={"id": "sub"})]),
        )

        method = getattr(client, method_name)
        result = method(**_subscription_call_kwargs(method_name))

        assert result.subscription == {"id": "sub"}
        assert stream_mock.call_count == 1

    @pytest.mark.parametrize(
        ("method_name", "expected"),
        [
            ("subscribe", "No response received from plugin daemon for subscribe"),
            ("unsubscribe", "No response received from plugin daemon for unsubscribe"),
            ("refresh", "No response received from plugin daemon for refresh"),
        ],
    )
    def test_subscription_operations_no_response(self, mocker: MockerFixture, method_name, expected):
        client = PluginTriggerClient()
        mocker.patch.object(client, "_request_with_plugin_daemon_response_stream", return_value=iter([]))
        method = getattr(client, method_name)

        with pytest.raises(ValueError, match=expected):
            method(**_subscription_call_kwargs(method_name))
