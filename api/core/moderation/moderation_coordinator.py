import threading


class ModerationCoordinator:
    def __init__(self):
        self._end_seen = False
        self._lock = threading.Lock()
        self.async_done = threading.Event()

    def mark_stream_end_seen(self):
        with self._lock:
            self._end_seen = True

    def ready_to_close(self) -> bool:
        with self._lock:
            return self._end_seen and self.async_done.is_set()
