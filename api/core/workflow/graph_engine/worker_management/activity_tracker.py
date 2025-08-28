"""
Activity tracker for monitoring worker activity.
"""

import threading
import time
from typing import final


@final
class ActivityTracker:
    """
    Tracks worker activity for scaling decisions.

    This monitors which workers are active or idle to support
    dynamic scaling decisions.
    """

    def __init__(self, idle_threshold: float = 30.0) -> None:
        """
        Initialize the activity tracker.

        Args:
            idle_threshold: Seconds before a worker is considered idle
        """
        self.idle_threshold = idle_threshold
        self._worker_activity: dict[int, tuple[bool, float]] = {}
        self._lock = threading.RLock()

    def track_activity(self, worker_id: int, is_active: bool) -> None:
        """
        Track worker activity state.

        Args:
            worker_id: ID of the worker
            is_active: Whether the worker is active
        """
        with self._lock:
            self._worker_activity[worker_id] = (is_active, time.time())

    def get_idle_workers(self) -> list[int]:
        """
        Get list of workers that have been idle too long.

        Returns:
            List of idle worker IDs
        """
        current_time = time.time()
        idle_workers = []

        with self._lock:
            for worker_id, (is_active, last_change) in self._worker_activity.items():
                if not is_active and (current_time - last_change) > self.idle_threshold:
                    idle_workers.append(worker_id)

        return idle_workers

    def remove_worker(self, worker_id: int) -> None:
        """
        Remove a worker from tracking.

        Args:
            worker_id: ID of the worker to remove
        """
        with self._lock:
            self._worker_activity.pop(worker_id, None)

    def get_active_count(self) -> int:
        """
        Get count of currently active workers.

        Returns:
            Number of active workers
        """
        with self._lock:
            return sum(1 for is_active, _ in self._worker_activity.values() if is_active)
