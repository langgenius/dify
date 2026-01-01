from queue import Queue

from core.virtual_environment.channel.exec import TransportEOFError
from core.virtual_environment.channel.transport import TransportReadCloser


class QueueTransportReadCloser(TransportReadCloser):
    """
    Transport implementation using queues for inter-thread communication.

    Usage:
        q_transport = QueueTransportReadCloser()
        write_handler = q_transport.get_write_handler()

        # In writer thread
        write_handler.write(b"data")

        # In reader thread
        data = q_transport.read(1024)

        # Close transport when done
        q_transport.close()
    """

    class WriteHandler:
        """
        A write handler that writes data to a queue.
        """

        def __init__(self, queue: Queue[bytes | None]) -> None:
            self.queue = queue

        def write(self, data: bytes) -> None:
            self.queue.put(data)

    def __init__(
        self,
    ) -> None:
        """
        Initialize the QueueTransportReadCloser with write function.
        """
        self.q = Queue[bytes | None]()
        self._read_buffer = bytearray()
        self._closed = False
        self._write_channel_closed = False

    def get_write_handler(self) -> WriteHandler:
        """
        Get a write handler that writes to the internal queue.
        """
        return QueueTransportReadCloser.WriteHandler(self.q)

    def close(self) -> None:
        """
        Close the transport by putting a sentinel value in the queue.
        """
        if self._write_channel_closed:
            raise TransportEOFError("Write channel already closed")

        self._write_channel_closed = True
        self.q.put(None)

    def read(self, n: int) -> bytes:
        """
        Read up to n bytes from the queue.

        NEVER USE IT IN A MULTI-THREADED CONTEXT WITHOUT PROPER SYNCHRONIZATION.
        """
        if n <= 0:
            return b""

        if self._closed:
            raise TransportEOFError("Transport is closed")

        to_return = self._drain_buffer(n)
        while len(to_return) < n and not self._closed:
            chunk = self.q.get()
            if chunk is None:
                self._closed = True
                raise TransportEOFError("Transport is closed")

            self._read_buffer.extend(chunk)

            if n - len(to_return) > 0:
                # Drain the buffer if we still need more data
                to_return += self._drain_buffer(n - len(to_return))
            else:
                # No more data needed, break
                break

            if self.q.qsize() == 0:
                # If no more data is available, break to return what we have
                break

        return to_return

    def _drain_buffer(self, n: int) -> bytes:
        data = bytes(self._read_buffer[:n])
        del self._read_buffer[:n]
        return data
