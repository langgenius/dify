"""Opt-in loopback plugin daemon whose model-provider listing and installation records a test controls."""

import json
from collections.abc import Iterator, Mapping
from threading import Thread

import pytest
from flask import Flask, Response, request
from werkzeug.serving import make_server
from yarl import URL

from core.plugin.entities.plugin_daemon import PluginModelProviderEntity
from core.plugin.impl import base as plugin_base


class ModelProviderDaemon:
    """Serve the response bodies a test sets and record what the production clients asked for.

    ``listing_body`` answers ``GET plugin/<tenant>/management/models`` and ``installations_body``
    answers ``POST plugin/<tenant>/management/installation/fetch/batch``, both verbatim.
    """

    def __init__(self) -> None:
        self.listing_body = self.envelope([])
        self.installations_body = self.envelope([])
        self.listing_requests: list[tuple[str, dict[str, str]]] = []
        self.installation_requests: list[tuple[str, object]] = []

    @staticmethod
    def envelope(data: object) -> bytes:
        return json.dumps({"code": 0, "message": "success", "data": data}).encode()

    def serve_providers(self, *providers: PluginModelProviderEntity) -> None:
        self.listing_body = self.envelope([provider.model_dump(mode="json") for provider in providers])

    def serve_installations(self, *installations: Mapping[str, object]) -> None:
        self.installations_body = self.envelope([dict(installation) for installation in installations])

    def flask_app(self) -> Flask:
        app = Flask(__name__)

        @app.get("/plugin/<tenant_id>/management/models")
        def list_model_providers(tenant_id: str) -> Response:
            self.listing_requests.append((tenant_id, request.args.to_dict()))
            return Response(self.listing_body, mimetype="application/json")

        @app.post("/plugin/<tenant_id>/management/installation/fetch/batch")
        def list_installations(tenant_id: str) -> Response:
            self.installation_requests.append((tenant_id, request.get_json()))
            return Response(self.installations_body, mimetype="application/json")

        return app


def _clear_model_provider_listing_caches() -> None:
    # Imported here so that loading this plugin does not import the service layer before the
    # unit-test configuration is in place.
    from core.plugin.impl.model import PluginModelClient
    from core.plugin.plugin_service import PluginService

    with PluginModelClient._model_provider_listing_cache_lock:
        PluginModelClient._model_provider_listing_cache.clear()
    with PluginService._daemon_listing_declarations_cache_lock:
        PluginService._daemon_listing_declarations_cache.clear()


@pytest.fixture
def model_provider_daemon(monkeypatch: pytest.MonkeyPatch) -> Iterator[ModelProviderDaemon]:
    """Point the real plugin clients at a loopback daemon and isolate their process-local listing caches."""
    daemon = ModelProviderDaemon()
    server = make_server("127.0.0.1", 0, daemon.flask_app(), threaded=True)
    thread = Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
    thread.start()
    monkeypatch.setattr(plugin_base, "plugin_daemon_inner_api_baseurl", URL(f"http://127.0.0.1:{server.server_port}"))
    _clear_model_provider_listing_caches()
    try:
        yield daemon
    finally:
        _clear_model_provider_listing_caches()
        server.shutdown()
        thread.join()
        server.server_close()
