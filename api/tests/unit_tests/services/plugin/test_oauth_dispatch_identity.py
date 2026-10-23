"""OAuth and credential transports preserve the prepared plugin package."""

import json

import httpx
import pytest
from werkzeug import Request

from core.plugin.impl import base as client_module
from core.plugin.impl.datasource import PluginDatasourceManager
from core.plugin.impl.dynamic_select import DynamicSelectClient
from core.plugin.impl.oauth import OAuthHandler
from services.plugin.oauth_service import OAuthProxyService

PLUGIN_ID = "langgenius/example"
IDENTIFIER = f"{PLUGIN_ID}:1.0.0@{'a' * 32}"


@pytest.mark.parametrize("operation", ["authorize", "callback", "refresh", "dynamic", "validate"])
def test_dispatch_transports_preserve_package_and_credentials(monkeypatch: pytest.MonkeyPatch, operation: str) -> None:
    requests: list[httpx.Request] = []
    credentials = {"client_secret": "test-secret"}

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.method == "POST"
        data: dict[str, object]
        if operation == "authorize":
            data = {"authorization_url": "https://example.com/authorize"}
        elif operation == "dynamic":
            data = {"options": []}
        elif operation == "validate":
            data = {"result": True}
        else:
            data = {"credentials": {"access_token": "test-token"}, "expires_at": -1}
        return httpx.Response(200, text="data: " + json.dumps({"code": 0, "message": "", "data": data}))

    with httpx.Client(transport=httpx.MockTransport(handle)) as client:
        monkeypatch.setattr(client_module, "_httpx_client", client)
        handler = OAuthHandler()
        if operation == "authorize":
            handler.get_authorization_url(
                "tenant",
                "user",
                PLUGIN_ID,
                "example",
                "https://example.com/callback",
                credentials,
                plugin_unique_identifier=IDENTIFIER,
            )
        elif operation == "callback":
            handler.get_credentials(
                "tenant",
                "user",
                PLUGIN_ID,
                "example",
                "https://example.com/callback",
                credentials,
                Request.from_values("/callback?code=test-code"),
                plugin_unique_identifier=IDENTIFIER,
            )
        elif operation == "refresh":
            handler.refresh_credentials(
                "tenant",
                "user",
                PLUGIN_ID,
                "example",
                "https://example.com/callback",
                credentials,
                {"refresh_token": "test-refresh"},
                plugin_unique_identifier=IDENTIFIER,
            )
        elif operation == "dynamic":
            DynamicSelectClient().fetch_dynamic_select_options(
                "tenant",
                "user",
                PLUGIN_ID,
                f"{PLUGIN_ID}/example",
                "fetch",
                credentials,
                "api-key",
                "option",
                plugin_unique_identifier=IDENTIFIER,
            )
        else:
            assert PluginDatasourceManager().validate_provider_credentials(
                "tenant", "user", "example", PLUGIN_ID, credentials, plugin_unique_identifier=IDENTIFIER
            )

    assert len(requests) == 1
    assert requests[0].headers["X-Plugin-ID"] == PLUGIN_ID
    assert requests[0].headers["X-Plugin-Unique-Identifier"] == IDENTIFIER
    payload = json.loads(requests[0].content)["data"]
    key = "credentials" if operation in ("dynamic", "validate") else "system_credentials"
    assert payload[key] == credentials


@pytest.mark.parametrize("expected_identifier", [None, IDENTIFIER])
def test_oauth_context_accepts_matching_provider_and_legacy_context(expected_identifier: str | None) -> None:
    context = {"plugin_id": PLUGIN_ID, "provider": "example", "plugin_unique_identifier": expected_identifier}
    OAuthProxyService.validate_plugin_context(
        context, plugin_id=PLUGIN_ID, provider="example", plugin_unique_identifier=IDENTIFIER
    )


@pytest.mark.parametrize(
    ("plugin_id", "provider", "identifier"),
    [
        ("langgenius/other", "example", IDENTIFIER),
        (PLUGIN_ID, "other", IDENTIFIER),
        (PLUGIN_ID, "example", f"{PLUGIN_ID}:2.0.0@{'b' * 32}"),
    ],
)
def test_oauth_context_rejects_provider_or_package_changes(plugin_id: str, provider: str, identifier: str) -> None:
    with pytest.raises(ValueError, match="another provider|Plugin changed"):
        OAuthProxyService.validate_plugin_context(
            {"plugin_id": PLUGIN_ID, "provider": "example", "plugin_unique_identifier": IDENTIFIER},
            plugin_id=plugin_id,
            provider=provider,
            plugin_unique_identifier=identifier,
        )
