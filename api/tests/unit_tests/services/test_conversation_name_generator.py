"""Real provider resolution keeps naming metadata and the caller's session isolated."""

import json
from collections.abc import Iterator
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from uuid import uuid4

import httpx
import pytest
from flask import Flask
from sqlalchemy import Connection, Engine, event, select
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker
from yarl import URL

from configs import dify_config
from core.credit_usage import CreditUsageAppType, CreditUsageCreatedBy
from core.llm_generator.prompts import CONVERSATION_TITLE_PROMPT
from core.model_context import get_credit_usage_metadata, use_credit_usage_metadata
from core.ops import ops_trace_manager
from core.plugin.impl import base as plugin_http
from extensions.ext_database import db
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.errors.invoke import InvokeServerUnavailableError
from models import App, AppMode, Tenant
from models.provider import Provider, TenantDefaultModel
from services.conversation_name_generator import generate_conversation_name

_PROVIDER = "testing/naming/naming"
_MODEL = "title-model"


@dataclass
class NamingPlugin:
    """Only the external plugin-daemon boundary is served locally."""

    answer: str = '{"Your Output": "A generated title"}'
    fail_invoke: bool = False
    requests: list[tuple[str, dict[str, object]]] = field(default_factory=list)


@pytest.fixture
def naming_plugin() -> Iterator[NamingPlugin]:
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
    original_cache_enabled = dify_config.PLUGIN_MODEL_PROVIDERS_CACHE_ENABLED
    original_trace_interval = ops_trace_manager.trace_manager_interval
    original_trace_timer = ops_trace_manager.trace_manager_timer
    # Change real connection settings, preserving every production client and method.
    plugin_http.plugin_daemon_inner_api_baseurl = URL(f"http://127.0.0.1:{server.server_port}")
    dify_config.PLUGIN_MODEL_PROVIDERS_CACHE_ENABLED = False
    ops_trace_manager.trace_manager_interval = 3600
    thread.start()
    try:
        yield plugin
    finally:
        plugin_http.plugin_daemon_inner_api_baseurl = original_url
        dify_config.PLUGIN_MODEL_PROVIDERS_CACHE_ENABLED = original_cache_enabled
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


@pytest.mark.parametrize("fail_invoke", [False, True], ids=["success", "provider-error"])
def test_real_provider_invocation_releases_preparation_session_and_preserves_caller(
    naming_app: Flask,
    naming_plugin: NamingPlugin,
    sqlite_session_factory: sessionmaker[Session],
    fail_invoke: bool,
) -> None:
    naming_plugin.fail_invoke = fail_invoke
    tenant = Tenant(name="Naming workspace")
    target = App(
        id=str(uuid4()),
        tenant_id=tenant.id,
        name="Original app",
        mode=AppMode.CHAT,
        enable_site=True,
        enable_api=True,
    )
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                tenant,
                target,
                Provider(tenant_id=tenant.id, provider_name=_PROVIDER, is_valid=True),
                TenantDefaultModel(
                    tenant_id=tenant.id, provider_name=_PROVIDER, model_name=_MODEL, model_type=ModelType.LLM
                ),
            ]
        )

    naming_sessions: list[Session] = []
    invocation_metadata: list[dict[str, object]] = []
    preparation_sessions: list[Session] = []

    def observe_transaction(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        naming_sessions.append(session)

    def observe_request(request: httpx.Request) -> None:
        if request.url.path.endswith("/llm/invoke"):
            preparation_sessions.extend(naming_sessions)
            assert preparation_sessions
            assert all(not session.in_transaction() and not session.identity_map for session in preparation_sessions)
            assert caller_session.get_transaction() is caller_transaction
            assert caller_app is not None
            assert caller_app in caller_session.dirty
            assert caller_app.name == "Pending caller edit"
            invocation_metadata.append(dict(get_credit_usage_metadata() or {}))

    with naming_app.app_context():
        caller_session = db.session()
        caller_app = caller_session.get(App, target.id)
        assert caller_app is not None
        caller_app.name = "Pending caller edit"
        caller_transaction = caller_session.get_transaction()
        original_metadata = get_credit_usage_metadata()
        event.listen(db.session.session_factory, "after_begin", observe_transaction)
        plugin_http._httpx_client.event_hooks["request"].append(observe_request)
        try:
            with use_credit_usage_metadata({"request_id": "name-request", "app_id": target.id}):
                inherited_metadata = dict(get_credit_usage_metadata() or {})
                if fail_invoke:
                    with pytest.raises(InvokeServerUnavailableError, match="Title provider unavailable"):
                        generate_conversation_name(
                            tenant_id=tenant.id,
                            app_id=target.id,
                            conversation_id=str(uuid4()),
                            query="First\nquery",
                            app_mode=target.mode,
                        )
                else:
                    name = generate_conversation_name(
                        tenant_id=tenant.id,
                        app_id=target.id,
                        conversation_id=str(uuid4()),
                        query="First\nquery",
                        app_mode=target.mode,
                    )
                    assert name == "A generated title"
                assert get_credit_usage_metadata() == inherited_metadata
        finally:
            plugin_http._httpx_client.event_hooks["request"].remove(observe_request)
            event.remove(db.session.session_factory, "after_begin", observe_transaction)

        assert invocation_metadata == [
            {
                **inherited_metadata,
                "app_type": CreditUsageAppType.CHATBOT,
                "created_by": CreditUsageCreatedBy.CONVERSATION_NAME,
            }
        ]
        assert get_credit_usage_metadata() == original_metadata
        assert db.session() is caller_session
        assert caller_session.get_transaction() is caller_transaction
        assert caller_session.in_transaction()
        assert caller_app in caller_session.dirty
        assert caller_app.name == "Pending caller edit"
        assert all(session is not caller_session for session in naming_sessions)
        assert all(not session.in_transaction() and not session.identity_map for session in naming_sessions)
        if fail_invoke:
            assert naming_sessions == preparation_sessions
        else:
            # Trace configuration is read after invocation using a new inner session.
            assert len(naming_sessions) > len(preparation_sessions)
            assert naming_sessions[-1] not in preparation_sessions
        with sqlite_session_factory() as session:
            assert session.scalar(select(App.name).where(App.id == target.id)) == "Original app"

    invocations = [payload for path, payload in naming_plugin.requests if path.endswith("/llm/invoke")]
    assert len(invocations) == 1
    assert invocations[0]["app_id"] == target.id
    assert invocations[0]["data"] == {
        "provider": "naming",
        "model_type": "llm",
        "model": _MODEL,
        "credentials": {},
        "prompt_messages": [{"role": "user", "content": CONVERSATION_TITLE_PROMPT + "First query\n", "name": None}],
        "model_parameters": {"max_tokens": 500, "temperature": 1},
        "tools": None,
        "stop": None,
        "stream": False,
    }


@pytest.mark.parametrize(
    ("app_mode", "app_type"),
    [
        (AppMode.CHAT, CreditUsageAppType.CHATBOT),
        (AppMode.AGENT_CHAT, CreditUsageAppType.AGENT),
        (AppMode.ADVANCED_CHAT, CreditUsageAppType.CHATFLOW),
        (AppMode.AGENT, CreditUsageAppType.AGENT_V2),
    ],
)
def test_provider_resolution_failure_closes_inner_session_and_preserves_caller_context(
    naming_app: Flask,
    sqlite_session_factory: sessionmaker[Session],
    app_mode: AppMode,
    app_type: CreditUsageAppType,
) -> None:
    tenant = Tenant(name="Naming workspace")
    target = App(
        id=str(uuid4()),
        tenant_id=tenant.id,
        name="Original app",
        mode=app_mode,
        enable_site=True,
        enable_api=True,
    )
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [tenant, target, Provider(tenant_id=tenant.id, provider_name="invalid/provider", is_valid=True)]
        )

    provider_sessions: list[Session] = []
    metadata: list[dict[str, object]] = []

    def observe_provider_transaction(
        session: Session, _transaction: SessionTransaction, connection: Connection
    ) -> None:
        # Observe real default-model/provider SQL within the nested app context.
        # With no default model, invalid provider config fails before plugin I/O.
        assert session is db.session()
        assert connection.scalar(select(App.name).where(App.id == target.id)) == "Original app"
        provider_sessions.append(session)
        metadata.append(dict(get_credit_usage_metadata() or {}))

    with naming_app.app_context():
        caller_session = db.session()
        caller_app = caller_session.get(App, target.id)
        assert caller_app is not None
        caller_app.name = "Pending caller edit"
        caller_transaction = caller_session.get_transaction()
        original_metadata = get_credit_usage_metadata()
        event.listen(db.session.session_factory, "after_begin", observe_provider_transaction)
        try:
            with use_credit_usage_metadata({"request_id": "name-request"}):
                inherited_metadata = dict(get_credit_usage_metadata() or {})
                with pytest.raises(ValueError, match="^Invalid plugin id invalid/provider$"):
                    generate_conversation_name(
                        tenant_id=target.tenant_id,
                        app_id=target.id,
                        conversation_id=str(uuid4()),
                        query="First query",
                        app_mode=app_mode.value,
                    )
                assert get_credit_usage_metadata() == inherited_metadata
        finally:
            event.remove(db.session.session_factory, "after_begin", observe_provider_transaction)
        assert get_credit_usage_metadata() == original_metadata
        assert provider_sessions
        assert all(
            observed
            == {
                **inherited_metadata,
                "app_type": app_type,
                "created_by": CreditUsageCreatedBy.CONVERSATION_NAME,
            }
            for observed in metadata
        )
        assert db.session() is caller_session
        assert caller_session.get_transaction() is caller_transaction
        assert caller_session.in_transaction()
        assert caller_app in caller_session.dirty
        assert caller_app.name == "Pending caller edit"
        for provider_session in provider_sessions:
            assert provider_session is not caller_session
            assert not provider_session.in_transaction()
            assert not provider_session.identity_map
        with sqlite_session_factory() as session:
            stored_app = session.get(App, target.id)
            assert stored_app is not None
            assert stored_app.name == "Original app"
