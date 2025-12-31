from abc import abstractmethod
from typing import Protocol


class TransportCloser(Protocol):
    """
    Transport that can be closed.
    """

    @abstractmethod
    def close(self) -> None:
        """
        Close the transport.
        """


class TransportWriter(Protocol):
    """
    Transport that can be written to.
    """

    @abstractmethod
    def write(self, data: bytes) -> None:
        """
        Write data to the transport.
        """


class TransportReader(Protocol):
    """
    Transport that can be read from.
    """

    @abstractmethod
    def read(self, n: int) -> bytes:
        """
        Read up to n bytes from the transport.
        """


class TransportReadCloser(TransportReader, TransportCloser):
    """
    Transport that can be read from and closed.
    """


class TransportWriteCloser(TransportWriter, TransportCloser):
    """
    Transport that can be written to and closed.
    """


class Transport(TransportReader, TransportWriter, TransportCloser):
    """
    Transport that can be read from, written to, and closed.
    """


class NopTransportWriteCloser(TransportWriteCloser):
    """
    A no-operation TransportWriteCloser implementation.

    This transport does nothing on write and close operations.
    """

    def write(self, data: bytes) -> None:
        """
        No-operation write method.
        """
        pass

    def close(self) -> None:
        """
        No-operation close method.
        """
        pass
