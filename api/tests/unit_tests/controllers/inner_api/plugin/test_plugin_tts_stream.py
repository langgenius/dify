"""Exercise TTS cleanup through the real inner-API handler and HTTP encoders."""

import struct
from collections.abc import Callable, Iterator
from types import SimpleNamespace
from typing import override

import pytest
from flask import Flask
from flask_login import LoginManager
from flask_restx import Api

from controllers.inner_api.plugin.plugin import PluginInvokeTTSApi
from core.plugin.backwards_invocation.base import BaseBackwardsInvocationResponse
from core.plugin.backwards_invocation.model import PluginModelBackwardsInvocation
from core.plugin.entities.plugin_daemon import TTSAudioChunk
from extensions.ext_database import db
from graphon.model_runtime.entities.model_entities import ModelPropertyKey, ModelType
from models.account import Tenant
from models.enums import EndUserType
from models.model import EndUser

_PATH = "/inner/api/invoke/tts"
_TENANT_ID = "11111111-1111-4111-8111-111111111111"
_USER_ID = "22222222-2222-4222-8222-222222222222"
_WAV = b"RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00" + b"a" * 32
_PAYLOAD = {
    "tenant_id": _TENANT_ID,
    "user_id": _USER_ID,
    "provider": "provider-a",
    "model": "tts-model",
    "content_text": "hello",
    "voice": "voice-a",
}
_HEADERS = {"X-Inner-Api-Key": "test-inner-key"}


class _ProviderStream(Iterator[bytes]):
    def __init__(self, chunks: list[bytes | Exception], *, close_error: bool = False) -> None:
        self._chunks = iter(chunks)
        self.close_error = close_error
        self.close_calls = 0
        self.read_calls = 0

    @override
    def __next__(self) -> bytes:
        self.read_calls += 1
        chunk = next(self._chunks)
        if isinstance(chunk, Exception):
            raise chunk
        return chunk

    def close(self) -> None:
        self.close_calls += 1
        if self.close_error:
            raise RuntimeError("provider cleanup failed")


class _ProviderModel:
    def __init__(self) -> None:
        self.stream = _ProviderStream([_WAV, b"second", b"third"])
        self.invoke_calls = 0

    def invoke_tts(self, *, content_text: str, voice: str) -> _ProviderStream:
        assert content_text == "hello"
        assert voice == "voice-a"
        self.invoke_calls += 1
        return self.stream

    def get_model_schema(self) -> SimpleNamespace:
        return SimpleNamespace(model_properties={ModelPropertyKey.AUDIO_TYPE: "wav"})


@pytest.fixture
def app(config_overrides: Callable[..., None]) -> Iterator[Flask]:
    config_overrides(
        DEPLOYMENT_EDITION="CLOUD",
        PLUGIN_DAEMON_KEY="test-daemon-key",
        INNER_API_KEY_FOR_PLUGIN="test-inner-key",
    )
    app = Flask(__name__)
    app.config.update(TESTING=True, SQLALCHEMY_DATABASE_URI="sqlite://")
    db.init_app(app)
    LoginManager(app)
    Api(app).add_resource(PluginInvokeTTSApi, _PATH)
    with app.app_context():
        Tenant.metadata.create_all(
            db.engine, tables=[Tenant.metadata.tables["tenants"], EndUser.metadata.tables["end_users"]]
        )
        tenant = Tenant(name="TTS workspace")
        tenant.id = _TENANT_ID
        db.session.add_all(
            [
                tenant,
                EndUser(
                    id=_USER_ID,
                    tenant_id=_TENANT_ID,
                    type=EndUserType.SERVICE_API,
                    session_id=_USER_ID,
                    is_anonymous=False,
                ),
            ]
        )
        db.session.commit()
        yield app
        db.session.remove()
        db.engine.dispose()


@pytest.fixture
def provider(monkeypatch: pytest.MonkeyPatch) -> _ProviderModel:
    model_instance = _ProviderModel()

    def bind_model(
        *, tenant_id: str, user_id: str | None, provider: str, model_type: ModelType, model: str
    ) -> _ProviderModel:
        assert (tenant_id, user_id) == (_TENANT_ID, _USER_ID)
        assert (provider, model_type, model) == ("provider-a", ModelType.TTS, "tts-model")
        return model_instance

    monkeypatch.setattr(PluginModelBackwardsInvocation, "_get_bound_model_instance", staticmethod(bind_model))
    return model_instance


def _decode_frame(frame: bytes | str) -> BaseBackwardsInvocationResponse[dict[str, str]]:
    assert isinstance(frame, bytes)
    magic, reserved, header_length, data_length = struct.unpack("<BBHI", frame[:8])
    assert (magic, reserved, header_length) == (0xF, 0, 0xA)
    assert frame[8:14] == b"\x00" * 6
    assert len(frame[14:]) == data_length
    return BaseBackwardsInvocationResponse[dict[str, str]].model_validate_json(frame[14:])


def test_unconsumed_tts_http_response_does_not_invoke_provider(app: Flask, provider: _ProviderModel) -> None:
    # Dispatch without the test client's eager first WSGI iteration.
    with app.test_request_context(_PATH, method="POST", json=_PAYLOAD, headers=_HEADERS):
        response = app.full_dispatch_request()
        assert response.status_code == 200
        response.close()
    assert provider.invoke_calls == 0
    assert provider.stream.read_calls == 0
    assert provider.stream.close_calls == 0


def test_partial_tts_http_response_closes_provider_without_reading_remaining_chunks(
    app: Flask, provider: _ProviderModel
) -> None:
    response = app.test_client().post(_PATH, json=_PAYLOAD, headers=_HEADERS, buffered=False)
    assert response.status_code == 200
    assert response.mimetype == "text/event-stream"
    first = _decode_frame(next(iter(response.response)))
    assert first.data == {"result": _WAV.hex(), "mime_type": "audio/wav"}
    assert first.error == ""
    assert provider.stream.read_calls == 1
    response.close()
    response.close()
    # The fixture retains the provider stream, so garbage collection cannot
    # conceal a missing close() anywhere in the HTTP wrapping chain.
    assert provider.stream.close_calls == 1
    assert provider.stream.read_calls == 1


def test_fully_consumed_tts_http_response_closes_provider_and_preserves_frames(
    app: Flask, provider: _ProviderModel
) -> None:
    response = app.test_client().post(_PATH, json=_PAYLOAD, headers=_HEADERS, buffered=False)
    frames = [_decode_frame(frame) for frame in response.response]
    assert [frame.data for frame in frames] == [
        {"result": chunk.hex(), "mime_type": "audio/wav"} for chunk in [_WAV, b"second", b"third"]
    ]
    assert all(frame.error == "" for frame in frames)
    assert provider.stream.close_calls == 1
    response.close()
    assert provider.stream.close_calls == 1


@pytest.mark.parametrize(
    ("chunks", "error_prefix", "successful_frames"),
    [
        ([RuntimeError("provider first chunk failed")], "provider first chunk failed", 0),
        ([TTSAudioChunk(_WAV, "audio/mpeg")], "TTS provider output MIME does not match", 0),
        ([_WAV, RuntimeError("provider next chunk failed")], "provider next chunk failed", 1),
    ],
    ids=["first-chunk", "mime", "later-chunk"],
)
@pytest.mark.parametrize("close_error", [False, True], ids=["clean-close", "failed-close"])
def test_tts_http_error_frame_preserves_invocation_error_and_closes_provider(
    app: Flask,
    provider: _ProviderModel,
    chunks: list[bytes | Exception],
    error_prefix: str,
    successful_frames: int,
    close_error: bool,
) -> None:
    provider.stream = _ProviderStream(chunks, close_error=close_error)
    response = app.test_client().post(_PATH, json=_PAYLOAD, headers=_HEADERS, buffered=False)
    assert response.status_code == 200
    frames = [_decode_frame(frame) for frame in response.response]
    assert len(frames) == successful_frames + 1
    assert all(frame.error == "" for frame in frames[:successful_frames])
    assert frames[-1].data is None
    assert frames[-1].error.startswith(error_prefix)
    assert provider.stream.close_calls == 1
    response.close()
    assert provider.stream.close_calls == 1
