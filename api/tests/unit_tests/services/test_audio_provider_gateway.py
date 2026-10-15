"""Real model preparation owns its scoped session independently of the caller.

The custom provider below exercises ModelManager and the plugin SDK. Hosted
quota settlement and discovery I/O inside model resolution remain outside this
migration; these tests do not substitute those paths with fake model instances.
"""

from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from io import BytesIO
from typing import Literal, cast
from uuid import uuid4

import httpx
import pytest
from flask import Flask, current_app
from sqlalchemy import Connection, Engine, delete, event, select, update
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker

from core.errors.error import ProviderTokenNotInitError
from core.plugin.impl import base as plugin_http
from enums import DeploymentEdition
from extensions.ext_database import db
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.errors.invoke import InvokeError
from libs.stream import close_stream
from models import App, Tenant
from models.model import AppMode
from models.provider import Provider, ProviderCredential, TenantDefaultModel
from services import audio_provider_gateway
from services.audio_service import AudioService
from services.audio_types import AudioAppRef, AudioOutput, AudioUpload
from tests.unit_tests.services.audio_runtime_fixtures import WAV_AUDIO, AudioPlugin

pytest_plugins = ("tests.unit_tests.services.audio_runtime_fixtures",)
type Operation = Literal["asr", "tts", "voices"]
_PROVIDER = "testing/audio/audio"
_MODEL = "audio-model"


@dataclass
class GatewayHarness:
    app: Flask
    tenant_id: str
    factory: sessionmaker[Session]
    caller: Session
    transaction: SessionTransaction
    pending: Tenant
    dirty: Tenant
    plugin: AudioPlugin
    preparation_sessions: list[Session] = field(default_factory=list)
    caller_events: list[str] = field(default_factory=list)
    invoked_paths: list[str] = field(default_factory=list)

    def invoke(self, operation: Operation) -> object:
        app = AudioAppRef(app_id=str(uuid4()), tenant_id=self.tenant_id, app_mode="chat")
        if operation == "asr":
            return audio_provider_gateway.speech_to_text(app=app, content=b"recording", end_user="audio-user")
        if operation == "voices":
            return audio_provider_gateway.get_voices(tenant_id=self.tenant_id, language="en-US")
        output = audio_provider_gateway.text_to_speech(app=app, text="Preview", voice="selected", end_user="audio-user")
        return b"".join(cast(Iterator[bytes], output.data))

    def assert_preparation_closed(self) -> None:
        assert self.preparation_sessions
        assert all(not session.in_transaction() and not session.identity_map for session in self.preparation_sessions)

    def assert_caller_untouched(self) -> None:
        assert current_app == self.app
        assert db.session() is self.caller
        assert self.caller.get_transaction() is self.transaction
        assert self.transaction.is_active
        assert self.pending in self.caller.new
        assert self.dirty in self.caller.dirty
        assert self.dirty.name == "Uncommitted rename"
        assert self.caller_events == []


@pytest.fixture
def gateway(
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
    audio_plugin: AudioPlugin,
    config_overrides: Callable[..., None],
) -> Iterator[GatewayHarness]:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
    tenant = Tenant(name="Provider workspace")
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                tenant,
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
    app.config.update(TESTING=True, SQLALCHEMY_DATABASE_URI=str(sqlite_engine.url))
    db.init_app(app)
    with app.app_context():
        caller = db.session()
        dirty = caller.get(Tenant, tenant.id)
        assert dirty is not None
        dirty.name = "Uncommitted rename"
        pending = Tenant(name="Uncommitted workspace")
        caller.add(pending)
        transaction = caller.get_transaction()
        assert transaction is not None
        harness = GatewayHarness(
            app, tenant.id, sqlite_session_factory, caller, transaction, pending, dirty, audio_plugin
        )

        def record_session(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
            if session is not caller:
                harness.preparation_sessions.append(session)

        def record_commit(session: Session) -> None:
            if session is caller:
                harness.caller_events.append("commit")

        def record_rollback(session: Session) -> None:
            if session is caller:
                harness.caller_events.append("rollback")

        def observe_provider(request: httpx.Request) -> None:
            # Discovery/schema lookup during model preparation remains legacy I/O.
            # Only actual audio/voice invocation must start after preparation ends.
            if request.url.path.endswith(("/speech2text/invoke", "/tts/invoke", "/tts/model/voices")):
                harness.assert_preparation_closed()
                harness.assert_caller_untouched()
                harness.invoked_paths.append(request.url.path)

        event.listen(db.session.session_factory, "after_begin", record_session)
        event.listen(db.session.session_factory, "before_commit", record_commit)
        event.listen(db.session.session_factory, "after_rollback", record_rollback)
        plugin_http._httpx_client.event_hooks["request"].append(observe_provider)
        try:
            yield harness
        finally:
            plugin_http._httpx_client.event_hooks["request"].remove(observe_provider)
            event.remove(db.session.session_factory, "after_begin", record_session)
            event.remove(db.session.session_factory, "before_commit", record_commit)
            event.remove(db.session.session_factory, "after_rollback", record_rollback)
            db.session.remove()
            db.engine.dispose()


@pytest.mark.parametrize("operation", ["asr", "tts", "voices"])
def test_invocation_releases_preparation_without_touching_caller(gateway: GatewayHarness, operation: Operation) -> None:
    result = gateway.invoke(operation)
    assert result == (
        " transcript " if operation == "asr" else WAV_AUDIO if operation == "tts" else gateway.plugin.voices
    )
    gateway.assert_preparation_closed()
    gateway.assert_caller_untouched()
    assert len(gateway.invoked_paths) == 1
    payload = next(payload for path, payload in gateway.plugin.requests if path == gateway.invoked_paths[0])
    if operation == "voices":
        assert "user_id" not in payload
        assert cast(dict[str, object], payload["data"])["language"] == "en-US"
    else:
        assert payload["user_id"] == "audio-user"
    with gateway.factory() as session:
        assert session.get(Tenant, gateway.pending.id) is None
        stored = session.get(Tenant, gateway.tenant_id)
        assert stored is not None
        assert stored.name == "Provider workspace"


@pytest.mark.parametrize("operation", ["asr", "tts", "voices"])
def test_preparation_error_preserves_pending_caller_transaction(gateway: GatewayHarness, operation: Operation) -> None:
    with gateway.factory.begin() as session:
        session.execute(update(Provider).where(Provider.tenant_id == gateway.tenant_id).values(is_valid=False))
    with pytest.raises(ProviderTokenNotInitError):
        gateway.invoke(operation)
    gateway.assert_preparation_closed()
    gateway.assert_caller_untouched()
    assert gateway.invoked_paths == []


@pytest.mark.parametrize("operation", ["asr", "tts", "voices"])
def test_provider_error_preserves_pending_caller_transaction(gateway: GatewayHarness, operation: Operation) -> None:
    gateway.plugin.error = "InvokeServerUnavailableError"
    with pytest.raises(InvokeError, match="Audio provider unavailable"):
        gateway.invoke(operation)
    gateway.assert_preparation_closed()
    gateway.assert_caller_untouched()
    assert len(gateway.invoked_paths) == 1


@pytest.mark.parametrize("operation", ["asr", "tts", "voices"])
def test_missing_default_is_persisted_without_committing_callers_pending_changes(
    gateway: GatewayHarness, operation: Operation
) -> None:
    model_type = ModelType.SPEECH2TEXT if operation == "asr" else ModelType.TTS
    with gateway.factory.begin() as session:
        credential = ProviderCredential(
            tenant_id=gateway.tenant_id,
            provider_name=_PROVIDER,
            credential_name="Audio test credential",
            encrypted_config="legacy-audio-token",
        )
        session.add(credential)
        session.flush()
        session.execute(
            update(Provider).where(Provider.tenant_id == gateway.tenant_id).values(credential_id=credential.id)
        )
        session.execute(
            delete(TenantDefaultModel).where(
                TenantDefaultModel.tenant_id == gateway.tenant_id, TenantDefaultModel.model_type == model_type
            )
        )
    gateway.invoke(operation)
    gateway.assert_preparation_closed()
    gateway.assert_caller_untouched()
    with gateway.factory() as session:
        model = session.scalar(
            select(TenantDefaultModel).where(
                TenantDefaultModel.tenant_id == gateway.tenant_id, TenantDefaultModel.model_type == model_type
            )
        )
        assert model is not None
        assert model.provider_name == _PROVIDER
        assert model.model_name == _MODEL
        assert session.get(Tenant, gateway.pending.id) is None
    gateway.caller.rollback()
    with gateway.factory() as session:
        stored = session.get(Tenant, gateway.tenant_id)
        assert stored is not None
        assert stored.name == "Provider workspace"
        assert session.get(Tenant, gateway.pending.id) is None
        assert (
            session.scalar(
                select(TenantDefaultModel.id).where(
                    TenantDefaultModel.tenant_id == gateway.tenant_id, TenantDefaultModel.model_type == model_type
                )
            )
            is not None
        )


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.AGENT])
def test_asr_service_preserves_uploaded_bytes_and_caller_identity(gateway: GatewayHarness, mode: AppMode) -> None:
    app = App(id=str(uuid4()), tenant_id=gateway.tenant_id, mode=mode)
    result = AudioService.invoke_speech_to_text(
        app, AudioUpload(stream=BytesIO(b"recorded audio"), mime_type="audio/mp3"), end_user="user-123"
    )
    assert result == {"text": " transcript "}
    payload = gateway.plugin.invocations("speech2text")[0]
    assert payload["user_id"] == "user-123"
    assert cast(dict[str, object], payload["data"])["file"] == b"recorded audio".hex()
    gateway.assert_caller_untouched()


@pytest.mark.parametrize("voice", ["selected", None], ids=["explicit-voice", "default-voice"])
def test_tts_service_preserves_trimmed_text_and_voice_selection(gateway: GatewayHarness, voice: str | None) -> None:
    app = App(id=str(uuid4()), tenant_id=gateway.tenant_id, mode=AppMode.CHAT)
    output = AudioService.invoke_tts(app, text="  Hello world  ", voice=voice, end_user="user-123")
    assert output.mime_type == "audio/wav"
    assert b"".join(cast(Iterator[bytes], output.data)) == WAV_AUDIO
    payload = gateway.plugin.invocations("tts")[0]
    assert payload["user_id"] == "user-123"
    data = cast(dict[str, object], payload["data"])
    assert data["content_text"] == "Hello world"
    assert data["voice"] == (voice or "fallback-voice")
    gateway.assert_caller_untouched()


def test_tts_rejects_provider_with_no_voices_without_invoking_audio(gateway: GatewayHarness) -> None:
    gateway.plugin.voices = []
    with pytest.raises(ValueError, match="Sorry, no voice available"):
        audio_provider_gateway.text_to_speech(
            app=AudioAppRef(str(uuid4()), gateway.tenant_id, "chat"), text="Preview", voice=None, end_user=None
        )
    assert gateway.plugin.invocations("tts") == []
    gateway.assert_preparation_closed()
    gateway.assert_caller_untouched()


def test_tts_supports_delayed_iteration_and_partial_close_in_caller_context(gateway: GatewayHarness) -> None:
    gateway.plugin.audio_chunks = (WAV_AUDIO, b"later audio")
    output: AudioOutput = audio_provider_gateway.text_to_speech(
        app=AudioAppRef(str(uuid4()), gateway.tenant_id, "chat"), text="Preview", voice="selected", end_user=None
    )
    gateway.assert_preparation_closed()
    gateway.assert_caller_untouched()
    assert not gateway.plugin.invocations("tts")
    stream = iter(cast(Iterator[bytes], output.data))
    try:
        assert next(stream) == WAV_AUDIO
        gateway.assert_caller_untouched()
    finally:
        close_stream(stream)
    assert list(stream) == []
    gateway.assert_caller_untouched()
