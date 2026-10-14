"""Real audio HTTP transport and SQLite dependencies shared by entry-point tests."""

import json
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from decimal import Decimal
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from threading import Thread
from typing import Literal
from uuid import uuid4

import httpx
import pytest
from flask import Flask
from flask_login import LoginManager
from sqlalchemy import Connection, Engine, event
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker
from werkzeug.test import TestResponse
from yarl import URL

from constants import HEADER_NAME_APP_CODE, HEADER_NAME_PASSPORT
from core.plugin.impl import base as plugin_http
from enums import DeploymentEdition
from extensions.application_services.resource_access_token import build_resource_access_token_service
from extensions.ext_database import db
from graphon.model_runtime.entities.model_entities import ModelType
from libs.external_api import ExternalApi
from libs.passport import PassportService
from models import App, AppModelConfig, EndUser, Message, Tenant
from models.enums import ConversationFromSource, CustomizeTokenStrategy, EndUserType, MessageStatus
from models.model import ApiToken, Site
from models.provider import Provider, TenantDefaultModel
from repositories.app_definition_query_repository import AppDefinitionQueryRepository
from repositories.app_scoped_end_user_repository import AppScopedEndUserRepo
from services.app_audio_adapters import AppAudioRuntime
from services.app_definition_query_service import AppDefinitionQueryService
from services.app_scoped_end_user_service import AppScopedEndUserService
from services.resource_access_token_service import ResourceAccessTokenService
from tests.unit_tests.model_factories import make_app, make_end_user, make_message

type AudioSurface = Literal["web", "service_api"]
_PROVIDER = "testing/audio/audio"
_MODEL = "audio-model"
WAV_AUDIO = b"RIFF\x24\x00\x00\x00WAVEfmt " + b"a" * 32


@dataclass
class AudioPlugin:
    """Only the external plugin daemon is substituted, using its actual wire format."""

    audio: bytes = WAV_AUDIO
    mime_type: str | None = "audio/wav"
    error: str | None = None
    requests: list[tuple[str, dict[str, object]]] = field(default_factory=list)

    def invocations(self, operation: str) -> list[dict[str, object]]:
        return [payload for path, payload in self.requests if path.endswith(f"/{operation}/invoke")]


@pytest.fixture
def audio_plugin(config_overrides: Callable[..., None]) -> Iterator[AudioPlugin]:
    plugin = AudioPlugin()
    models = [
        {
            "model": _MODEL,
            "label": {"en_US": _MODEL},
            "model_type": model_type,
            "fetch_from": "predefined-model",
            "model_properties": {"audio_type": "wav"} if model_type == "tts" else dict[str, str](),
        }
        for model_type in ("speech2text", "tts")
    ]

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            plugin.requests.append((self.path, {}))
            self.respond(
                [
                    {
                        "id": "audio-installation",
                        "created_at": "2026-01-01T00:00:00Z",
                        "updated_at": "2026-01-01T00:00:00Z",
                        "provider": "audio",
                        "tenant_id": self.path.split("/")[2],
                        "plugin_id": "testing/audio",
                        "plugin_unique_identifier": "testing/audio:1.0.0@" + "a" * 64,
                        "installation_source": "marketplace",
                        "declaration": {
                            "provider": "audio",
                            "label": {"en_US": "Audio provider"},
                            "supported_model_types": ["speech2text", "tts"],
                            "configurate_methods": ["predefined-model"],
                            "models": models,
                        },
                    }
                ],
                stream=False,
            )

        def do_POST(self) -> None:
            payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            plugin.requests.append((self.path, payload))
            if self.path.endswith("/model/schema"):
                self.respond({"model_schema": models[1]})
            elif plugin.error is not None:
                error = {
                    "error_type": "PluginInvokeError",
                    "message": json.dumps({"error_type": plugin.error, "message": "Audio provider unavailable"}),
                }
                self.respond(None, code=-500, message=json.dumps(error))
            elif self.path.endswith("/speech2text/invoke"):
                self.respond({"result": " transcript "})
            elif self.path.endswith("/tts/invoke"):
                self.respond({"result": plugin.audio.hex(), "mime_type": plugin.mime_type})
            elif self.path.endswith("/tts/model/voices"):
                self.respond({"voices": [{"name": "Fallback voice", "value": "fallback-voice"}]})
            else:
                self.send_error(404)

        def respond(self, data: object, *, stream: bool = True, code: int = 0, message: str = "") -> None:
            envelope = json.dumps({"code": code, "message": message, "data": data})
            body = (f"data: {envelope}\n\n" if stream else envelope).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream" if stream else "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
    original_url = plugin_http.plugin_daemon_inner_api_baseurl
    config_overrides(PLUGIN_MODEL_PROVIDERS_CACHE_ENABLED=False)
    plugin_http.plugin_daemon_inner_api_baseurl = URL(f"http://127.0.0.1:{server.server_port}")
    thread.start()
    try:
        yield plugin
    finally:
        plugin_http.plugin_daemon_inner_api_baseurl = original_url
        server.shutdown()
        server.server_close()
        thread.join(timeout=1)


@dataclass(frozen=True)
class _EndUsers:
    commands: AppScopedEndUserService[EndUser]


@dataclass(frozen=True)
class _Services:
    app_audio: AppAudioRuntime
    app_definitions: AppDefinitionQueryService
    app_scoped_end_users: _EndUsers
    resource_access_tokens: ResourceAccessTokenService


@dataclass(frozen=True)
class AudioHarness:
    app: Flask
    surface: AudioSurface
    target: App
    end_user: EndUser
    message: Message
    config: AppModelConfig
    factory: sessionmaker[Session]
    plugin: AudioPlugin
    headers: dict[str, str]
    admission_sessions: list[Session]
    configuration_sessions: list[Session]

    def asr(self, content: bytes | None = b"recording", *, mime_type: str = "audio/mp3") -> TestResponse:
        data: dict[str, object] = {"user": "audio-user"} if self.surface == "service_api" else {}
        if content is not None:
            data["file"] = (BytesIO(content), "recording.mp3", mime_type)
        return self.app.test_client().post("/audio-to-text", data=data, headers=self.headers)

    def tts(self, payload: dict[str, object]) -> TestResponse:
        body = {"user": "audio-user", **payload} if self.surface == "service_api" else payload
        return self.app.test_client().post("/text-to-audio", json=body, headers=self.headers)

    def assert_preparation_closed(self) -> None:
        assert self.admission_sessions
        assert self.configuration_sessions
        assert all(
            not session.in_transaction() and not session.identity_map
            for session in self.admission_sessions + self.configuration_sessions
        )


@pytest.fixture
def audio_harness(
    audio_surface: AudioSurface,
    audio_plugin: AudioPlugin,
    config_overrides: Callable[..., None],
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
) -> Iterator[AudioHarness]:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY, SECRET_KEY="audio-http-test-secret")
    tenant = Tenant(name="Audio workspace")
    target = make_app(app_id=str(uuid4()), tenant_id=tenant.id)
    end_user = make_end_user(
        end_user_id=str(uuid4()),
        tenant_id=tenant.id,
        app_id=target.id,
        end_user_type=EndUserType.SERVICE_API if audio_surface == "service_api" else EndUserType.BROWSER,
        session_id="audio-user",
        external_user_id="external-audio-user",
    )
    config = AppModelConfig(
        app_id=target.id,
        speech_to_text='{"enabled":true}',
        text_to_speech='{"enabled":true,"voice":"configured-voice"}',
    )
    message = make_message(
        message_id=str(uuid4()),
        app_id=target.id,
        conversation_id=str(uuid4()),
        inputs={},
        message={},
        query="Question",
        answer=" Owned message answer ",
        status=MessageStatus.NORMAL,
        message_unit_price=Decimal(0),
        answer_unit_price=Decimal(0),
        currency="USD",
        from_source=ConversationFromSource.API,
        from_end_user_id=end_user.id,
    )
    site = Site(
        app_id=target.id,
        title="Audio app",
        code="audio-app",
        default_language="en-US",
        customize_token_strategy=CustomizeTokenStrategy.UUID,
    )
    with sqlite_session_factory.begin() as session:
        session.add_all([tenant, target, end_user, config, message, site])
        session.flush()
        target.app_model_config_id = config.id
        session.add_all(
            [
                ApiToken(app_id=target.id, tenant_id=tenant.id, type="app", token="audio-token"),
                Provider(tenant_id=tenant.id, provider_name=_PROVIDER, is_valid=True),
                *(
                    TenantDefaultModel(
                        tenant_id=tenant.id, provider_name=_PROVIDER, model_name=_MODEL, model_type=model_type
                    )
                    for model_type in (ModelType.SPEECH2TEXT, ModelType.TTS)
                ),
            ]
        )

    app = Flask(__name__)
    app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False, SQLALCHEMY_DATABASE_URI=str(sqlite_engine.url))
    db.init_app(app)
    LoginManager(app)
    configuration_factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    observed_reads: list[Session] = []
    admission_sessions: list[Session] = []
    configuration_sessions: list[Session] = []

    def observe_admission(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        observed_reads.append(session)

    def observe_configuration(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        # Freeze the reads preceding configuration, excluding subsequent SDK
        # credential lookups that can use this same factory.
        admission_sessions.extend(observed_reads)
        observed_reads.clear()
        assert all(not previous.in_transaction() for previous in admission_sessions)
        configuration_sessions.append(session)

    def observe_provider_request(_request: httpx.Request) -> None:
        # Provider SDK credential sessions are outside this migration. These are
        # specifically the completed admission/configuration transactions.
        harness.assert_preparation_closed()

    app.extensions["application_services"] = _Services(
        app_audio=AppAudioRuntime(session_factory=configuration_factory),
        app_definitions=AppDefinitionQueryService(
            definitions=AppDefinitionQueryRepository(session_factory=sqlite_session_factory), builtin_icon_url_prefix=""
        ),
        app_scoped_end_users=_EndUsers(
            AppScopedEndUserService(end_users=AppScopedEndUserRepo(session_factory=sqlite_session_factory))
        ),
        resource_access_tokens=build_resource_access_token_service(database_client=sqlite_session_factory),
    )
    api = ExternalApi(app)
    if audio_surface == "web":
        from controllers.web.audio import AudioApi, TextApi

        assert site.code is not None
        passport = PassportService().issue({"app_code": site.code, "app_id": target.id, "end_user_id": end_user.id})
        headers = {HEADER_NAME_APP_CODE: site.code, HEADER_NAME_PASSPORT: passport}
    else:
        from controllers.service_api.app.audio import AudioApi, TextApi

        headers = {"Authorization": "Bearer audio-token"}
    api.add_resource(AudioApi, "/audio-to-text")
    api.add_resource(TextApi, "/text-to-audio")
    harness = AudioHarness(
        app,
        audio_surface,
        target,
        end_user,
        message,
        config,
        sqlite_session_factory,
        audio_plugin,
        headers,
        admission_sessions,
        configuration_sessions,
    )
    event.listen(sqlite_session_factory, "after_begin", observe_admission)
    event.listen(configuration_factory, "after_begin", observe_configuration)
    plugin_http._httpx_client.event_hooks["request"].append(observe_provider_request)
    try:
        yield harness
    finally:
        plugin_http._httpx_client.event_hooks["request"].remove(observe_provider_request)
        event.remove(configuration_factory, "after_begin", observe_configuration)
        event.remove(sqlite_session_factory, "after_begin", observe_admission)
        with app.app_context():
            db.session.remove()
            db.engine.dispose()
