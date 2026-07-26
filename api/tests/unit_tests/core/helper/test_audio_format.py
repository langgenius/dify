from core.helper.audio_format import detect_audio_content_type


def _wav_header() -> bytes:
    return b"RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00"


def _mp3_frame_header() -> bytes:
    # 0xFF 0xFB = MPEG-1 Layer III, no CRC
    return b"\xff\xfb\x90\x00\x00\x00\x00\x00\x00\x00\x00\x00"


def _mp3_id3_header() -> bytes:
    return b"ID3\x03\x00\x00\x00\x00\x00\x00"


def _ogg_header() -> bytes:
    return b"OggS\x00\x02\x00\x00\x00\x00\x00\x00"


def test_detect_wav_content_type() -> None:
    stream = iter([_wav_header(), b"audio data chunk"])
    replay, content_type = detect_audio_content_type(stream)
    assert content_type == "audio/wav"
    chunks = list(replay)
    assert b"".join(chunks) == _wav_header() + b"audio data chunk"


def test_detect_mp3_frame_sync_content_type() -> None:
    stream = iter([_mp3_frame_header(), b"more mp3 data"])
    replay, content_type = detect_audio_content_type(stream)
    assert content_type == "audio/mpeg"
    chunks = list(replay)
    assert b"".join(chunks) == _mp3_frame_header() + b"more mp3 data"


def test_detect_mp3_id3_content_type() -> None:
    stream = iter([_mp3_id3_header(), b"mp3 body"])
    replay, content_type = detect_audio_content_type(stream)
    assert content_type == "audio/mpeg"
    chunks = list(replay)
    assert _mp3_id3_header() in b"".join(chunks)


def test_detect_ogg_content_type() -> None:
    stream = iter([_ogg_header(), b"ogg data"])
    replay, content_type = detect_audio_content_type(stream)
    assert content_type == "audio/ogg"


def test_unknown_format_defaults_to_mpeg() -> None:
    stream = iter([b"\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b", b"rest"])
    replay, content_type = detect_audio_content_type(stream)
    assert content_type == "audio/mpeg"


def test_small_chunks_are_accumulated() -> None:
    """The helper should accumulate small chunks until it has enough magic bytes."""
    header = _wav_header()
    # Split the WAV header into 2-byte chunks.
    chunks = [header[i : i + 2] for i in range(0, len(header), 2)]
    chunks.append(b"payload")
    stream = iter(chunks)
    replay, content_type = detect_audio_content_type(stream)
    assert content_type == "audio/wav"
    rebuilt = b"".join(replay)
    assert header + b"payload" in rebuilt


def test_empty_stream() -> None:
    replay, content_type = detect_audio_content_type(iter([]))
    assert content_type == "audio/mpeg"
    assert list(replay) == []


def test_replay_preserves_all_data() -> None:
    """No data should be lost — the full stream must be reconstructable."""
    data = [_wav_header(), b"chunk1", b"", b"chunk2"]
    stream = iter(data)
    replay, content_type = detect_audio_content_type(stream)
    assert content_type == "audio/wav"
    rebuilt = b"".join(replay)
    assert _wav_header() in rebuilt
    assert b"chunk1" in rebuilt
    assert b"chunk2" in rebuilt
