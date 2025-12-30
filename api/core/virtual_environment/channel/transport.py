from abc import abstractmethod
from typing import Protocol


class Transport(Protocol):
    @abstractmethod
    def write(self, data: bytes) -> None:
        """
        Write data to the transport.
        """
        pass

    @abstractmethod
    def read(self, n: int) -> bytes:
        """
        Read up to n bytes from the transport.
        """
        pass

    @abstractmethod
    def close(self) -> None:
        """
        Close the transport.
        """
        pass
