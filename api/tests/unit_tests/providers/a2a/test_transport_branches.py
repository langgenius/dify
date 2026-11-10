"""Resource bounds retain permits until real response streams close."""

from collections.abc import Iterator
from threading import Event
from typing import override

import httpx
import pytest

from providers.a2a.transport import BoundedTransport, TransportError
from tests.unit_tests.providers.a2a.test_gateway import RecordingRequester


@pytest.mark.parametrize(("timeout", "limit"), [(0.0, 10), (float("nan"), 10), (float("inf"), 10), (1.0, 0)])
def test_invalid_deadline_or_byte_budget_never_acquires_network_io(timeout: float, limit: int) -> None:
    requester = RecordingRequester([])
    transport = BoundedTransport(requester)
    with pytest.raises(TransportError) as failure:
        transport.request(
            "GET", "https://agent.example", headers={}, body=None, timeout_seconds=timeout, max_bytes=limit
        )
    assert failure.value.code == "deadline_exceeded"
    assert not requester.requests


@pytest.mark.parametrize(
    ("headers", "body", "code"),
    [
        ({"content-encoding": "gzip"}, b"compressed", "unsupported_content_encoding"),
        ({"content-length": "unknown"}, b"body", "response_too_large"),
        ({"content-length": "11"}, b"body", "response_too_large"),
        ({}, b"12345678901", "response_too_large"),
    ],
)
def test_encoding_and_size_failures_close_the_response_without_retries(
    headers: dict[str, str], body: bytes, code: str
) -> None:
    response = httpx.Response(200, stream=httpx.ByteStream(body), headers=headers)
    requester = RecordingRequester([response])
    transport = BoundedTransport(requester)
    with pytest.raises(TransportError) as failure:
        transport.request("GET", "https://agent.example", headers={}, body=None, timeout_seconds=1, max_bytes=10)
    assert failure.value.code == code
    assert response.is_closed
    assert len(requester.requests) == 1


class HeldStream(httpx.SyncByteStream):
    """Model a socket whose reader has received a prefix but has not drained."""

    def __init__(self) -> None:
        self.started, self.release, self.closed = Event(), Event(), Event()

    @override
    def __iter__(self) -> Iterator[bytes]:
        yield b"first"
        self.started.set()
        assert self.release.wait(timeout=2)
        yield b"late"

    @override
    def close(self) -> None:
        self.closed.set()


@pytest.mark.parametrize("streaming", [False, True])
def test_cutoff_does_not_release_capacity_before_the_underlying_reader_drains(streaming: bool) -> None:
    stream = HeldStream()
    response = httpx.Response(200, stream=stream)
    requester = RecordingRequester([response])
    transport = BoundedTransport(requester, max_concurrent_io=1)
    try:
        if streaming:
            reply = transport.request(
                "GET",
                "https://agent.example",
                headers={},
                body=None,
                timeout_seconds=0.25,
                max_bytes=10,
                streaming=True,
            )
            assert reply.listen_window_ended
            assert reply.body == b"first"
        else:
            with pytest.raises(TransportError) as timeout:
                transport.request(
                    "GET", "https://agent.example", headers={}, body=None, timeout_seconds=0.25, max_bytes=10
                )
            assert timeout.value.code == "deadline_exceeded"
        assert stream.started.is_set()
        with pytest.raises(TransportError) as busy:
            transport.request("GET", "https://agent.example", headers={}, body=None, timeout_seconds=1, max_bytes=10)
        assert busy.value.code == "io_capacity_exhausted"
        assert len(requester.requests) == 1
        assert not stream.closed.is_set()
    finally:
        stream.release.set()
        assert stream.closed.wait(timeout=1)


def test_transport_rejects_nonpositive_capacity() -> None:
    with pytest.raises(ValueError, match="positive"):
        BoundedTransport(RecordingRequester([]), max_concurrent_io=0)
