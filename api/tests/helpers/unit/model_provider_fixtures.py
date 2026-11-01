"""Opt-in HTTP fixtures for provider discovery without a deployed plugin daemon."""

from collections.abc import Callable, Iterator
from threading import Thread

import pytest
from flask import Flask
from werkzeug.serving import make_server
from yarl import URL

from core.plugin.impl import base as plugin_base


@pytest.fixture(scope="session")
def _empty_model_provider_daemon_url() -> Iterator[URL]:
    app = Flask(__name__)

    @app.get("/plugin/<tenant_id>/management/models")
    def list_model_providers(tenant_id: str) -> dict[str, object]:
        return {"code": 0, "message": "success", "data": []}

    server = make_server("127.0.0.1", 0, app, threaded=True)
    thread = Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
    thread.start()
    try:
        yield URL(f"http://127.0.0.1:{server.server_port}")
    finally:
        server.shutdown()
        thread.join()
        server.server_close()


@pytest.fixture
def _empty_model_provider_daemon(
    _empty_model_provider_daemon_url: URL,
    config_overrides: Callable[..., None],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Run real model discovery against an empty installation over loopback HTTP.

    Skip the global unit-test Redis mock so a cache response cannot determine
    whether malformed stored providers reach their intended resolution error.
    """
    config_overrides(PLUGIN_MODEL_PROVIDERS_CACHE_ENABLED=False)
    monkeypatch.setattr(plugin_base, "plugin_daemon_inner_api_baseurl", _empty_model_provider_daemon_url)
