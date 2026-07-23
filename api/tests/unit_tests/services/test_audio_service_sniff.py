"""Tests for the TTS response content-type sniffing in audio_service."""

from collections.abc import Generator

import pytest
from flask import Flask

from services.audio_service import _sniff_audio_content_type, _stream_audio_with_sniffed_type

WAV_HEADER = b"RIFF\x24\x00\x00\x00WAVEfmt "
MP3_ID3 = b"ID3\x03\x00\x00\x00\x00\x00\x00"
MP3_FRAME = b"\xff\xfb\x90\x00"
OGG_HEADER = b"OggS\x00\x02"
FLAC_HEADER = b'fLaC\x00\x00\x00"'


@pytest.fixture(autouse=True)
def _request_context():
    """stream_with_context requires an active request context."""
    ctx = Flask(__name__).test_request_context()
    ctx.push()
    yield
    ctx.pop()


class TestSniffAudioContentType:
    def test_wav(self):
        assert _sniff_audio_content_type(WAV_HEADER) == "audio/wav"

    def test_mp3_id3_and_frame_sync(self):
        assert _sniff_audio_content_type(MP3_ID3) == "audio/mpeg"
        assert _sniff_audio_content_type(MP3_FRAME) == "audio/mpeg"

    def test_ogg_and_flac(self):
        assert _sniff_audio_content_type(OGG_HEADER) == "audio/ogg"
        assert _sniff_audio_content_type(FLAC_HEADER) == "audio/flac"

    def test_unknown_falls_back_to_mpeg(self):
        assert _sniff_audio_content_type(b"\x00\x01\x02\x03") == "audio/mpeg"

    def test_short_chunk_falls_back_to_mpeg(self):
        assert _sniff_audio_content_type(b"RIFF") == "audio/mpeg"


class TestStreamAudioWithSniffedType:
    def _gen(self, chunks: list[bytes]) -> Generator:
        yield from chunks

    def test_wav_stream_gets_wav_type_and_keeps_bytes(self):
        chunks = [WAV_HEADER, b"data-1", b"data-2"]
        resp = _stream_audio_with_sniffed_type(self._gen(chunks))
        assert resp.content_type == "audio/wav"
        assert b"".join(resp.response) == b"".join(chunks)

    def test_mp3_stream_gets_mpeg_type(self):
        resp = _stream_audio_with_sniffed_type(self._gen([MP3_ID3, b"payload"]))
        assert resp.content_type == "audio/mpeg"

    def test_empty_stream_keeps_mpeg_default(self):
        resp = _stream_audio_with_sniffed_type(self._gen([]))
        assert resp.content_type == "audio/mpeg"

    def test_first_chunk_is_not_dropped(self):
        chunks = [OGG_HEADER, b"x" * 100]
        resp = _stream_audio_with_sniffed_type(self._gen(chunks))
        streamed = list(resp.response)
        assert streamed == chunks
