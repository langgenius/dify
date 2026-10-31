"""Real plugin HTTP transport and database scope shared by conversation naming tests."""

import json
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

import pytest
from flask import Flask
from sqlalchemy import Engine
from yarl import URL

from core.ops import ops_trace_manager
from core.plugin.impl import base as plugin_http
from extensions.ext_database import db

_PROVIDER = "testing/naming/naming"
_MODEL = "title-model"


@dataclass
class NamingPlugin:
    """Only the external plugin-daemon boundary is served locally."""

    answer: str = '{"Your Output": "A generated title"}'
    fail_invoke: bool = False
    requests: list[tuple[str, dict[str, object]]] = field(default_factory=list)


@pytest.fixture
def naming_plugin(config_overrides: Callable[..., None]) -> Iterator[NamingPlugin]:
    plugin = NamingPlugin()
    model = {
        "model": _MODEL,
        "label": {"en_US": _MODEL},
        "model_type": "llm",
        "fetch_from": "predefined-model",
        "model_properties": {"mode": "chat"},
    }

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            tenant_id = self.path.split("/")[2]
            plugin.requests.append((self.path, {}))
            self.respond(
                [
                    {
                        "id": "naming-installation",
                        "created_at": "2026-01-01T00:00:00Z",
                        "updated_at": "2026-01-01T00:00:00Z",
                        "provider": "naming",
                        "tenant_id": tenant_id,
                        "plugin_id": "testing/naming",
                        "plugin_unique_identifier": "testing/naming:1.0.0@" + "a" * 64,
                        "installation_source": "marketplace",
                        "declaration": {
                            "provider": "naming",
                            "label": {"en_US": "Naming provider"},
                            "supported_model_types": ["llm"],
                            "configurate_methods": ["predefined-model"],
                            "models": [model],
                        },
                    }
                ],
                stream=False,
            )

        def do_POST(self) -> None:
            payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            plugin.requests.append((self.path, payload))
            if self.path.endswith("/llm/invoke"):
                if plugin.fail_invoke:
                    error = {
                        "error_type": "PluginInvokeError",
                        "message": json.dumps(
                            {"error_type": "InvokeServerUnavailableError", "message": "Title provider unavailable"}
                        ),
                    }
                    self.respond(None, stream=True, code=-500, message=json.dumps(error))
                    return
                self.respond(
                    {"model": _MODEL, "delta": {"index": 0, "message": {"content": plugin.answer}}},
                    stream=True,
                )
            else:
                self.send_error(404)

        def respond(self, data: object, *, stream: bool, code: int = 0, message: str = "") -> None:
            envelope = json.dumps({"code": code, "message": message, "data": data})
            body = (f"data: {envelope}\n\n" if stream else envelope).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream" if stream else "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    original_url = plugin_http.plugin_daemon_inner_api_baseurl
    original_trace_interval = ops_trace_manager.trace_manager_interval
    original_trace_timer = ops_trace_manager.trace_manager_timer
    # Change real connection settings, preserving every production client and method.
    plugin_http.plugin_daemon_inner_api_baseurl = URL(f"http://127.0.0.1:{server.server_port}")
    config_overrides(PLUGIN_MODEL_PROVIDERS_CACHE_ENABLED=False)
    ops_trace_manager.trace_manager_interval = 3600
    thread.start()
    try:
        yield plugin
    finally:
        plugin_http.plugin_daemon_inner_api_baseurl = original_url
        ops_trace_manager.trace_manager_interval = original_trace_interval
        timer = ops_trace_manager.trace_manager_timer
        if timer is not None and timer is not original_trace_timer:
            timer.cancel()
            timer.join(timeout=1)
            ops_trace_manager.trace_manager_timer = original_trace_timer
        server.shutdown()
        server.server_close()
        thread.join(timeout=1)


@pytest.fixture
def naming_app(sqlite_engine: Engine) -> Iterator[Flask]:
    app = Flask(__name__)
    app.config.update(TESTING=True, SQLALCHEMY_DATABASE_URI=str(sqlite_engine.url))
    db.init_app(app)
    yield app
    with app.app_context():
        db.session.remove()
        db.engine.dispose()
