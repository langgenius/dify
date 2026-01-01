import os

from core.virtual_environment.channel.exec import TransportEOFError
from core.virtual_environment.channel.transport import Transport, TransportReadCloser, TransportWriteCloser


class PipeTransport(Transport):
    """
    A Transport implementation using OS pipes. it requires two file descriptors:
    one for reading and one for writing.

    NOTE: r_fd and w_fd must be a pair created by os.pipe(). or returned from subprocess.Popen

    NEVER FORGET TO CALL `close()` METHOD TO AVOID FILE DESCRIPTOR LEAKAGE.
    """

    def __init__(self, r_fd: int, w_fd: int):
        self.r_fd = r_fd
        self.w_fd = w_fd

    def write(self, data: bytes) -> None:
        try:
            os.write(self.w_fd, data)
        except OSError:
            raise TransportEOFError("Pipe write error, maybe the read end is closed")

    def read(self, n: int) -> bytes:
        data = os.read(self.r_fd, n)
        if data == b"":
            raise TransportEOFError("End of Pipe reached")
        return data

    def close(self) -> None:
        os.close(self.r_fd)
        os.close(self.w_fd)


class PipeReadCloser(TransportReadCloser):
    """
    A Transport implementation using OS pipe for reading.
    """

    def __init__(self, r_fd: int):
        self.r_fd = r_fd

    def read(self, n: int) -> bytes:
        data = os.read(self.r_fd, n)
        if data == b"":
            raise TransportEOFError("End of Pipe reached")

        return data

    def close(self) -> None:
        os.close(self.r_fd)


class PipeWriteCloser(TransportWriteCloser):
    """
    A Transport implementation using OS pipe for writing.
    """

    def __init__(self, w_fd: int):
        self.w_fd = w_fd

    def write(self, data: bytes) -> None:
        try:
            os.write(self.w_fd, data)
        except OSError:
            raise TransportEOFError("Pipe write error, maybe the read end is closed")

    def close(self) -> None:
        os.close(self.w_fd)
