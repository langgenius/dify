from types import SimpleNamespace
from typing import cast

import pytest

from core.base.tts.audio_mime import (
    get_model_audio_mime_type,
    inspect_audio_stream,
    resolve_audio_mime_type,
    sniff_audio_mime_type,
)
from core.model_manager import ModelInstance
from core.plugin.entities.plugin_daemon import TTSAudioChunk
from graphon.model_runtime.entities.model_entities import ModelPropertyKey
from graphon.model_runtime.errors.invoke import InvokeBadRequestError


def test_inspect_audio_stream_preserves_the_prefix_with_matching_chunk_mime_type() -> None:
    chunks = [b"RIFF\x24\x00\x00\x00", b"WAVEfmt ", b"audio-data"]

    stream, mime_type = inspect_audio_stream(
        iter([TTSAudioChunk(chunk, "audio/wav") for chunk in chunks]), "audio/mpeg"
    )

    assert mime_type == "audio/wav"
    assert list(stream) == chunks


def test_inspect_audio_stream_rejects_mime_magic_mismatch() -> None:
    with pytest.raises(InvokeBadRequestError, match="declared audio/mpeg, detected audio/wav"):
        inspect_audio_stream([TTSAudioChunk(b"RIFF\x24\x00\x00\x00WAVEfmt ", "audio/mpeg")])


def test_inspect_audio_stream_rejects_unsupported_reported_mime_type() -> None:
    with pytest.raises(InvokeBadRequestError, match="unsupported chunk MIME type"):
        inspect_audio_stream([TTSAudioChunk(b"audio", "application/octet-stream")])


def test_resolve_audio_mime_type_falls_back_to_the_declared_model_type() -> None:
    assert resolve_audio_mime_type(b"unrecognised", "audio/ogg") == "audio/ogg"


def test_model_audio_mime_type_normalizes_plugin_metadata() -> None:
    model_instance = SimpleNamespace(
        get_model_schema=lambda: SimpleNamespace(model_properties={ModelPropertyKey.AUDIO_TYPE: "audio/x-wav"})
    )

    assert get_model_audio_mime_type(cast(ModelInstance, model_instance)) == "audio/wav"


@pytest.mark.parametrize(
    ("signature", "mime_type"),
    [
        (b"\xff\xfb" + b"\x00" * 30, "audio/mpeg"),
        (b"\xff\xf1" + b"\x00" * 30, "audio/aac"),
    ],
)
def test_sniff_audio_mime_type_distinguishes_mp3_frames_from_adts(signature: bytes, mime_type: str) -> None:
    assert sniff_audio_mime_type(signature) == mime_type


def test_id3_metadata_is_not_treated_as_proof_of_an_mp3_codec() -> None:
    signature = b"ID3" + b"\x00" * 29

    assert sniff_audio_mime_type(signature) is None
    assert resolve_audio_mime_type(signature, reported_mime_type="audio/aac") == "audio/aac"
