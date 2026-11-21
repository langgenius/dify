import json
from collections.abc import Callable
from types import SimpleNamespace

import httpx
import pytest
from pytest_mock import MockerFixture

from core.plugin.entities.request import PluginInvokeContext
from core.plugin.impl import base as client_module
from core.plugin.impl.agent import PluginAgentClient
from core.plugin.impl.exc import PluginDaemonInternalServerError

_Transformer = Callable[[dict[str, object]], dict[str, object]]


def test_fetch_agent_strategy_providers_preserves_daemon_error(monkeypatch: pytest.MonkeyPatch) -> None:
    """A valid list request with a daemon error envelope raises the typed daemon error."""

    def handle(request: httpx.Request) -> httpx.Response:
        """Return the daemon's error envelope for the agent strategy list request."""
        assert request.method == "GET"
        assert request.url.path == "/plugin/tenant-1/management/agent_strategies"
        message = json.dumps({"error_type": "PluginDaemonInternalServerError", "message": "Internal Server Error"})
        return httpx.Response(200, json={"code": -500, "message": message, "data": None})

    with httpx.Client(transport=httpx.MockTransport(handle)) as http_client:
        monkeypatch.setattr(client_module, "_httpx_client", http_client)
        with pytest.raises(PluginDaemonInternalServerError) as exc_info:
            PluginAgentClient().fetch_agent_strategy_providers("tenant-1")

    assert exc_info.value.description == "Internal Server Error"


@pytest.mark.parametrize("code", [0, "0"])
def test_fetch_agent_strategy_providers_normalizes_successful_payload(
    monkeypatch: pytest.MonkeyPatch, code: int | str
) -> None:
    """A successful envelope still supplies the strategy's provider before model validation."""
    label = {"en_US": "Example"}
    provider = {
        "provider": "example",
        "plugin_unique_identifier": "org/plugin:1.0.0",
        "plugin_id": "org/plugin",
        "meta": {"version": "1.0.0"},
        "declaration": {
            "identity": {"name": "example", "author": "org", "icon": "icon.svg", "label": label, "description": label},
            "strategies": [
                {"identity": {"name": "strategy", "author": "org", "label": label}, "description": label},
            ],
        },
    }

    def handle(_request: httpx.Request) -> httpx.Response:
        """Return one provider whose strategy needs the daemon response transformer."""
        return httpx.Response(200, json={"code": code, "message": "success", "data": [provider]})

    with httpx.Client(transport=httpx.MockTransport(handle)) as http_client:
        monkeypatch.setattr(client_module, "_httpx_client", http_client)
        result = PluginAgentClient().fetch_agent_strategy_providers("tenant-1")

    assert len(result) == 1
    assert result[0].declaration.identity.name == "org/plugin/example"
    assert result[0].declaration.strategies[0].identity.provider == "org/plugin/example"


def _agent_provider(name: str = "agent") -> SimpleNamespace:
    return SimpleNamespace(
        plugin_id="org/plugin",
        declaration=SimpleNamespace(
            identity=SimpleNamespace(name=name),
            strategies=[SimpleNamespace(identity=SimpleNamespace(provider=""))],
        ),
    )


class TestPluginAgentClient:
    def test_fetch_agent_strategy_providers(self, mocker: MockerFixture) -> None:
        client = PluginAgentClient()
        provider = _agent_provider("remote")

        def fake_request(
            method: str, path: str, type_: object, *, transformer: _Transformer, **kwargs: object
        ) -> list[SimpleNamespace]:
            payload: dict[str, object] = {
                "data": [
                    {
                        "declaration": {
                            "identity": {"name": "remote"},
                            "strategies": [{"identity": {"provider": "old"}}],
                        }
                    }
                ]
            }
            assert transformer(payload) == {
                "data": [
                    {
                        "declaration": {
                            "identity": {"name": "remote"},
                            "strategies": [{"identity": {"provider": "remote"}}],
                        }
                    }
                ]
            }
            return [provider]

        request_mock = mocker.patch.object(client, "_request_with_plugin_daemon_response", side_effect=fake_request)

        result = client.fetch_agent_strategy_providers("tenant-1")

        assert request_mock.call_count == 1
        assert result[0].declaration.identity.name == "org/plugin/remote"
        assert result[0].declaration.strategies[0].identity.provider == "org/plugin/remote"

    def test_fetch_agent_strategy_provider(self, mocker: MockerFixture) -> None:
        client = PluginAgentClient()
        provider = _agent_provider("provider")

        def fake_request(
            method: str, path: str, type_: object, *, transformer: _Transformer, **kwargs: object
        ) -> SimpleNamespace:
            skipped: dict[str, object] = {"data": None}
            assert transformer(skipped) == skipped
            payload: dict[str, object] = {"data": {"declaration": {"strategies": [{"identity": {"provider": "old"}}]}}}
            assert transformer(payload) == {
                "data": {"declaration": {"strategies": [{"identity": {"provider": "provider"}}]}}
            }
            return provider

        request_mock = mocker.patch.object(client, "_request_with_plugin_daemon_response", side_effect=fake_request)

        result = client.fetch_agent_strategy_provider("tenant-1", "org/plugin/provider")

        assert request_mock.call_count == 1
        assert result.declaration.identity.name == "org/plugin/provider"
        assert result.declaration.strategies[0].identity.provider == "org/plugin/provider"

    def test_invoke_merges_chunks_and_passes_context(self, mocker: MockerFixture) -> None:
        client = PluginAgentClient()
        stream_mock = mocker.patch.object(
            client, "_request_with_plugin_daemon_response_stream", return_value=iter(["raw"])
        )
        merge_mock = mocker.patch("core.plugin.impl.agent.merge_blob_chunks", return_value=["merged"])
        context = PluginInvokeContext()

        result = client.invoke(
            tenant_id="tenant-1",
            user_id="user-1",
            agent_provider="org/plugin/provider",
            agent_strategy="router",
            agent_params={"k": "v"},
            conversation_id="conv-1",
            app_id="app-1",
            message_id="msg-1",
            context=context,
        )

        assert result == ["merged"]
        assert merge_mock.call_count == 1
        payload = stream_mock.call_args.kwargs["data"]
        assert payload["data"]["agent_strategy_provider"] == "provider"
        assert payload["context"] == context.model_dump()
        assert stream_mock.call_args.kwargs["headers"]["X-Plugin-ID"] == "org/plugin"
