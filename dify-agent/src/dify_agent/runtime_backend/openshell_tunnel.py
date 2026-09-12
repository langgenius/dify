"""Local TCP listener bridging shellctl HTTP to an OpenShell ForwardTcp tunnel.

OpenShell exposes services running inside a sandbox only through its gateway
gRPC API. ``ForwardTcp`` is an authenticated bidirectional byte stream to one
loopback port inside the sandbox, so plain HTTP clients cannot use it
directly. This module runs a loopback TCP listener and pipes every accepted
connection through its own ``ForwardTcp`` stream, which lets the unmodified
shellctl HTTP client talk to the in-sandbox shellctl daemon.

The gateway caps concurrent streams at 3 per SSH-session token; callers must
bound their HTTP connection pool accordingly.
"""

from __future__ import annotations

import logging
import queue
import socket
import threading
from collections.abc import Iterator
from typing import Protocol

logger = logging.getLogger(__name__)

_RECV_CHUNK_BYTES = 65536
_LISTEN_BACKLOG = 16


def _shutdown_and_close(sock: socket.socket) -> None:
    """Wake any thread blocked on this socket, then close it.

    On Linux ``close()`` alone neither interrupts a thread blocked in
    ``recv()``/``accept()`` nor sends FIN while that syscall pins the open
    file description, so teardown must ``shutdown()`` first. macOS wakes
    blocked callers on ``close()`` and rejects ``shutdown()`` on a listening
    socket with ENOTCONN, hence the best-effort handling of both calls.
    """
    try:
        sock.shutdown(socket.SHUT_RDWR)
    except OSError:
        pass
    try:
        sock.close()
    except OSError:
        pass


class ForwardTcpFrame(Protocol):
    data: bytes


class ForwardTcpCall(Protocol):
    """One live ForwardTcp stream: response iterator plus cancellation."""

    def __iter__(self) -> Iterator[ForwardTcpFrame]: ...

    def cancel(self) -> bool: ...


class ForwardTcpStreamFactory(Protocol):
    """Open one ForwardTcp stream from an outgoing frame iterator."""

    def __call__(self, request_iterator: Iterator[object]) -> ForwardTcpCall: ...


class ForwardTcpFrameCodec(Protocol):
    """Build the wire frames for one tunnel (init routing plus data)."""

    def init_frame(self) -> object: ...

    def data_frame(self, data: bytes) -> object: ...


class ForwardTcpTunnel:
    """Loopback listener that opens one ForwardTcp stream per TCP connection."""

    def __init__(self, *, stream_factory: ForwardTcpStreamFactory, frame_codec: ForwardTcpFrameCodec) -> None:
        self._stream_factory = stream_factory
        self._frame_codec = frame_codec
        self._listener: socket.socket | None = None
        self._closed = threading.Event()
        self._connections: set[socket.socket] = set()
        self._lock = threading.Lock()

    def open(self) -> str:
        """Bind a loopback listener and return its ``http://`` base URL."""
        if self._listener is not None:
            raise RuntimeError("ForwardTcpTunnel is already open")
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(("127.0.0.1", 0))
        listener.listen(_LISTEN_BACKLOG)
        self._listener = listener
        port = listener.getsockname()[1]
        threading.Thread(target=self._accept_loop, name="openshell-tunnel-accept", daemon=True).start()
        return f"http://127.0.0.1:{port}"

    def close(self) -> None:
        """Stop accepting and tear down every live connection. Idempotent."""
        self._closed.set()
        listener = self._listener
        if listener is not None:
            _shutdown_and_close(listener)
        with self._lock:
            connections = list(self._connections)
            self._connections.clear()
        for connection in connections:
            _shutdown_and_close(connection)

    def _accept_loop(self) -> None:
        listener = self._listener
        if listener is None:
            return
        while not self._closed.is_set():
            try:
                connection, _ = listener.accept()
            except OSError:
                return
            connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            with self._lock:
                # Re-check under the lock: a connection accepted concurrently
                # with close() must not slip past its teardown snapshot and
                # leak one of the gateway's per-token stream slots.
                if self._closed.is_set():
                    try:
                        connection.close()
                    except OSError:
                        pass
                    return
                self._connections.add(connection)
            threading.Thread(
                target=self._pump_connection,
                args=(connection,),
                name="openshell-tunnel-conn",
                daemon=True,
            ).start()

    def _pump_connection(self, connection: socket.socket) -> None:
        outgoing: queue.Queue[bytes | None] = queue.Queue()

        def request_iterator() -> Iterator[object]:
            yield self._frame_codec.init_frame()
            while True:
                item = outgoing.get()
                if item is None:
                    return
                yield self._frame_codec.data_frame(item)

        try:
            call = self._stream_factory(request_iterator())
        except Exception:
            logger.warning("failed to open OpenShell ForwardTcp stream", exc_info=True)
            self._discard_connection(connection)
            return

        def pump_up() -> None:
            try:
                while True:
                    data = connection.recv(_RECV_CHUNK_BYTES)
                    if not data:
                        break
                    outgoing.put(data)
            except OSError:
                pass
            finally:
                outgoing.put(None)

        threading.Thread(target=pump_up, name="openshell-tunnel-up", daemon=True).start()
        try:
            for frame in call:
                if frame.data:
                    connection.sendall(frame.data)
        except Exception:
            if not self._closed.is_set():
                logger.warning("OpenShell ForwardTcp stream ended with an error", exc_info=True)
        finally:
            _ = call.cancel()
            self._discard_connection(connection)

    def _discard_connection(self, connection: socket.socket) -> None:
        with self._lock:
            self._connections.discard(connection)
        _shutdown_and_close(connection)


__all__ = [
    "ForwardTcpCall",
    "ForwardTcpFrame",
    "ForwardTcpFrameCodec",
    "ForwardTcpStreamFactory",
    "ForwardTcpTunnel",
]
