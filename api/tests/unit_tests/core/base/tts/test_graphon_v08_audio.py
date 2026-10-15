"""Formal Graphon TTS chunks retain bytes/MIME and lazy stream ownership."""

import pytest

from core.base.tts.audio_mime import inspect_audio_stream
from graphon.model_runtime.errors.invoke import InvokeBadRequestError
from graphon.model_runtime.protocols.tts_runtime import TTSChunk


def test_native_tts_chunk_bytes_mime_and_early_close():
    closed = []
    audio = b"RIFF" + b"\x00" * 4 + b"WAVE" + b"\x00" * 32

    def provider():
        try:
            yield TTSChunk(data=audio, mime_type="audio/wav")
            raise AssertionError("provider read beyond requested chunk")
        finally:
            closed.append(True)

    stream, mime = inspect_audio_stream(provider())
    assert mime == "audio/wav"
    assert next(stream) == audio
    stream.close()
    assert closed == [True]


def test_native_tts_mime_mismatch_closes_provider():
    closed = []

    def provider():
        try:
            yield TTSChunk(data=b"RIFF" + b"\x00" * 4 + b"WAVE" + b"\x00" * 32, mime_type="audio/mpeg")
        finally:
            closed.append(True)

    with pytest.raises(InvokeBadRequestError, match="does not match"):
        inspect_audio_stream(provider())
    assert closed == [True]


def test_plugin_runtime_adapts_bytes_to_native_chunks_lazily_and_closes():
    from unittest.mock import Mock

    from core.plugin.entities.plugin_daemon import TTSAudioChunk
    from core.plugin.impl.model_runtime import PluginModelRuntime

    lifecycle = []

    def plugin_stream(**_kwargs):
        lifecycle.append("invoke")
        try:
            yield TTSAudioChunk(b"audio", mime_type="audio/wav")
            raise AssertionError("unrequested provider consumption")
        finally:
            lifecycle.append("closed")

    runtime = object.__new__(PluginModelRuntime)
    runtime.tenant_id = "tenant"
    runtime.user_id = "user"
    runtime.client = Mock(invoke_tts=plugin_stream)
    runtime._split_provider = lambda _: ("plugin", "provider")
    stream = runtime.invoke_tts(provider="provider", model="model", credentials={}, content_text="text", voice="")
    assert lifecycle == []
    assert next(iter(stream)) == TTSChunk(data=b"audio", mime_type="audio/wav")
    stream.close()
    assert lifecycle == ["invoke", "closed"]
