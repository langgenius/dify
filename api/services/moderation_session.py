"""Invocation-local moderation decisions shared by app and model boundaries.

Only exact input segments and prefixes of approved model streams are reusable.
Substring matching, cross-invocation reuse, and caching unavailable checks are
forbidden. Unavailable error records preserve terminal failure identity, not
reusable moderation decisions. A session belongs to one admitted tenant/app and
is safe across its producer and response-consumer threads.

Platform model admission enables verdict sharing, not platform funding of new
app checks. Only a trusted main AI-credit model may admit those app checks;
workflow nodes cannot authorize checks of unrelated app content.
"""

from collections.abc import Callable
from threading import RLock

from services.moderation_service import ModerationPhase, ModerationRejectedError, ModerationUnavailableError


class ModerationSession:
    def __init__(self, tenant_id: str, app_id: str) -> None:
        """Bind an admitted scope; start with no enabled platform policy or cached decisions."""
        if not tenant_id:
            raise ValueError("Moderation sessions require a tenant scope.")
        self.tenant_id = tenant_id
        self.app_id = app_id
        self.enabled = False
        self.app_platform_checks_enabled = False
        self._lock = RLock()
        self._decisions: dict[tuple[ModerationPhase, str], ModerationRejectedError | None] = {}
        self._streams: dict[object, str] = {}
        self._rejections: dict[str, ModerationPhase] = {}
        self._unavailable_errors: dict[str, ModerationUnavailableError] = {}

    def record_unavailable(self, error: ModerationUnavailableError) -> None:
        """Retain a real check failure for terminal error recovery, without caching a moderation verdict."""
        with self._lock:
            self._unavailable_errors[str(error)] = error

    def unavailable_error(self, message: str) -> ModerationUnavailableError | None:
        """Return only an exact failure from this invocation; unrelated terminal messages remain unclassified."""
        with self._lock:
            return self._unavailable_errors.get(message)

    def check(self, text: str, phase: ModerationPhase, checker: Callable[[], None]) -> None:
        """Reuse an exact verdict or execute the checker once; unavailable checks remain retryable."""
        key = (phase, text)
        with self._lock:
            if key not in self._decisions:
                try:
                    checker()
                except ModerationRejectedError as error:
                    self._decisions[key] = error
                    self._rejections[str(error)] = phase
                    raise
                self._decisions[key] = None
            rejection = self._decisions[key]
            if rejection is not None:
                raise rejection

    def record_output(self, stream: object, text: str) -> None:
        """Record only model text approved before delivery, using one identity per model response."""
        with self._lock:
            self._streams[stream] = self._streams.get(stream, "") + text

    def cached_verdict(self, text: str, phase: ModerationPhase) -> bool | None:
        """Read a same-phase verdict without I/O; None means the text has no reusable decision.

        Approved output prefixes may reuse their model stream's decision. Other
        content requires an exact cached check; unavailable checks are never cached.
        """
        with self._lock:
            key = (phase, text)
            if key in self._decisions:
                return self._decisions[key] is not None
            if phase == "output" and self.approved_output(text):
                return False
            return None

    def approved_output(self, text: str) -> bool:
        """Recognize a prefix of one approved model response, never an arbitrary substring or composition."""
        with self._lock:
            return not text or any(stream.startswith(text) for stream in self._streams.values())

    def rejected_phase(self, message: str) -> ModerationPhase | None:
        """Resolve only an exact error message produced by this invocation's rejected checks."""
        with self._lock:
            return self._rejections.get(message)
