import json
from collections.abc import Callable

import httpx
import pytest
from flask import Flask
from flask_restx import Resource

from core.plugin.impl import base as client_module
from core.plugin.impl.exc import PluginDaemonInternalServerError
from core.plugin.impl.tool import PluginToolManager
from core.plugin.impl.trigger import PluginTriggerClient
from libs.external_api import ExternalApi


@pytest.mark.parametrize("kind", ["tools", "triggers"])
def test_list_daemon_error_reaches_api_error_handler(monkeypatch: pytest.MonkeyPatch, kind: str) -> None:
    tenant_id = "tenant-1"
    requested: list[tuple[str, str]] = []
    errors: list[PluginDaemonInternalServerError] = []
    fetch: Callable[[str], object] = (
        PluginToolManager().fetch_tool_providers if kind == "tools" else PluginTriggerClient().fetch_trigger_providers
    )

    def daemon_reply(request: httpx.Request) -> httpx.Response:
        requested.append((request.method, request.url.path))
        message = json.dumps({"error_type": "PluginDaemonInternalServerError", "message": "Internal Server Error"})
        return httpx.Response(200, json={"code": -500, "message": message, "data": None})

    app = Flask(__name__)
    app.config.update(TESTING=True, PROPAGATE_EXCEPTIONS=False)
    api = ExternalApi(app, register_default_root=False)

    @api.route("/provider-list")
    class ProviderList(Resource):
        def get(self) -> list[object]:
            try:
                fetch(tenant_id)
            except PluginDaemonInternalServerError as error:
                errors.append(error)
                raise
            return []

    with httpx.Client(transport=httpx.MockTransport(daemon_reply), trust_env=False) as http_client:
        monkeypatch.setattr(client_module, "_httpx_client", http_client)
        response = app.test_client().get("/provider-list")

    assert requested == [("GET", f"/plugin/{tenant_id}/management/{kind}")]
    assert response.status_code == 500, response.get_json()
    body = response.get_json()
    assert (body["status"], body["code"]) == (500, "unknown")
    assert [error.description for error in errors] == ["Internal Server Error"]
