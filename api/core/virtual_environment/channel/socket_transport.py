import socket

from core.virtual_environment.channel.exec import TransportEOFError
from core.virtual_environment.channel.transport import Transport, TransportReadCloser, TransportWriteCloser


class SocketTransport(Transport):
    """
    A Transport implementation using a socket.
    """

    def __init__(self, sock: socket.SocketIO):
        self.sock = sock

    def write(self, data: bytes) -> None:
        try:
            self.sock.write(data)
        except (ConnectionResetError, BrokenPipeError):
            raise TransportEOFError("Socket write error, maybe the read end is closed")

    def read(self, n: int) -> bytes:
        try:
            data = self.sock.read(n)
            if data == b"":
                raise TransportEOFError("End of Socket reached")
        except (ConnectionResetError, BrokenPipeError):
            raise TransportEOFError("Socket connection reset")
        return data

    def close(self) -> None:
        self.sock.close()


class SocketReadCloser(TransportReadCloser):
    """
    A Transport implementation using a socket for reading.
    """

    def __init__(self, sock: socket.SocketIO):
        self.sock = sock

    def read(self, n: int) -> bytes:
        try:
            data = self.sock.read(n)
            if data == b"":
                raise TransportEOFError("End of Socket reached")
            return data
        except (ConnectionResetError, BrokenPipeError):
            raise TransportEOFError("Socket connection reset")

    def close(self) -> None:
        self.sock.close()


class SocketWriteCloser(TransportWriteCloser):
    """
    A Transport implementation using a socket for writing.
    """

    def __init__(self, sock: socket.SocketIO):
        self.sock = sock

    def write(self, data: bytes) -> None:
        try:
            self.sock.write(data)
        except (ConnectionResetError, BrokenPipeError):
            raise TransportEOFError("Socket write error, maybe the read end is closed")

    def close(self) -> None:
        self.sock.close()
