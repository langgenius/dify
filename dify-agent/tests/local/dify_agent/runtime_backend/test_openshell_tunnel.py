from __future__ import annotations

import socket
import threading
from collections.abc import Iterator
from dataclasses import dataclass, field

import pytest

from dify_agent.runtime_backend.openshell_tunnel import ForwardTcpTunnel


@dataclass(slots=True)
class _Frame:
    data: bytes = b""
    init: object | None = None


@dataclass(slots=True)
class _Codec:
    init_frames: list[_Frame] = field(default_factory=list)

    def init_frame(self) -> _Frame:
        frame = _Frame(init=object())
        self.init_frames.append(frame)
        return frame

    def data_frame(self, data: bytes) -> _Frame:
        return _Frame(data=data)


@dataclass(slots=True)
class _EchoCall:
    """Fake ForwardTcp stream: echoes each data frame back uppercased."""

    request_iterator: Iterator[object]
    cancelled: int = 0
    saw_init_first: bool = False

    def __iter__(self) -> Iterator[_Frame]:
        for index, frame in enumerate(self.request_iterator):
            assert isinstance(frame, _Frame)
            if index == 0:
                self.saw_init_first = frame.init is not None
                continue
            yield _Frame(data=frame.data.upper())

    def cancel(self) -> bool:
        self.cancelled += 1
        return True


@dataclass(slots=True)
class _StreamFactory:
    calls: list[_EchoCall] = field(default_factory=list)

    def __call__(self, request_iterator: Iterator[object]) -> _EchoCall:
        call = _EchoCall(request_iterator=request_iterator)
        self.calls.append(call)
        return call


def _roundtrip(base_url: str, payload: bytes) -> bytes:
    host, port = base_url.removeprefix("http://").split(":")
    with socket.create_connection((host, int(port)), timeout=5) as connection:
        connection.sendall(payload)
        connection.shutdown(socket.SHUT_WR)
        received = b""
        while True:
            chunk = connection.recv(65536)
            if not chunk:
                return received
            received += chunk


def test_tunnel_opens_one_stream_per_connection_and_pipes_bytes() -> None:
    factory = _StreamFactory()
    codec = _Codec()
    tunnel = ForwardTcpTunnel(stream_factory=factory, frame_codec=codec)
    try:
        base_url = tunnel.open()
        assert base_url.startswith("http://127.0.0.1:")

        assert _roundtrip(base_url, b"hello") == b"HELLO"
        assert _roundtrip(base_url, b"again") == b"AGAIN"

        assert len(factory.calls) == 2
        assert all(call.saw_init_first for call in factory.calls)
        assert len(codec.init_frames) == 2
    finally:
        tunnel.close()


def test_tunnel_handles_concurrent_connections() -> None:
    factory = _StreamFactory()
    tunnel = ForwardTcpTunnel(stream_factory=factory, frame_codec=_Codec())
    try:
        base_url = tunnel.open()
        results: list[bytes] = [b""] * 4

        def worker(index: int) -> None:
            results[index] = _roundtrip(base_url, f"msg-{index}".encode())

        threads = [threading.Thread(target=worker, args=(index,)) for index in range(4)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)
        assert results == [b"MSG-0", b"MSG-1", b"MSG-2", b"MSG-3"]
        assert len(factory.calls) == 4
    finally:
        tunnel.close()


def test_tunnel_close_is_idempotent_and_rejects_new_connections() -> None:
    tunnel = ForwardTcpTunnel(stream_factory=_StreamFactory(), frame_codec=_Codec())
    base_url = tunnel.open()
    tunnel.close()
    tunnel.close()

    host, port = base_url.removeprefix("http://").split(":")
    with pytest.raises(OSError):
        connection = socket.create_connection((host, int(port)), timeout=1)
        # macOS may accept into the closed listener's backlog; a read still
        # observes the shutdown.
        connection.settimeout(1)
        try:
            if connection.recv(1) != b"":
                raise AssertionError("expected EOF from closed tunnel")
            raise ConnectionResetError("closed")
        finally:
            connection.close()


def test_tunnel_half_close_still_delivers_remaining_bytes() -> None:
    """Client write-half close must not drop bytes already queued from the stream."""

    @dataclass(slots=True)
    class _HalfCloseCall:
        request_iterator: Iterator[object]
        cancelled: int = 0

        def __iter__(self) -> Iterator[_Frame]:
            for frame in self.request_iterator:
                assert isinstance(frame, _Frame)
                if frame.init is not None:
                    continue
                yield _Frame(data=frame.data.upper())
                yield _Frame(data=b"-TAIL")

        def cancel(self) -> bool:
            self.cancelled += 1
            return True

    def factory(request_iterator: Iterator[object]) -> _HalfCloseCall:
        return _HalfCloseCall(request_iterator)

    tunnel = ForwardTcpTunnel(stream_factory=factory, frame_codec=_Codec())
    try:
        base_url = tunnel.open()
        host, port = base_url.removeprefix("http://").split(":")
        with socket.create_connection((host, int(port)), timeout=5) as connection:
            connection.sendall(b"hi")
            connection.shutdown(socket.SHUT_WR)
            received = b""
            while True:
                chunk = connection.recv(65536)
                if not chunk:
                    break
                received += chunk
        assert received == b"HI-TAIL"
    finally:
        tunnel.close()


def test_tunnel_stream_error_closes_the_client_connection() -> None:
    @dataclass(slots=True)
    class _ErrorCall:
        request_iterator: Iterator[object]

        def __iter__(self) -> Iterator[_Frame]:
            _ = next(self.request_iterator)
            raise RuntimeError("stream reset")

        def cancel(self) -> bool:
            return True

    def factory(request_iterator: Iterator[object]) -> _ErrorCall:
        return _ErrorCall(request_iterator)

    tunnel = ForwardTcpTunnel(stream_factory=factory, frame_codec=_Codec())
    try:
        base_url = tunnel.open()
        host, port = base_url.removeprefix("http://").split(":")
        with socket.create_connection((host, int(port)), timeout=5) as connection:
            connection.sendall(b"ping")
            connection.settimeout(2)
            assert connection.recv(1) == b""
    finally:
        tunnel.close()


def test_tunnel_open_twice_is_an_error() -> None:
    tunnel = ForwardTcpTunnel(stream_factory=_StreamFactory(), frame_codec=_Codec())
    try:
        _ = tunnel.open()
        with pytest.raises(RuntimeError, match="already open"):
            _ = tunnel.open()
    finally:
        tunnel.close()
