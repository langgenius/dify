"""Exercise real protocol encoding so artifact pins cannot silently fall back to installed versions."""

import json
from collections.abc import Callable, Generator
from contextlib import closing, contextmanager
from unittest.mock import patch

import httpx
import pytest
from typing_extensions import TypedDict
from werkzeug import Request
from werkzeug.test import EnvironBuilder

from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.impl.oauth import OAuthHandler
from core.plugin.impl.tool import PluginToolManager

ARTIFACT = "org/plugin:1.0.0@" + "a" * 64


@contextmanager
def daemon(handler: Callable[[httpx.Request], httpx.Response]) -> Generator[None]:
    with (
        httpx.Client(transport=httpx.MockTransport(handler)) as client,
        patch("core.plugin.impl.base._httpx_client", client),
    ):
        yield


class OAuthArguments(TypedDict, closed=True):
    tenant_id: str
    user_id: str
    plugin_id: str
    plugin_unique_identifier: str
    provider: str
    redirect_uri: str
    system_credentials: dict[str, str]


@pytest.mark.parametrize("operation", ["get_authorization_url", "get_credentials", "refresh_credentials"])
def test_oauth_protocol_routes_only_to_the_requested_artifact(operation: str) -> None:
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        payload = (
            {"authorization_url": "https://example.com/auth?state=test"}
            if operation == "get_authorization_url"
            else {"credentials": {"access_token": "token"}, "expires_at": 0}
        )
        return httpx.Response(200, text="data: " + json.dumps({"code": 0, "message": "", "data": payload}) + "\n\n")

    handler = OAuthHandler()
    kwargs: OAuthArguments = {
        "tenant_id": "tenant-1",
        "user_id": "user-1",
        "plugin_id": "org/plugin",
        "plugin_unique_identifier": ARTIFACT,
        "provider": "provider",
        "redirect_uri": "https://example.com/callback",
        "system_credentials": {"client_secret": "original-secret"},
    }
    with daemon(respond):
        if operation == "get_authorization_url":
            handler.get_authorization_url(**kwargs)
        elif operation == "get_credentials":
            with closing(EnvironBuilder(path="/callback", query_string="code=code&state=test")) as builder:
                handler.get_credentials(**kwargs, request=Request(builder.get_environ()))
        else:
            handler.refresh_credentials(**kwargs, credentials={"refresh_token": "refresh-secret"})
    assert len(requests) == 1
    request = requests[0]
    assert request.url.path == f"/plugin/tenant-1/dispatch/oauth/{operation}"
    assert request.headers["X-Plugin-Unique-Identifier"] == ARTIFACT
    assert request.headers["X-Plugin-ID"] == "org/plugin"
    payload = json.loads(request.content)
    assert payload["data"]["system_credentials"] == {"client_secret": "original-secret"}


def test_unavailable_artifact_never_falls_back_to_installation_dispatch() -> None:
    requests: list[httpx.Request] = []

    def unavailable(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(404)

    with daemon(unavailable), pytest.raises(ValueError, match="Error getting authorization URL"):
        OAuthHandler(plugin_unique_identifier=ARTIFACT).get_authorization_url(
            tenant_id="tenant-1",
            user_id="user-1",
            plugin_id="org/plugin",
            provider="provider",
            redirect_uri="https://example.com/callback",
            system_credentials={"client_secret": "secret"},
        )
    assert len(requests) == 1
    assert requests[0].url.path == "/plugin/tenant-1/dispatch/oauth/get_authorization_url"


@pytest.mark.parametrize("operation", ["invoke", "get_runtime_parameters"])
def test_personal_tool_operations_pin_the_admitted_artifact(operation: str) -> None:
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        body = (
            'data: {"code":0,"message":"","data":{"parameters":[]}}\n\n'
            if operation == "get_runtime_parameters"
            else ""
        )
        return httpx.Response(200, text=body)

    manager = PluginToolManager(plugin_unique_identifier=ARTIFACT)
    with daemon(respond):
        if operation == "invoke":
            list(
                manager.invoke(
                    tenant_id="tenant-1",
                    user_id="user-1",
                    tool_provider="org/plugin/provider",
                    tool_name="read",
                    credentials={"api_key": "secret"},
                    credential_type=CredentialType.API_KEY,
                    tool_parameters={},
                )
            )
        else:
            assert (
                manager.get_runtime_parameters(
                    tenant_id="tenant-1",
                    user_id="user-1",
                    provider="org/plugin/provider",
                    tool="read",
                    credentials={"api_key": "secret"},
                )
                == []
            )
    assert len(requests) == 1
    assert requests[0].url.path == f"/plugin/tenant-1/dispatch/tool/{operation}"
    assert requests[0].headers["X-Plugin-Unique-Identifier"] == ARTIFACT
    assert requests[0].headers["X-Plugin-ID"] == "org/plugin"


@pytest.mark.parametrize("identifier", ["org/plugin:1.0", "org/plugin:1.0@bad", "../other:1.0@" + "a" * 64])
def test_incomplete_artifact_references_are_rejected_before_dispatch(identifier: str) -> None:
    from clients.plugin.identifiers import plugin_id_from_unique_identifier

    with pytest.raises(ValueError, match="complete plugin artifact"):
        plugin_id_from_unique_identifier(identifier)
