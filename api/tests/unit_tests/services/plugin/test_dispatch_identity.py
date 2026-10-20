"""Dispatch identity remains bound to the caller across installation changes."""

import json
from unittest.mock import Mock

import httpx
import pytest

from core.plugin.impl import base as plugin_client_module
from core.plugin.impl.base import BasePluginClient
from core.plugin.plugin_service import PluginService
from services.plugin.dispatch_identity import PLUGIN_IDENTIFIER_HEADER, prepare_dispatch_identity

PLUGIN_ID = "langgenius/example"
IDENTIFIER = f"{PLUGIN_ID}:1.0.0@{'a' * 32}"


@pytest.mark.parametrize("stream", [False, True])
def test_dispatch_keeps_declared_version_without_refetch_or_invalidation(
    monkeypatch: pytest.MonkeyPatch, stream: bool
) -> None:
    lookup = Mock(side_effect=AssertionError("Pinned calls must not resolve the current installation"))
    invalidate = Mock(side_effect=AssertionError("Dispatch must not invalidate configuration"))
    monkeypatch.setattr(PluginService, "list_installations_from_ids", lookup)
    monkeypatch.setattr(PluginService, "invalidate_plugin_model_providers_cache", invalidate)
    requests: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, text='data: {"code": 0, "message": "", "data": true}\n')

    with httpx.Client(transport=httpx.MockTransport(handle)) as http_client:
        monkeypatch.setattr(plugin_client_module, "_httpx_client", http_client)
        client = BasePluginClient(plugin_unique_identifier=IDENTIFIER)
        path = "plugin/tenant-a/dispatch/tool/invoke"
        headers = {"X-Plugin-ID": PLUGIN_ID, "Content-Type": "application/json"}
        data = {"data": {"credentials": {"api_key": "secret"}}}
        if stream:
            assert len(list(client._stream_request("POST", path, headers=headers, data=data))) == 1
        else:
            assert client._request("POST", path, headers=headers, data=data).status_code == 200

    assert len(requests) == 1
    assert requests[0].headers["X-Plugin-ID"] == PLUGIN_ID
    assert requests[0].headers[PLUGIN_IDENTIFIER_HEADER] == IDENTIFIER
    assert json.loads(requests[0].content)["data"]["credentials"] == {"api_key": "secret"}
    lookup.assert_not_called()
    invalidate.assert_not_called()


def test_unbound_dispatch_keeps_legacy_headers_without_refetch(monkeypatch: pytest.MonkeyPatch) -> None:
    lookup = Mock(side_effect=AssertionError("Legacy calls must let the daemon resolve installation"))
    monkeypatch.setattr(PluginService, "list_installations_from_ids", lookup)
    headers = {"X-Plugin-ID": PLUGIN_ID}

    prepare_dispatch_identity("plugin/tenant-a/dispatch/oauth/get_credentials", headers, None)

    lookup.assert_not_called()
    assert headers == {"X-Plugin-ID": PLUGIN_ID}


def test_dispatch_rejects_cross_plugin_identity() -> None:
    with pytest.raises(ValueError, match="does not match"):
        prepare_dispatch_identity(
            "plugin/tenant-a/dispatch/tool/invoke", {"X-Plugin-ID": "langgenius/other"}, IDENTIFIER
        )
