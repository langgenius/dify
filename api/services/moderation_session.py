"""Bridge model failures to one app response consumer without scheduling checks.

Model guards publish failure identities through a thread-safe queue. The response
consumer alone owns terminal lookup maps. No content, approvals, cross-model
verdict cache, or network operation belongs to this session.
"""

from queue import Empty, SimpleQueue

from services.moderation_service import ModerationPhase, ModerationRejectedError, ModerationUnavailableError


class ModerationSession:
    def __init__(self, tenant_id: str, app_id: str) -> None:
        """Bind one admitted invocation; producers publish failures and one consumer resolves them."""
        if not tenant_id:
            raise ValueError("Moderation sessions require a tenant scope.")
        self.tenant_id = tenant_id
        self.app_id = app_id
        self._failures: SimpleQueue[ModerationRejectedError | ModerationUnavailableError] = SimpleQueue()
        self._rejections: dict[str, ModerationPhase] = {}
        self._unavailable_errors: dict[str, ModerationUnavailableError] = {}

    def record_rejection(self, error: ModerationRejectedError) -> None:
        """Publish a real platform rejection before its model invocation raises, without caching a verdict."""
        self._failures.put(error)

    def record_unavailable(self, error: ModerationUnavailableError) -> None:
        """Publish a typed check failure before its model invocation raises, without blocking another check."""
        self._failures.put(error)

    def _consume_failures(self) -> None:
        """Move available producer records into consumer-owned indexes; never wait for model work."""
        consuming = True
        while consuming:
            try:
                error = self._failures.get_nowait()
            except Empty:
                consuming = False
            else:
                if isinstance(error, ModerationRejectedError):
                    self._rejections[str(error)] = error.phase
                else:
                    self._unavailable_errors[str(error)] = error

    def unavailable_error(self, message: str) -> ModerationUnavailableError | None:
        """Resolve an exact recorded failure from the response consumer; unrelated messages stay unclassified."""
        self._consume_failures()
        return self._unavailable_errors.get(message)

    def rejected_phase(self, message: str) -> ModerationPhase | None:
        """Resolve an exact platform rejection from the response consumer after model failure publication."""
        self._consume_failures()
        return self._rejections.get(message)
