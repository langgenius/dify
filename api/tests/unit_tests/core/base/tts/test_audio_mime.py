from types import SimpleNamespace
from typing import cast

import pytest

from core.base.tts.audio_mime import (
    TTSMIMETypeError,
    TTSMIMETypeMismatchError,
    get_model_audio_mime_type,
    inspect_audio_stream,
    resolve_audio_mime_type,
    supports_incremental_tts_playback,
)
from core.model_manager import ModelInstance
from core.plugin.entities.plugin_daemon import TTSAudioChunk
from graphon.model_runtime.entities.model_entities import ModelPropertyKey


def test_inspect_audio_stream_preserves_the_prefix_with_matching_chunk_mime_type() -> None:
    chunks = [b"RIFF\x24\x00\x00\x00", b"WAVEfmt ", b"audio-data"]

    stream, mime_type = inspect_audio_stream(
        iter([TTSAudioChunk(chunk, "audio/wav") for chunk in chunks]), "audio/mpeg"
    )

    assert mime_type == "audio/wav"
    assert list(stream) == chunks


def test_inspect_audio_stream_rejects_mime_magic_mismatch() -> None:
    with pytest.raises(TTSMIMETypeMismatchError, match="declared audio/mpeg, detected audio/wav"):
        inspect_audio_stream([TTSAudioChunk(b"RIFF\x24\x00\x00\x00WAVEfmt ", "audio/mpeg")])


def test_inspect_audio_stream_rejects_unsupported_reported_mime_type() -> None:
    with pytest.raises(TTSMIMETypeError, match="unsupported chunk MIME type"):
        inspect_audio_stream([TTSAudioChunk(b"audio", "application/octet-stream")])


def test_inspect_audio_stream_accepts_the_future_graphon_tts_chunk_shape() -> None:
    chunk = SimpleNamespace(data=b"RIFF\x24\x00\x00\x00WAVEfmt ", mime_type="audio/wav")

    stream, mime_type = inspect_audio_stream([chunk])

    assert mime_type == "audio/wav"
    assert list(stream) == [chunk.data]


def test_resolve_audio_mime_type_falls_back_to_the_declared_model_type() -> None:
    assert resolve_audio_mime_type(b"unrecognised", "audio/ogg") == "audio/ogg"


def test_model_audio_mime_type_normalizes_plugin_metadata() -> None:
    model_instance = SimpleNamespace(
        get_model_schema=lambda: SimpleNamespace(model_properties={ModelPropertyKey.AUDIO_TYPE: "audio/x-wav"})
    )

    assert get_model_audio_mime_type(cast(ModelInstance, model_instance)) == "audio/wav"


def test_only_mp3_supports_sentence_level_tts_playback() -> None:
    assert supports_incremental_tts_playback("audio/mpeg")
    assert not supports_incremental_tts_playback("audio/wav")
