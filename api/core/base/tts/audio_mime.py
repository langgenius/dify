import logging
from collections.abc import Generator, Iterable, Iterator
from itertools import chain
from typing import TYPE_CHECKING, override

from core.plugin.entities.plugin_daemon import TTSAudioChunk
from graphon.model_runtime.entities.model_entities import ModelPropertyKey
from graphon.model_runtime.errors.invoke import InvokeBadRequestError
from libs.stream import close_stream

if TYPE_CHECKING:
    from core.model_manager import ModelInstance


logger = logging.getLogger(__name__)

DEFAULT_TTS_AUDIO_MIME_TYPE = "audio/mpeg"
_SIGNATURE_SIZE = 32
_AUDIO_MIME_TYPE_ALIASES = {
    "mp3": "audio/mpeg",
    "audio/mp3": "audio/mpeg",
    "audio/mpeg": "audio/mpeg",
    "wav": "audio/wav",
    "wave": "audio/wav",
    "audio/wav": "audio/wav",
    "audio/wave": "audio/wav",
    "audio/x-wav": "audio/wav",
    "ogg": "audio/ogg",
    "oga": "audio/ogg",
    "audio/ogg": "audio/ogg",
    "flac": "audio/flac",
    "audio/flac": "audio/flac",
    "aac": "audio/aac",
    "audio/aac": "audio/aac",
    "m4a": "audio/mp4",
    "mp4": "audio/mp4",
    "audio/mp4": "audio/mp4",
    "webm": "audio/webm",
    "audio/webm": "audio/webm",
}
SUPPORTED_TTS_AUDIO_MIME_TYPES = tuple(sorted(set(_AUDIO_MIME_TYPE_ALIASES.values())))


def normalize_audio_mime_type(audio_type: object | None) -> str | None:
    """Convert provider audio-type metadata into a browser MIME type."""
    if not isinstance(audio_type, str):
        return None

    mime_type = audio_type.split(";", maxsplit=1)[0].strip().lower()
    return _AUDIO_MIME_TYPE_ALIASES.get(mime_type)


def get_model_audio_mime_type(model_instance: "ModelInstance") -> str | None:
    """Read the model's declared TTS MIME type without making it mandatory."""
    try:
        model_schema = model_instance.get_model_schema()
        audio_type = model_schema.model_properties.get(ModelPropertyKey.AUDIO_TYPE)
    except Exception:
        logger.debug("Unable to resolve the declared audio type for the TTS model", exc_info=True)
        return None

    return normalize_audio_mime_type(audio_type)


def sniff_audio_mime_type(audio: bytes | bytearray | memoryview) -> str | None:
    """Identify common audio containers from their leading bytes."""
    signature = bytes(audio[:_SIGNATURE_SIZE])
    if len(signature) >= 12 and signature[:4] == b"RIFF" and signature[8:12] == b"WAVE":
        return "audio/wav"
    if signature.startswith(b"OggS"):
        return "audio/ogg"
    if signature.startswith(b"fLaC"):
        return "audio/flac"
    if signature.startswith(b"\x1aE\xdf\xa3"):
        return "audio/webm"
    if len(signature) >= 8 and signature[4:8] == b"ftyp":
        return "audio/mp4"
    if len(signature) >= 2 and signature[0] == 0xFF:
        if signature[1] & 0xF6 == 0xF0:
            return "audio/aac"
        if signature[1] & 0xE0 == 0xE0:
            return "audio/mpeg"
    return None


def _normalize_reported_mime_type(mime_type: object | None, source: str) -> str | None:
    if mime_type is None:
        return None

    normalized_mime_type = normalize_audio_mime_type(mime_type)
    if normalized_mime_type is None:
        raise InvokeBadRequestError(f"TTS provider returned an unsupported {source} MIME type: {mime_type!r}")
    return normalized_mime_type


def _extract_audio_chunk(chunk: bytes | bytearray | memoryview | TTSAudioChunk) -> tuple[bytes, str | None]:
    """Accept old byte chunks and the compatibility carrier for current Graphon."""
    if isinstance(chunk, TTSAudioChunk):
        return bytes(chunk), chunk.mime_type

    if isinstance(chunk, (bytes, bytearray, memoryview)):
        return bytes(chunk), None

    raise InvokeBadRequestError("TTS provider returned a chunk that is not audio bytes")


def resolve_audio_mime_type(
    audio: bytes | bytearray | memoryview,
    declared_mime_type: str | None = None,
    reported_mime_type: str | None = None,
) -> str:
    """Validate the provider MIME against magic bytes and choose the true type.

    ``reported_mime_type`` is emitted with a TTS chunk by current plugin
    runtimes, and therefore takes precedence over schema metadata. Schema
    metadata remains a fallback for old plugins that omit the new field.
    """
    normalized_declared_mime_type = _normalize_reported_mime_type(declared_mime_type, "schema")
    normalized_reported_mime_type = _normalize_reported_mime_type(reported_mime_type, "chunk")
    detected_mime_type = sniff_audio_mime_type(audio)

    expected_mime_type = normalized_reported_mime_type or normalized_declared_mime_type
    if expected_mime_type and detected_mime_type and expected_mime_type != detected_mime_type:
        raise InvokeBadRequestError(
            "TTS provider output MIME does not match its audio bytes: "
            f"declared {expected_mime_type}, detected {detected_mime_type}"
        )

    if normalized_reported_mime_type:
        if normalized_declared_mime_type and normalized_declared_mime_type != normalized_reported_mime_type:
            logger.info(
                "TTS chunk MIME %s overrides schema MIME %s",
                normalized_reported_mime_type,
                normalized_declared_mime_type,
            )
        return normalized_reported_mime_type

    if detected_mime_type:
        return detected_mime_type

    return normalized_declared_mime_type or DEFAULT_TTS_AUDIO_MIME_TYPE


type _AudioChunk = bytes | bytearray | memoryview | TTSAudioChunk


class AudioStream(Iterator[bytes]):
    """Own a MIME-checked stream, including resources opened while peeking."""

    def __init__(
        self, chunks: Generator[bytes, None, None], *, source: Iterable[_AudioChunk], iterator: Iterator[_AudioChunk]
    ) -> None:
        self._chunks: Generator[bytes, None, None] = chunks
        self._source: Iterable[_AudioChunk] = source
        self._iterator: Iterator[_AudioChunk] = iterator
        self._closed: bool = False

    @override
    def __next__(self) -> bytes:
        try:
            return next(self._chunks)
        except BaseException:
            self.close()
            raise

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        # The validation generator may never have started, but peeking has
        # already opened the provider. Close its source explicitly as well.
        close_stream(self._chunks)
        close_stream(self._iterator)
        if self._source is not self._iterator:
            close_stream(self._source)


def inspect_audio_stream(
    audio_stream: Iterable[_AudioChunk], declared_mime_type: str | None = None
) -> tuple[AudioStream, str]:
    """Peek and validate without dropping bytes; the returned stream owns cleanup."""
    iterator: Iterator[_AudioChunk] | None = None
    leading_chunks: list[bytes] = []
    signature = bytearray()
    reported_mime_type: str | None = None

    try:
        iterator = iter(audio_stream)
        while len(signature) < _SIGNATURE_SIZE:
            try:
                chunk, chunk_mime_type = _extract_audio_chunk(next(iterator))
            except StopIteration:
                break
            normalized_chunk_mime_type = _normalize_reported_mime_type(chunk_mime_type, "chunk")
            if normalized_chunk_mime_type:
                if reported_mime_type and reported_mime_type != normalized_chunk_mime_type:
                    raise InvokeBadRequestError(
                        "TTS provider changed MIME type within one audio response: "
                        f"{reported_mime_type} then {normalized_chunk_mime_type}"
                    )
                reported_mime_type = normalized_chunk_mime_type
            leading_chunks.append(chunk)
            signature.extend(chunk[: _SIGNATURE_SIZE - len(signature)])

        mime_type = resolve_audio_mime_type(signature, declared_mime_type, reported_mime_type)
    except BaseException:
        close_stream(iterator)
        if audio_stream is not iterator:
            close_stream(audio_stream)
        raise

    def validated_stream() -> Generator[bytes, None, None]:
        for chunk in chain(leading_chunks, iterator):
            audio, chunk_mime_type = _extract_audio_chunk(chunk)
            normalized_chunk_mime_type = _normalize_reported_mime_type(chunk_mime_type, "chunk")
            if normalized_chunk_mime_type and normalized_chunk_mime_type != mime_type:
                raise InvokeBadRequestError(
                    "TTS provider changed MIME type within one audio response: "
                    f"{mime_type} then {normalized_chunk_mime_type}"
                )
            yield audio

    return AudioStream(validated_stream(), source=audio_stream, iterator=iterator), mime_type
