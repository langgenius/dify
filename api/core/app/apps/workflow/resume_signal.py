"""
Resume Signal Module for Workflow Debugger Mode

This module provides an in-memory signal mechanism for resuming paused workflows
in debugger mode without breaking the SSE connection.

The key components:
- ResumeSignal: Data class representing a resume signal with action and reason
- ResumeChannel: A channel that can wait for a resume signal with timeout
- ResumeChannelRegistry: A registry to manage channels by workflow_run_id
"""

import logging
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class ResumeSignal:
    """
    Signal data for resuming a paused workflow.

    Attributes:
        action: The action to take (approve or reject)
        reason: The reason for resuming
        user_id: The ID of the user who triggered the resume
        paused_node_id: The ID of the node that was paused
    """

    action: str
    reason: str
    user_id: str
    paused_node_id: str


class ResumeChannel:
    """
    A channel for waiting and receiving resume signals.

    This channel uses threading events to allow SSE connections
    to wait for resume signals without polling.
    """

    _event: threading.Event
    _signal: ResumeSignal | None
    _closed: bool
    _MAX_WAIT_TIMEOUT = 300  # Maximum 5 minutes to prevent indefinite waiting

    def __init__(self):
        self._event = threading.Event()
        self._signal = None
        self._closed = False

    def wait_for_signal(self, timeout: float | None = None) -> ResumeSignal | None:
        """
        Wait for a resume signal.

        Args:
            timeout: Maximum time to wait in seconds. If None, uses default max timeout.
                    Cannot exceed _MAX_WAIT_TIMEOUT (5 minutes).

        Returns:
            The resume signal if received, None if timeout or channel closed.
        """
        if self._closed:
            return None

        # Enforce maximum timeout to prevent indefinite waiting
        wait_timeout = min(timeout or self._MAX_WAIT_TIMEOUT, self._MAX_WAIT_TIMEOUT)

        # Wait for the event to be set
        signaled = self._event.wait(timeout=wait_timeout)

        if signaled and not self._closed:
            return self._signal
        return None

    def send_signal(self, signal: ResumeSignal) -> bool:
        """
        Send a resume signal to waiting listeners.

        Args:
            signal: The resume signal to send.

        Returns:
            True if signal was sent successfully.
        """
        if self._closed:
            return False

        self._signal = signal
        self._event.set()
        return True

    def close(self):
        """
        Close the channel and unblock any waiting listeners.
        """
        self._closed = True
        self._event.set()

    @property
    def is_closed(self) -> bool:
        """Check if the channel is closed."""
        return self._closed


class ResumeChannelRegistry:
    """
    Registry for managing resume channels by workflow_run_id.

    This allows the resume API to send signals to active SSE connections
    that are waiting for user input.

    Channels are automatically cleaned up after a max age to prevent memory leaks.
    """

    _channels: OrderedDict[str, tuple[ResumeChannel, float]]
    _lock: threading.Lock
    _max_age_seconds: float

    def __init__(self, max_age_seconds: float = 3600):
        """
        Initialize the registry with a maximum channel age.

        Args:
            max_age_seconds: Maximum age in seconds before a channel is cleaned up (default: 1 hour)
        """
        self._channels = OrderedDict()
        self._lock = threading.Lock()
        self._max_age_seconds = max_age_seconds

    def _cleanup_old_channels(self):
        """Remove channels that have exceeded the maximum age."""
        now = time.time()
        old_channels = [wid for wid, (_, ts) in self._channels.items() if now - ts > self._max_age_seconds]
        for wid in old_channels:
            channel, _ = self._channels[wid]
            channel.close()
            del self._channels[wid]
            logger.debug("Cleaned up expired resume channel for workflow run %s", wid)

        if old_channels:
            logger.info("Cleaned up %d expired resume channels", len(old_channels))

    def register(self, workflow_run_id: str) -> ResumeChannel:
        """
        Register a new channel for a workflow run.

        Args:
            workflow_run_id: The workflow run ID to register.

        Returns:
            A new ResumeChannel for this workflow run.
        """
        with self._lock:
            # Clean up old channels first
            self._cleanup_old_channels()

            # Close existing channel if any
            if workflow_run_id in self._channels:
                self._channels[workflow_run_id][0].close()

            now = time.time()
            channel = ResumeChannel()
            self._channels[workflow_run_id] = (channel, now)
            logger.debug("Registered resume channel for workflow run %s", workflow_run_id)
            return channel

    def unregister(self, workflow_run_id: str):
        """
        Unregister and close a channel for a workflow run.

        Args:
            workflow_run_id: The workflow run ID to unregister.
        """
        with self._lock:
            if workflow_run_id in self._channels:
                channel, _ = self._channels[workflow_run_id]
                channel.close()
                del self._channels[workflow_run_id]
                logger.debug("Unregistered resume channel for workflow run %s", workflow_run_id)

    def send_signal(self, workflow_run_id: str, signal: ResumeSignal) -> bool:
        """
        Send a resume signal to a workflow run's channel.

        Args:
            workflow_run_id: The workflow run ID to send signal to.
            signal: The resume signal to send.

        Returns:
            True if signal was sent successfully, False if no channel exists.
        """
        with self._lock:
            entry = self._channels.get(workflow_run_id)
            if entry is None:
                logger.warning("No active channel for workflow run %s", workflow_run_id)
                return False
            channel, _ = entry
            return channel.send_signal(signal)

    def get_channel(self, workflow_run_id: str) -> ResumeChannel | None:
        """
        Get the channel for a workflow run.

        Args:
            workflow_run_id: The workflow run ID.

        Returns:
            The ResumeChannel if exists, None otherwise.
        """
        with self._lock:
            entry = self._channels.get(workflow_run_id)
            if entry is None:
                return None
            channel, _ = entry
            return channel


# Global singleton registry for resume channels
resume_channel_registry = ResumeChannelRegistry()
