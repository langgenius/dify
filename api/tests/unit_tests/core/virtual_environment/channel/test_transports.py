import os
import socket
import threading

import pytest

from core.virtual_environment.channel.exec import TransportEOFError
from core.virtual_environment.channel.pipe_transport import PipeReadCloser, PipeTransport, PipeWriteCloser
from core.virtual_environment.channel.queue_transport import QueueTransportReadCloser
from core.virtual_environment.channel.socket_transport import SocketReadCloser, SocketTransport, SocketWriteCloser


def _close_socket(sock: socket.socket) -> None:
    try:
        sock.close()
    except OSError:
        pass


def test_queue_transport_reads_across_chunks() -> None:
    transport = QueueTransportReadCloser()
    writer = transport.get_write_handler()
    writer.write(b"hello")
    writer.write(b"world")

    data = transport.read(8)
    assert data == b"hellowor"
    assert transport.read(2) == b"ld"


def test_queue_transport_reads_all_available_when_under_n() -> None:
    transport = QueueTransportReadCloser()
    writer = transport.get_write_handler()
    writer.write(b"hi")
    writer.write(b"there")

    assert transport.read(32) == b"hithere"


def test_queue_transport_blocks_until_first_chunk() -> None:
    transport = QueueTransportReadCloser()
    writer = transport.get_write_handler()
    started = threading.Event()
    done = threading.Event()
    result: list[bytes] = []
    errors: list[BaseException] = []

    def reader() -> None:
        started.set()
        try:
            result.append(transport.read(4))
        except BaseException as exc:
            errors.append(exc)
        finally:
            done.set()

    thread = threading.Thread(target=reader)
    thread.start()
    assert started.wait(timeout=1)
    assert not done.wait(timeout=0.1)

    writer.write(b"abcd")
    if not done.wait(timeout=1):
        transport.close()
    thread.join(timeout=1)
    assert not thread.is_alive()
    assert not errors
    assert result == [b"abcd"]


def test_queue_transport_returns_after_first_chunk_when_queue_empty() -> None:
    transport = QueueTransportReadCloser()
    writer = transport.get_write_handler()
    started = threading.Event()
    done = threading.Event()
    result: list[bytes] = []
    errors: list[BaseException] = []

    def reader() -> None:
        started.set()
        try:
            result.append(transport.read(10))
        except BaseException as exc:
            errors.append(exc)
        finally:
            done.set()

    thread = threading.Thread(target=reader)
    thread.start()
    assert started.wait(timeout=1)
    assert not done.wait(timeout=0.1)
    writer.write(b"abc")
    if not done.wait(timeout=1):
        transport.close()
    thread.join(timeout=1)
    assert not thread.is_alive()
    assert not errors
    assert result == [b"abc"]


def test_queue_transport_returns_buffer_without_blocking() -> None:
    transport = QueueTransportReadCloser()
    writer = transport.get_write_handler()
    writer.write(b"abcdef")

    assert transport.read(4) == b"abcd"

    result: list[bytes] = []
    errors: list[BaseException] = []

    def reader() -> None:
        try:
            result.append(transport.read(4))
        except BaseException as exc:
            errors.append(exc)

    thread = threading.Thread(target=reader)
    thread.start()
    thread.join(timeout=1)
    if thread.is_alive():
        transport.close()
        thread.join(timeout=1)
    assert not thread.is_alive()
    assert not errors
    assert result == [b"ef"]


def test_queue_transport_returns_data_before_eof() -> None:
    transport = QueueTransportReadCloser()
    writer = transport.get_write_handler()
    writer.write(b"end")
    transport.close()

    assert transport.read(10) == b"end"
    with pytest.raises(TransportEOFError):
        transport.read(1)


def test_queue_transport_close_then_read_raises() -> None:
    transport = QueueTransportReadCloser()
    transport.close()

    with pytest.raises(TransportEOFError):
        transport.read(1)


def test_queue_transport_close_twice_raises() -> None:
    transport = QueueTransportReadCloser()
    transport.close()

    with pytest.raises(TransportEOFError):
        transport.close()


def test_pipe_transport_roundtrip() -> None:
    r_fd, w_fd = os.pipe()
    transport = PipeTransport(r_fd, w_fd)
    try:
        transport.write(b"ping")
        assert transport.read(4) == b"ping"
    finally:
        transport.close()


def test_pipe_read_closer_eof_raises() -> None:
    r_fd, w_fd = os.pipe()
    os.close(w_fd)
    reader = PipeReadCloser(r_fd)
    try:
        with pytest.raises(TransportEOFError):
            reader.read(1)
    finally:
        reader.close()


def test_pipe_write_closer_eof_raises() -> None:
    r_fd, w_fd = os.pipe()
    os.close(r_fd)
    writer = PipeWriteCloser(w_fd)
    try:
        with pytest.raises(TransportEOFError):
            writer.write(b"x")
    finally:
        writer.close()


def test_socket_transport_roundtrip() -> None:
    sock_a, sock_b = socket.socketpair()
    sock_a_io = sock_a.makefile("rwb", buffering=0)
    sock_b_io = sock_b.makefile("rwb", buffering=0)
    transport_a = SocketTransport(sock_a_io)
    transport_b = SocketTransport(sock_b_io)
    try:
        transport_a.write(b"x")
        assert transport_b.read(1) == b"x"
    finally:
        transport_a.close()
        transport_b.close()
        _close_socket(sock_a)
        _close_socket(sock_b)


def test_socket_read_closer_eof_raises() -> None:
    sock_a, sock_b = socket.socketpair()
    sock_a_io = sock_a.makefile("rb", buffering=0)
    reader = SocketReadCloser(sock_a_io)
    try:
        sock_b.close()
        with pytest.raises(TransportEOFError):
            reader.read(1)
    finally:
        reader.close()
        _close_socket(sock_a)


def test_socket_write_closer_writes() -> None:
    sock_a, sock_b = socket.socketpair()
    sock_a_io = sock_a.makefile("wb", buffering=0)
    sock_b_io = sock_b.makefile("rb", buffering=0)
    writer = SocketWriteCloser(sock_a_io)
    reader = SocketReadCloser(sock_b_io)
    try:
        writer.write(b"y")
        assert reader.read(1) == b"y"
    finally:
        writer.close()
        reader.close()
        _close_socket(sock_a)
        _close_socket(sock_b)
