import socket

from core.virtual_environment.channel.transport import Transport, TransportReadCloser, TransportWriteCloser


class SocketTransport(Transport):
    """
    A Transport implementation using a socket.
    """

    def __init__(self, sock: socket.SocketIO):
        self.sock = sock

    def write(self, data: bytes) -> None:
        self.sock.write(data)

    def read(self, n: int) -> bytes:
        return self.sock.read(n)

    def close(self) -> None:
        self.sock.close()


class SocketReadCloser(TransportReadCloser):
    """
    A Transport implementation using a socket for reading.
    """

    def __init__(self, sock: socket.SocketIO):
        self.sock = sock

    def read(self, n: int) -> bytes:
        return self.sock.read(n)

    def close(self) -> None:
        self.sock.close()


class SocketWriteCloser(TransportWriteCloser):
    """
    A Transport implementation using a socket for writing.
    """

    def __init__(self, sock: socket.SocketIO):
        self.sock = sock

    def write(self, data: bytes) -> None:
        self.sock.write(data)

    def close(self) -> None:
        self.sock.close()
