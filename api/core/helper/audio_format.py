"""Audio format helpers for sniffing the real MIME type of TTS streams.

TTS providers return raw ``bytes`` chunks with no accompanying content-type,
so the HTTP layer cannot know upfront whether the stream is MP3, WAV, OGG, etc.
Some providers (e.g. Tongyi ``qwen-tts``) emit WAV/PCM even when the HTTP
response was advertised as ``audio/mpeg``, which browsers refuse to play.

``detect_audio_content_type`` peeks at the leading magic bytes of the first
chunk and returns the matching MIME type, defaulting to ``audio/mpeg`` when the
signature is unknown so that MP3-producing providers keep working unchanged.
"""

from collections.abc import Generator, Iterable

# Minimum bytes needed to disambiguate the supported audio formats.
_MIN_MAGIC_BYTES = 12


def _sniff_content_type(first_chunk: bytes) -> str:
    """Return the MIME type implied by *first_chunk*'s magic bytes.

    Falls back to ``audio/mpeg`` when the signature is not recognised, matching
    the historical behaviour for MP3-only providers.
    """
    if len(first_chunk) >= 4 and first_chunk[:4] == b"RIFF" and first_chunk[8:12] == b"WAVE":
        return "audio/wav"
    if len(first_chunk) >= 4 and first_chunk[:4] == b"OggS":
        return "audio/ogg"
    if len(first_chunk) >= 2 and first_chunk[0] == 0xFF and (first_chunk[1] & 0xE0) == 0xE0:
        # MP3 frame sync (11 set bits).
        return "audio/mpeg"
    if len(first_chunk) >= 3 and first_chunk[:3] == b"ID3":
        # MP3 with an in-band ID3 metadata header.
        return "audio/mpeg"
    return "audio/mpeg"


def detect_audio_content_type(
    audio_stream: Iterable[bytes],
) -> tuple[Generator[bytes], str]:
    """Detect the content type of an audio byte stream by peeking at its head.

    Consumes only the first chunk (or accumulates up to ``_MIN_MAGIC_BYTES``
    bytes across small chunks) so the rest of the stream can be yielded to the
    caller without re-fetching from the provider.

    Returns a generator that replays the sniffed bytes followed by the remainder
    of *audio_stream*, plus the detected MIME content type.
    """
    iterator = iter(audio_stream)
    buffered = bytearray()
    content_type = "audio/mpeg"

    for chunk in iterator:
        if not chunk:
            continue
        buffered.extend(chunk)
        if len(buffered) >= _MIN_MAGIC_BYTES:
            content_type = _sniff_content_type(bytes(buffered))
            break
    else:
        # Stream ended before we had enough bytes; sniff what we have.
        if buffered:
            content_type = _sniff_content_type(bytes(buffered))

    def _replay() -> Generator[bytes]:
        if buffered:
            yield bytes(buffered)
        yield from iterator

    return _replay(), content_type
