"""Create binary audio responses and own their stream cleanup."""

from flask import Response, stream_with_context

from core.base.tts.audio_mime import inspect_audio_stream, resolve_audio_mime_type
from services.audio_types import AudioOutput


def audio_binary_response(output: AudioOutput | None) -> Response | None:
    """Preserve audio MIME and request context while releasing provider streams."""
    if output is None:
        return None
    if isinstance(output.data, (bytes, bytearray, memoryview)):
        data = bytes(output.data)
        return Response(data, content_type=resolve_audio_mime_type(data, output.mime_type))

    audio_stream, mime_type = inspect_audio_stream(output.data, output.mime_type)
    try:
        response = Response(
            stream_with_context(audio_stream),  # pyrefly: ignore[no-matching-overload]
            content_type=mime_type,
        )
        response.call_on_close(audio_stream.close)
        return response
    except BaseException:
        audio_stream.close()
        raise
