from queue import Queue

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

    def get_write_handler(self) -> WriteHandler:
        """
        Get a write handler that writes to the internal queue.
        """
        return QueueTransportReadCloser.WriteHandler(self.q)

    def close(self) -> None:
        """
        Close the transport by putting a sentinel value in the queue.
        """
        self.q.put(None)

    def read(self, n: int) -> bytes:
        """
        Read up to n bytes from the queue.
        """
        data = bytearray()
        while len(data) < n:
            chunk = self.q.get()
            if chunk is None:
                break
            data.extend(chunk)

        return bytes(data)
