import os

from core.virtual_environment.channel.transport import Transport


class PipeTransport(Transport):
    """
    A Transport implementation using OS pipes. it requires two file descriptors:
    one for reading and one for writing.

    NOTE: r_fd and w_fd must be a pair created by os.pipe(). or returned from subprocess.Popen
    """

    def __init__(self, r_fd: int, w_fd: int):
        self.r_fd = r_fd
        self.w_fd = w_fd

    def write(self, data: bytes) -> None:
        os.write(self.w_fd, data)

    def read(self, n: int) -> bytes:
        return os.read(self.r_fd, n)

    def close(self) -> None:
        os.close(self.r_fd)
        os.close(self.w_fd)
