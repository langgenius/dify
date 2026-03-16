"""Tests for libs.websocket utilities."""

from collections.abc import Generator
from unittest.mock import MagicMock

from libs.websocket import stream_events_to_websocket


class TestStreamEventsToWebsocket:
    def test_blocking_dict_response(self):
        """Blocking (dict) responses are sent as a single JSON frame."""
        ws = MagicMock()
        response = {"event": "message", "answer": "hello"}

        stream_events_to_websocket(ws, response)

        ws.send.assert_called_once()
        import json

        sent = json.loads(ws.send.call_args[0][0])
        assert sent == response

    def test_streaming_dict_events(self):
        """Streaming dict events are forwarded as JSON text frames."""

        def gen() -> Generator:
            yield {"event": "message", "answer": "hi"}
            yield {"event": "message_end"}

        ws = MagicMock()
        stream_events_to_websocket(ws, gen())

        assert ws.send.call_count == 2
        import json

        first = json.loads(ws.send.call_args_list[0][0][0])
        assert first["event"] == "message"
        second = json.loads(ws.send.call_args_list[1][0][0])
        assert second["event"] == "message_end"

    def test_streaming_string_events(self):
        """String-only events (e.g. 'ping') are wrapped in a JSON envelope."""

        def gen() -> Generator:
            yield "ping"

        ws = MagicMock()
        stream_events_to_websocket(ws, gen())

        import json

        sent = json.loads(ws.send.call_args[0][0])
        assert sent == {"event": "ping"}

    def test_mixed_events(self):
        """Generator can yield both dict and string events."""

        def gen() -> Generator:
            yield "ping"
            yield {"event": "message", "answer": "world"}
            yield "ping"

        ws = MagicMock()
        stream_events_to_websocket(ws, gen())

        assert ws.send.call_count == 3

    def test_client_disconnect_handled_gracefully(self):
        """If the WebSocket client disconnects, the exception is caught."""

        def gen() -> Generator:
            yield {"event": "message", "answer": "hi"}
            yield {"event": "message_end"}

        ws = MagicMock()
        ws.send.side_effect = ConnectionError("client gone")

        # Should not raise
        stream_events_to_websocket(ws, gen())
